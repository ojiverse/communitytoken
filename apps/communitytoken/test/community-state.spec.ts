import {
	env,
	evictDurableObject,
	runInDurableObject,
	SELF,
} from "cloudflare:test";
import {
	ADMIN_API_PRINCIPAL,
	type AdminActor,
	rehydrate,
	TREASURY_SELECTOR,
	type TransactionContext,
	type UserActor,
	userSelector,
} from "@communitytoken/application";
import { describe, expect, it } from "vitest";
import type { CommunityState } from "../src/index";
import { createStorageUnitOfWork } from "../src/unit-of-work";

/**
 * PR-2 integration coverage for the production CommunityState Durable
 * Object: serialization, atomic rollback, storage-level append-only,
 * eviction survival, safe-integer storage, and the production
 * UnitOfWork's context lifetime / synchronous-section behavior.
 *
 * Each test uses a freshly-named DO id so tests are isolated without any
 * shared storage.
 */

const ADMIN: AdminActor = { kind: "service", principalId: ADMIN_API_PRINCIPAL };

function freshStub(): DurableObjectStub<CommunityState> {
	const id = env.COMMUNITY_STATE.idFromName(crypto.randomUUID());
	return env.COMMUNITY_STATE.get(id) as DurableObjectStub<CommunityState>;
}

function userActor(rawUserId: string): UserActor {
	return { kind: "user", userId: rehydrate.userId(rawUserId) };
}

describe("worker fetch surface", () => {
	it("returns 404 for every request — no routes exist in PR-2", async () => {
		for (const path of [
			"/",
			"/health",
			"/internal/balance",
			"/admin/issuances",
		]) {
			const response = await SELF.fetch(`https://token.ojiver.se${path}`, {
				method: "POST",
			});
			expect(response.status).toBe(404);
		}
	});
});

describe("production economic path", () => {
	it("createUser seeds a user with a zero-balance wallet; ids stay verbatim", async () => {
		const s = freshStub();
		await s.createUser("alice");

		const balance = await s.getBalance(
			userActor("alice"),
			userSelector(rehydrate.userId("alice")),
		);
		expect(balance).toEqual({ ok: true, value: { balance: 0 } });
	});

	it("rejects a duplicate createUser and keeps exactly one wallet", async () => {
		const s = freshStub();
		expect(await s.createUser("alice")).toEqual({ ok: true });
		// Expected duplicates surface as a result value, not an RPC rejection,
		// so no remote unhandled rejection is produced in the test pool.
		const duplicate = await s.createUser("alice");
		expect(duplicate.ok).toBe(false);

		const balance = await s.getBalance(
			userActor("alice"),
			userSelector(rehydrate.userId("alice")),
		);
		expect(balance).toEqual({ ok: true, value: { balance: 0 } });
		await runInDurableObject(s, async (_i, state) => {
			const row = state.storage.sql
				.exec("SELECT COUNT(*) AS n FROM wallets WHERE owner_user_id = 'alice'")
				.one();
			expect(row["n"]).toBe(1);
		});
	});

	it("composes kernel evaluation through the six use-case methods", async () => {
		const s = freshStub();
		await s.createUser("alice");
		await s.createUser("bob");
		const alice = userActor("alice");
		const bob = rehydrate.userId("bob");

		expect(await s.issueToken(ADMIN, { amount: 100 })).toEqual({
			ok: true,
			value: { operationId: expect.any(String) },
		});
		expect(
			await s.distributeToken(ADMIN, { toUserId: bob, amount: 40 }),
		).toEqual({ ok: true, value: { operationId: expect.any(String) } });

		const payment = await s.payTreasury(alice, { amount: 0 });
		expect(payment.ok).toBe(false);
		if (!payment.ok) {
			expect(payment.error).toMatchObject({
				type: "rejected",
				code: "INVALID_AMOUNT",
			});
		}
	});

	it("records newest-first paginated history through the production join", async () => {
		const s = freshStub();
		await s.createUser("alice");
		await s.createUser("bob");
		const alice = userActor("alice");
		const aliceId = rehydrate.userId("alice");
		const bobId = rehydrate.userId("bob");

		await s.issueToken(ADMIN, { amount: 100 });
		await s.distributeToken(ADMIN, { toUserId: aliceId, amount: 100 });
		await s.transferToken(alice, { toUserId: bobId, amount: 30 });
		await s.transferToken(alice, { toUserId: aliceId, amount: 5 });

		const first = await s.getTransactionHistory(alice, userSelector(aliceId), {
			limit: 1,
		});
		expect(first.ok).toBe(true);
		if (!first.ok) return;
		expect(first.value.entries).toHaveLength(1);
		expect(first.value.entries[0]).toMatchObject({
			kind: "P2P_TRANSFER",
			direction: "self",
			counterparty: aliceId,
		});
		expect(first.value.nextCursor).not.toBeNull();

		const rest = await s.getTransactionHistory(alice, userSelector(aliceId), {
			limit: 100,
			cursor: first.value.nextCursor,
		});
		expect(rest.ok).toBe(true);
		if (!rest.ok) return;
		expect(rest.value.entries.map((e) => e.direction)).toEqual(["out", "in"]);
		expect(rest.value.nextCursor).toBeNull();
	});

	it("rejects out-of-contract history limits without clamping", async () => {
		const s = freshStub();
		await s.createUser("alice");
		const alice = userActor("alice");

		for (const limit of [0, 101, 1.5]) {
			const page = await s.getTransactionHistory(
				alice,
				userSelector(rehydrate.userId("alice")),
				{ limit },
			);
			expect(page).toEqual({
				ok: false,
				error: {
					type: "invalid-input",
					code: "INVALID_LIMIT",
					detail: expect.any(String),
				},
			});
		}
	});
});

describe("schema monetary domain enforcement", () => {
	const MAX = Number.MAX_SAFE_INTEGER;

	const INSERT_OP =
		"INSERT INTO economic_operations (id, kind, metadata, actor_kind, actor_id, created_at) VALUES (?, 'TOKEN_ISSUANCE', NULL, 'service', 'admin-api', 1)";
	const INSERT_LEDGER =
		"INSERT INTO ledger_transactions (id, operation_id, from_wallet_id, to_wallet_id, amount, created_at) VALUES (?, ?, 'treasury', 'treasury', ?, 1)";

	it("stores the maximum wallet balance and round-trips it exactly", async () => {
		const s = freshStub();
		await runInDurableObject(s, async (_i, state) => {
			state.storage.sql.exec(
				"UPDATE wallets SET balance = ?, updated_at = 1 WHERE id = 'treasury'",
				MAX,
			);
			const row = state.storage.sql
				.exec("SELECT balance FROM wallets WHERE id = 'treasury'")
				.one();
			expect(row["balance"]).toBe(MAX);
		});
	});

	it("rejects out-of-domain balances at the DB boundary, not just in code", async () => {
		const s = freshStub();
		for (const balance of [MAX + 1, -1, 1.5]) {
			await expect(
				runInDurableObject(s, async (_i, state) => {
					state.storage.sql.exec(
						"UPDATE wallets SET balance = ? WHERE id = 'treasury'",
						balance,
					);
				}),
			).rejects.toThrow();
		}
		await runInDurableObject(s, async (_i, state) => {
			const row = state.storage.sql
				.exec("SELECT balance FROM wallets WHERE id = 'treasury'")
				.one();
			expect(row["balance"]).toBe(0);
		});
	});

	it("stores the maximum ledger amount and round-trips it exactly", async () => {
		const s = freshStub();
		const operationId = crypto.randomUUID();
		await runInDurableObject(s, async (_i, state) => {
			// Operation and ledger pair must commit inside one transaction:
			// the reciprocal deferred FKs admit neither side alone.
			state.storage.transactionSync(() => {
				state.storage.sql.exec(INSERT_OP, operationId);
				state.storage.sql.exec(
					INSERT_LEDGER,
					crypto.randomUUID(),
					operationId,
					MAX,
				);
			});
			const row = state.storage.sql
				.exec(
					"SELECT amount FROM ledger_transactions WHERE operation_id = ?",
					operationId,
				)
				.one();
			expect(row["amount"]).toBe(MAX);
		});
	});

	it("rejects out-of-domain ledger amounts at the DB boundary and rolls the pair back", async () => {
		const s = freshStub();
		for (const amount of [MAX + 1, 0, -3, 2.5]) {
			const operationId = crypto.randomUUID();
			await expect(
				runInDurableObject(s, async (_i, state) => {
					state.storage.transactionSync(() => {
						state.storage.sql.exec(INSERT_OP, operationId);
						state.storage.sql.exec(
							INSERT_LEDGER,
							crypto.randomUUID(),
							operationId,
							amount,
						);
					});
				}),
			).rejects.toThrow();
			// The failed pair leaves no orphan operation behind.
			await runInDurableObject(s, async (_i, state) => {
				const row = state.storage.sql
					.exec(
						"SELECT COUNT(*) AS n FROM economic_operations WHERE id = ?",
						operationId,
					)
					.one();
				expect(row["n"]).toBe(0);
			});
		}
	});
});

describe("schema structural invariants", () => {
	it("seeds exactly one system wallet named 'treasury'", async () => {
		const s = freshStub();
		await runInDurableObject(s, async (_i, state) => {
			const systems = state.storage.sql
				.exec("SELECT id, kind FROM wallets WHERE kind = 'system'")
				.toArray();
			expect(systems).toEqual([{ id: "treasury", kind: "system" }]);
		});
	});

	it("rejects a second system wallet and treasury-id mismatches", async () => {
		const s = freshStub();
		// kind = 'system' AND id != 'treasury'
		await expect(
			runInDurableObject(s, async (_i, state) => {
				state.storage.sql.exec(
					"INSERT INTO wallets (id, kind, owner_user_id, balance, created_at, updated_at) VALUES ('other', 'system', NULL, 0, 1, 1)",
				);
			}),
		).rejects.toThrow();
		// id = 'treasury' AND kind != 'system'
		await s.createUser("alice");
		await expect(
			runInDurableObject(s, async (_i, state) => {
				state.storage.sql.exec(
					"INSERT INTO wallets (id, kind, owner_user_id, balance, created_at, updated_at) VALUES ('treasury', 'user', 'alice', 0, 1, 1)",
				);
			}),
		).rejects.toThrow();
	});

	it("enforces one ledger row per economic operation", async () => {
		const s = freshStub();
		const operationId = crypto.randomUUID();
		await runInDurableObject(s, async (_i, state) => {
			state.storage.transactionSync(() => {
				state.storage.sql.exec(
					"INSERT INTO economic_operations (id, kind, metadata, actor_kind, actor_id, created_at) VALUES (?, 'DISTRIBUTION', NULL, 'service', 'admin-api', 1)",
					operationId,
				);
				state.storage.sql.exec(
					"INSERT INTO ledger_transactions (id, operation_id, from_wallet_id, to_wallet_id, amount, created_at) VALUES (?, ?, 'treasury', 'treasury', 5, 1)",
					crypto.randomUUID(),
					operationId,
				);
			});
		});
		await expect(
			runInDurableObject(s, async (_i, state) => {
				state.storage.sql.exec(
					"INSERT INTO ledger_transactions (id, operation_id, from_wallet_id, to_wallet_id, amount, created_at) VALUES (?, ?, 'treasury', 'treasury', 7, 1)",
					crypto.randomUUID(),
					operationId,
				);
			}),
		).rejects.toThrow();
	});

	it("rejects deleting the treasury wallet but still allows balance updates", async () => {
		const s = freshStub();
		await expect(
			runInDurableObject(s, async (_i, state) => {
				state.storage.sql.exec("DELETE FROM wallets WHERE id = 'treasury'");
			}),
		).rejects.toThrow();
		// balance / updated_at remain mutable on the treasury row.
		await runInDurableObject(s, async (_i, state) => {
			state.storage.sql.exec(
				"UPDATE wallets SET balance = 42, updated_at = 9 WHERE id = 'treasury'",
			);
			const row = state.storage.sql
				.exec("SELECT balance, updated_at FROM wallets WHERE id = 'treasury'")
				.one();
			expect(row["balance"]).toBe(42);
			expect(row["updated_at"]).toBe(9);
		});
	});

	it("rejects converting the treasury row into a user wallet", async () => {
		const s = freshStub();
		await s.createUser("alice");
		await expect(
			runInDurableObject(s, async (_i, state) => {
				state.storage.sql.exec(
					"UPDATE wallets SET id = 'hijacked', kind = 'user', owner_user_id = 'alice' WHERE id = 'treasury'",
				);
			}),
		).rejects.toThrow();
		// The deployment still has its one system wallet named treasury.
		await runInDurableObject(s, async (_i, state) => {
			const systems = state.storage.sql
				.exec("SELECT id, kind FROM wallets WHERE kind = 'system'")
				.toArray();
			expect(systems).toEqual([{ id: "treasury", kind: "system" }]);
		});
	});
});

describe("operation-ledger exact 1:1 at commit", () => {
	const INSERT_OP =
		"INSERT INTO economic_operations (id, kind, metadata, actor_kind, actor_id, created_at) VALUES (?, 'TOKEN_ISSUANCE', NULL, 'service', 'admin-api', 1)";

	/**
	 * In workerd a deferred-FK violation surfaces at the output-gate commit:
	 * the DO is reset and rolled back to its last durable state, and the
	 * same stub stays poisoned — so verification re-opens the same DO id on
	 * a fresh stub and confirms the rolled-back state contains no orphan.
	 */
	function stubFor(name: string): DurableObjectStub<CommunityState> {
		const id = env.COMMUNITY_STATE.idFromName(name);
		return env.COMMUNITY_STATE.get(id) as DurableObjectStub<CommunityState>;
	}

	it("fails a transaction that commits an EconomicOperation without its ledger", async () => {
		const name = crypto.randomUUID();
		const operationId = crypto.randomUUID();
		await expect(
			runInDurableObject(stubFor(name), async (_i, state) => {
				state.storage.transactionSync(() => {
					state.storage.sql.exec(INSERT_OP, operationId);
				});
			}),
		).rejects.toThrow(/FOREIGN KEY|reset/);
		await runInDurableObject(stubFor(name), async (_i, state) => {
			const row = state.storage.sql
				.exec(
					"SELECT COUNT(*) AS n FROM economic_operations WHERE id = ?",
					operationId,
				)
				.one();
			expect(row["n"]).toBe(0);
		});
	});

	it("fails a transaction that commits a LedgerTransaction without its operation", async () => {
		const name = crypto.randomUUID();
		const operationId = crypto.randomUUID();
		await expect(
			runInDurableObject(stubFor(name), async (_i, state) => {
				state.storage.transactionSync(() => {
					state.storage.sql.exec(
						"INSERT INTO ledger_transactions (id, operation_id, from_wallet_id, to_wallet_id, amount, created_at) VALUES (?, ?, 'treasury', 'treasury', 5, 1)",
						crypto.randomUUID(),
						operationId,
					);
				});
			}),
		).rejects.toThrow(/FOREIGN KEY|reset/);
		await runInDurableObject(stubFor(name), async (_i, state) => {
			const row = state.storage.sql
				.exec("SELECT COUNT(*) AS n FROM ledger_transactions")
				.one();
			expect(row["n"]).toBe(0);
		});
	});
});

describe("serialization and atomicity", () => {
	it("serializes concurrent mutations; no double-spend, no lost update", async () => {
		const s = freshStub();
		await s.createUser("alice");
		await s.createUser("bob");
		const alice = userActor("alice");
		const bobId = rehydrate.userId("bob");

		await s.issueToken(ADMIN, { amount: 100 });
		await s.distributeToken(ADMIN, {
			toUserId: rehydrate.userId("alice"),
			amount: 100,
		});

		const attempts = await Promise.allSettled(
			Array.from({ length: 20 }, () =>
				s.transferToken(alice, { toUserId: bobId, amount: 10 }),
			),
		);
		const succeeded = attempts.filter(
			(a) => a.status === "fulfilled" && a.value.ok,
		);
		expect(succeeded).toHaveLength(10);

		expect(await s.totalSupply()).toBe(100);
		const aliceBalance = await s.getBalance(
			alice,
			userSelector(rehydrate.userId("alice")),
		);
		expect(aliceBalance).toEqual({ ok: true, value: { balance: 0 } });
		const bobBalance = await s.getBalance(
			userActor("bob"),
			userSelector(bobId),
		);
		expect(bobBalance).toEqual({ ok: true, value: { balance: 100 } });
	});

	it("rolls back a section that fails after a partial write", async () => {
		const s = freshStub();
		await runInDurableObject(s, async (_instance, state) => {
			const uow = createStorageUnitOfWork(state.storage, {
				nowMs: () => 1_234,
			});
			expect(() =>
				uow.transact((ctx) => {
					ctx.wallets.setBalance(rehydrate.walletId("treasury"), 50, 1);
					throw new Error("boom");
				}),
			).toThrow("boom");
		});

		const treasury = await s.getBalance(ADMIN, TREASURY_SELECTOR);
		expect(treasury).toEqual({ ok: true, value: { balance: 0 } });
	});

	it("rejects updates and deletes on both append-only tables", async () => {
		const s = freshStub();
		await s.issueToken(ADMIN, { amount: 5 });

		for (const sql of [
			"UPDATE economic_operations SET kind = 'DISTRIBUTION'",
			"DELETE FROM economic_operations",
			"UPDATE ledger_transactions SET amount = 999",
			"DELETE FROM ledger_transactions",
		]) {
			await expect(
				runInDurableObject(s, async (_i, state) => {
					state.storage.sql.exec(sql);
				}),
			).rejects.toThrow();
		}
	});

	it("preserves committed state across Durable Object eviction", async () => {
		const s = freshStub();
		await s.createUser("alice");
		await s.issueToken(ADMIN, { amount: 100 });
		await s.distributeToken(ADMIN, {
			toUserId: rehydrate.userId("alice"),
			amount: 70,
		});

		await evictDurableObject(s);

		expect(await s.totalSupply()).toBe(100);
		const balance = await s.getBalance(
			userActor("alice"),
			userSelector(rehydrate.userId("alice")),
		);
		expect(balance).toEqual({ ok: true, value: { balance: 70 } });
		expect(await s.listOperations()).toHaveLength(2);
		expect(await s.listLedger()).toHaveLength(2);
	});
});

describe("safe-integer storage", () => {
	it("round-trips the maximum monetary value exactly", async () => {
		const s = freshStub();
		const max = Number.MAX_SAFE_INTEGER;
		await s.issueToken(ADMIN, { amount: max });

		const treasury = await s.getBalance(ADMIN, TREASURY_SELECTOR);
		expect(treasury).toEqual({ ok: true, value: { balance: max } });
		expect(await s.totalSupply()).toBe(max);
		expect(await s.issuedAmount()).toBe(max);
		const ledger = await s.listLedger();
		expect(ledger[0]?.amount).toBe(max);
	});

	it("rejects issuance that would overflow the total supply domain", async () => {
		const s = freshStub();
		await s.createUser("alice");
		await s.issueToken(ADMIN, { amount: Number.MAX_SAFE_INTEGER });
		await s.distributeToken(ADMIN, {
			toUserId: rehydrate.userId("alice"),
			amount: 5,
		});

		const result = await s.issueToken(ADMIN, { amount: 3 });
		expect(result).toEqual({
			ok: false,
			error: {
				type: "rejected",
				code: "OVERFLOW",
				detail: expect.any(String),
			},
		});
		expect(await s.totalSupply()).toBe(Number.MAX_SAFE_INTEGER);
	});
});

describe("production UnitOfWork", () => {
	it("permanently revokes context and repository handles at section close", async () => {
		const s = freshStub();
		await runInDurableObject(s, async (_i, state) => {
			const uow = createStorageUnitOfWork(state.storage, {
				nowMs: () => 1,
			});
			let escapedWallets: TransactionContext["wallets"] | undefined;
			uow.transact((ctx) => {
				escapedWallets = ctx.wallets;
			});
			expect(escapedWallets).toBeDefined();
			expect(() => escapedWallets?.totalSupply()).toThrow(/closed/);
			// A later open section never revives the stale handle.
			uow.transact(() => {
				expect(() => escapedWallets?.findById(rehydrate.walletId("t"))).toThrow(
					/closed/,
				);
			});
		});
	});

	it("permanently revokes the TransactionContext itself at section close", async () => {
		const s = freshStub();
		await runInDurableObject(s, async (_i, state) => {
			const uow = createStorageUnitOfWork(state.storage, {
				nowMs: () => 1,
			});

			const expectRevoked = (ctx: TransactionContext) => {
				expect(() => ctx.nowMs).toThrow(/closed/);
				expect(() => ctx.wallets).toThrow(/closed/);
				expect(() => ctx.operations).toThrow(/closed/);
				expect(() => ctx.ledger).toThrow(/closed/);
			};

			// Committed section: every context property read is dead afterward.
			let committed: TransactionContext | undefined;
			uow.transact((ctx) => {
				committed = ctx;
			});
			expectRevoked(committed as TransactionContext);

			// Rolled-back section: revocation is identical.
			let aborted: TransactionContext | undefined;
			expect(() =>
				uow.transact((ctx) => {
					aborted = ctx;
					throw new Error("boom");
				}),
			).toThrow("boom");
			expectRevoked(aborted as TransactionContext);
		});
	});

	it("rejects nested transact sections", async () => {
		const s = freshStub();
		await runInDurableObject(s, async (_i, state) => {
			const uow = createStorageUnitOfWork(state.storage, {
				nowMs: () => 1,
			});
			expect(() => uow.transact(() => uow.transact(() => 1))).toThrow(/nested/);
		});
	});

	it("rejects object- and function-valued thenables and rolls back", async () => {
		const s = freshStub();
		await runInDurableObject(s, async (_i, state) => {
			const uow = createStorageUnitOfWork(state.storage, {
				nowMs: () => 1,
			});
			expect(() =>
				uow.transact((ctx) => {
					ctx.wallets.setBalance(rehydrate.walletId("treasury"), 9, 1);
					return Promise.resolve(1) as never;
				}),
			).toThrow(/PromiseLike/);
			// Deliberate function-valued thenable: the port contract requires
			// runtime rejection of thenables on functions, not only objects.
			// biome-ignore lint/suspicious/noThenProperty: intentional thenable fixture
			const functionThenable = Object.assign(() => 1, { then() {} });
			expect(() => uow.transact(() => functionThenable as never)).toThrow(
				/PromiseLike/,
			);
			expect(
				uow.transact(
					(ctx) =>
						ctx.wallets.findById(rehydrate.walletId("treasury"))?.balance,
				),
			).toBe(0);
		});
	});

	it("samples the injected clock exactly once per section", async () => {
		const s = freshStub();
		await runInDurableObject(s, async (_i, state) => {
			let samples = 0;
			const uow = createStorageUnitOfWork(state.storage, {
				nowMs: () => {
					samples += 1;
					return 7_777;
				},
			});
			const stamp = uow.transact((ctx) => ctx.nowMs);
			expect(stamp).toBe(7_777);
			expect(samples).toBe(1);
		});
	});

	it("hands out records that cannot alias-mutate stored state", async () => {
		const s = freshStub();
		await runInDurableObject(s, async (_i, state) => {
			const uow = createStorageUnitOfWork(state.storage, {
				nowMs: () => 1,
			});
			uow.transact((ctx) => {
				const treasury = ctx.wallets.findById(rehydrate.walletId("treasury"));
				expect(treasury).toBeDefined();
				expect(Object.isFrozen(treasury)).toBe(true);
				expect(() => {
					(treasury as { balance: number }).balance = 9;
				}).toThrow();
			});
			expect(
				uow.transact(
					(ctx) =>
						ctx.wallets.findById(rehydrate.walletId("treasury"))?.balance,
				),
			).toBe(0);
		});
	});

	it("stamps every write in a section with the one frozen clock sample", async () => {
		const s = freshStub();
		await runInDurableObject(s, async (instance) => {
			instance.clock = { nowMs: () => 5_555 };
		});
		await s.issueToken(ADMIN, { amount: 5 });

		const ops = await s.listOperations();
		const ledger = await s.listLedger();
		expect(ops[0]?.created_at).toBe(5_555);
		expect(ledger[0]?.created_at).toBe(5_555);
	});
});

describe("harness actor persistence", () => {
	it("persists the deterministic actor mapping on operation rows", async () => {
		const s = freshStub();
		await s.createUser("alice");
		const aliceId = rehydrate.userId("alice");

		await s.applyEconomicCommand(ADMIN, {
			kind: "TOKEN_ISSUANCE",
			from: TREASURY_SELECTOR,
			to: TREASURY_SELECTOR,
			amount: 10,
		});
		await s.applyEconomicCommand(
			{ kind: "user", userId: aliceId },
			{
				kind: "DISTRIBUTION",
				from: TREASURY_SELECTOR,
				to: userSelector(aliceId),
				amount: 10,
			},
		);

		const ops = await s.listOperations();
		expect(ops[0]).toMatchObject({
			kind: "TOKEN_ISSUANCE",
			actor_kind: "service",
			actor_id: "admin-api",
		});
		expect(ops[1]).toMatchObject({
			kind: "DISTRIBUTION",
			actor_kind: "user",
			actor_id: "alice",
		});
	});
});
