import {
	env,
	evictDurableObject,
	runInDurableObject,
	SELF,
} from "cloudflare:test";
import {
	ADMIN_API_CALLER,
	rehydrate,
	type TransactionContext,
} from "@communitytoken/application";
import { describe, expect, it } from "vitest";
import { DISCORD_ADAPTER_CALLER } from "../src/auth";
import type { CommunityState, IdempotencyParams } from "../src/community-state";
import type { CommunityStateApi } from "../src/http";
import { createStorageUnitOfWork } from "../src/unit-of-work";
import {
	administrativeIssuer,
	fund,
	query,
	seedIdentity,
} from "./support/seed";

/**
 * Integration coverage for the production CommunityState Durable Object:
 * initialization of the administrative issuer Principal, the primitive
 * ledger schema and its storage-level constraints (Transaction shape,
 * monetary domains, default-Account designation, append-only history),
 * serialization, rollback, eviction survival, the production UnitOfWork's
 * context lifetime, and the route-facing methods' atomic idempotency.
 *
 * Each test uses a freshly-named DO id so tests are isolated.
 */

const ISSUER = "https://discord.id.ojiver.se";
const MAX = Number.MAX_SAFE_INTEGER;

function freshStub(): DurableObjectStub<CommunityState> {
	const id = env.COMMUNITY_STATE.idFromName(crypto.randomUUID());
	return env.COMMUNITY_STATE.get(id) as DurableObjectStub<CommunityState>;
}

/**
 * The route-facing RPC surface of a stub. The generic stub type recurses
 * past the checker depth on `JsonValue`, so tests use the same declared
 * interface the Worker uses.
 */
function rpc(stub: DurableObjectStub<CommunityState>): CommunityStateApi {
	return stub as unknown as CommunityStateApi;
}

function identity(subject: string) {
	return { issuer: ISSUER, subject };
}

function idempotency(key = crypto.randomUUID()): IdempotencyParams {
	return { key, fingerprintVersion: "v1", requestFingerprint: `fp-${key}` };
}

/** Runs `statement` inside the object and reports whether it threw. */
async function rejects(
	stub: DurableObjectStub<CommunityState>,
	statement: string,
	...bindings: (string | number | null)[]
): Promise<boolean> {
	return runInDurableObject(stub, (_i, state) => {
		try {
			state.storage.transactionSync(() => {
				state.storage.sql.exec(statement, ...bindings);
			});
			return false;
		} catch {
			return true;
		}
	});
}

async function count(
	stub: DurableObjectStub<CommunityState>,
	table: string,
): Promise<number> {
	const [row] = await query<{ n: number }>(
		stub,
		`SELECT COUNT(*) AS n FROM ${table}`,
	);
	return row?.n ?? 0;
}

describe("worker fetch surface", () => {
	it("404s unowned paths and 401s unauthenticated owned routes", async () => {
		for (const path of ["/", "/health"]) {
			const response = await SELF.fetch(`https://token.ojiver.se${path}`, {
				method: "POST",
			});
			expect(response.status).toBe(404);
		}
		const owned = await SELF.fetch("https://token.ojiver.se/api/v1/balance", {
			method: "POST",
		});
		expect(owned.status).toBe(401);
	});
});

describe("initialization", () => {
	it("ensures exactly one administrative issuer Principal with no Account, binding, or designation", async () => {
		const s = freshStub();
		const issuer = await administrativeIssuer(s);

		expect(await count(s, "principals")).toBe(1);
		expect(await count(s, "administrative_issuer")).toBe(1);
		expect(await count(s, "accounts")).toBe(0);
		expect(await count(s, "identity_bindings")).toBe(0);
		expect(await count(s, "default_accounts")).toBe(0);
		expect(await count(s, "transactions")).toBe(0);
		expect(
			await query(s, "SELECT id FROM principals WHERE id = ?", issuer),
		).toHaveLength(1);
	});

	it("keeps the same administrative issuer Principal across eviction", async () => {
		const s = freshStub();
		const before = await administrativeIssuer(s);

		await evictDurableObject(s);

		expect(await administrativeIssuer(s)).toBe(before);
		expect(await count(s, "principals")).toBe(1);
	});

	it("has no superseded EconomicOperation/LedgerTransaction/Wallet/User tables", async () => {
		const s = freshStub();
		const tables = (
			await query<{ name: string }>(
				s,
				"SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE '\\_%' ESCAPE '\\' AND name NOT LIKE 'sqlite_%'",
			)
		)
			.map((t) => t.name)
			.sort();

		expect(tables).toEqual([
			"accounts",
			"administrative_issuer",
			"default_accounts",
			"idempotency_records",
			"identity_bindings",
			"principals",
			"registration_intents",
			"transactions",
		]);
	});

	it("gives primitive tables no kind, role, default, reserve, or treasury column", async () => {
		const s = freshStub();
		const columns = async (table: string) =>
			(await query<{ name: string }>(s, `PRAGMA table_info(${table})`))
				.map((c) => c.name)
				.sort();

		expect(await columns("principals")).toEqual(["created_at", "id"]);
		expect(await columns("accounts")).toEqual([
			"balance",
			"created_at",
			"id",
			"owner_principal_id",
			"updated_at",
		]);
		expect(await columns("transactions")).toEqual([
			"amount",
			"committed_at",
			"destination_account_id",
			"id",
			"issuer_principal_id",
			"kind",
			"source_account_id",
		]);
	});
});

describe("schema monetary domain enforcement", () => {
	it("stores the maximum balance and amount and round-trips them exactly", async () => {
		const s = freshStub();
		const alice = await seedIdentity(s, identity("alice"));
		await fund(s, identity("alice"), MAX);

		const [account] = await query<{ balance: number }>(
			s,
			"SELECT balance FROM accounts WHERE id = ?",
			alice.accountId,
		);
		const [tx] = await query<{ amount: number }>(
			s,
			"SELECT amount FROM transactions",
		);
		expect(account?.balance).toBe(MAX);
		expect(tx?.amount).toBe(MAX);
	});

	it("rejects out-of-domain balances at the DB boundary", async () => {
		const s = freshStub();
		const alice = await seedIdentity(s, identity("alice"));
		for (const balance of [MAX + 1, -1, 1.5]) {
			expect(
				await rejects(
					s,
					"UPDATE accounts SET balance = ? WHERE id = ?",
					balance,
					alice.accountId,
				),
			).toBe(true);
		}
		const [row] = await query<{ balance: number }>(
			s,
			"SELECT balance FROM accounts WHERE id = ?",
			alice.accountId,
		);
		expect(row?.balance).toBe(0);
	});

	it("rejects out-of-domain Transaction amounts at the DB boundary", async () => {
		const s = freshStub();
		const alice = await seedIdentity(s, identity("alice"));
		const issuer = await administrativeIssuer(s);
		for (const amount of [MAX + 1, 0, -3, 2.5]) {
			expect(
				await rejects(
					s,
					"INSERT INTO transactions (id, kind, issuer_principal_id, source_account_id, destination_account_id, amount, committed_at) VALUES (?, 'ISSUE', ?, NULL, ?, ?, 1)",
					crypto.randomUUID(),
					issuer,
					alice.accountId,
					amount,
				),
			).toBe(true);
		}
		expect(await count(s, "transactions")).toBe(0);
	});
});

describe("schema structural invariants", () => {
	const INSERT_TX =
		"INSERT INTO transactions (id, kind, issuer_principal_id, source_account_id, destination_account_id, amount, committed_at) VALUES (?, ?, ?, ?, ?, 1, 1)";

	it("binds Transaction kind to its shape: ISSUE has an issuer and no source, TRANSFER a source and no issuer", async () => {
		const s = freshStub();
		const alice = await seedIdentity(s, identity("alice"));
		const bob = await seedIdentity(s, identity("bob"));
		const issuer = await administrativeIssuer(s);
		const cases: readonly [string, string | null, string | null][] = [
			["ISSUE", null, null],
			["ISSUE", issuer, alice.accountId],
			["TRANSFER", null, null],
			["TRANSFER", issuer, alice.accountId],
			["BURN", issuer, null],
			["DISTRIBUTION", null, alice.accountId],
		];
		for (const [kind, issuerId, source] of cases) {
			expect(
				await rejects(
					s,
					INSERT_TX,
					crypto.randomUUID(),
					kind,
					issuerId,
					source,
					bob.accountId,
				),
				`${kind} issuer=${issuerId} source=${source}`,
			).toBe(true);
		}
		expect(
			await rejects(
				s,
				INSERT_TX,
				crypto.randomUUID(),
				"ISSUE",
				issuer,
				null,
				bob.accountId,
			),
		).toBe(false);
		expect(
			await rejects(
				s,
				INSERT_TX,
				crypto.randomUUID(),
				"TRANSFER",
				null,
				alice.accountId,
				bob.accountId,
			),
		).toBe(false);
	});

	it("requires existing issuer Principal and Accounts on every Transaction", async () => {
		const s = freshStub();
		const alice = await seedIdentity(s, identity("alice"));
		const issuer = await administrativeIssuer(s);

		expect(
			await rejects(
				s,
				INSERT_TX,
				crypto.randomUUID(),
				"ISSUE",
				"ghost-principal",
				null,
				alice.accountId,
			),
		).toBe(true);
		expect(
			await rejects(
				s,
				INSERT_TX,
				crypto.randomUUID(),
				"ISSUE",
				issuer,
				null,
				"ghost-account",
			),
		).toBe(true);
		expect(
			await rejects(
				s,
				INSERT_TX,
				crypto.randomUUID(),
				"TRANSFER",
				null,
				"ghost-account",
				alice.accountId,
			),
		).toBe(true);
	});

	it("requires an existing owner Principal and keeps Account identity immutable and undeletable", async () => {
		const s = freshStub();
		const alice = await seedIdentity(s, identity("alice"));
		const bob = await seedIdentity(s, identity("bob"));

		expect(
			await rejects(
				s,
				"INSERT INTO accounts (id, owner_principal_id, balance, created_at, updated_at) VALUES (?, 'ghost', 0, 0, 0)",
				crypto.randomUUID(),
			),
		).toBe(true);
		expect(
			await rejects(
				s,
				"UPDATE accounts SET owner_principal_id = ? WHERE id = ?",
				bob.principalId,
				alice.accountId,
			),
		).toBe(true);
		expect(
			await rejects(s, "DELETE FROM accounts WHERE id = ?", alice.accountId),
		).toBe(true);
	});

	it("admits at most one default designation per Principal", async () => {
		const s = freshStub();
		const alice = await seedIdentity(s, identity("alice"));
		const second = crypto.randomUUID();
		await runInDurableObject(s, (_i, state) => {
			state.storage.sql.exec(
				"INSERT INTO accounts (id, owner_principal_id, balance, created_at, updated_at) VALUES (?, ?, 0, 0, 0)",
				second,
				alice.principalId,
			);
		});

		expect(
			await rejects(
				s,
				"INSERT INTO default_accounts (principal_id, account_id, created_at) VALUES (?, ?, 0)",
				alice.principalId,
				second,
			),
		).toBe(true);
		expect(
			await query(
				s,
				"SELECT account_id FROM default_accounts WHERE principal_id = ?",
				alice.principalId,
			),
		).toEqual([{ account_id: alice.accountId }]);
	});

	it("requires the designated Account to be owned by the same Principal", async () => {
		const s = freshStub();
		const alice = await seedIdentity(s, identity("alice"));
		const bare = crypto.randomUUID();
		await runInDurableObject(s, (_i, state) => {
			state.storage.sql.exec(
				"INSERT INTO principals (id, created_at) VALUES (?, 0)",
				bare,
			);
		});

		expect(
			await rejects(
				s,
				"INSERT INTO default_accounts (principal_id, account_id, created_at) VALUES (?, ?, 0)",
				bare,
				alice.accountId,
			),
		).toBe(true);
		expect(
			await rejects(
				s,
				"UPDATE default_accounts SET account_id = ? WHERE principal_id = ?",
				crypto.randomUUID(),
				alice.principalId,
			),
		).toBe(true);
		expect(
			await rejects(
				s,
				"DELETE FROM default_accounts WHERE principal_id = ?",
				alice.principalId,
			),
		).toBe(true);
	});

	it("keeps the administrative issuer mapping a single immutable row", async () => {
		const s = freshStub();
		const other = crypto.randomUUID();
		await runInDurableObject(s, (_i, state) => {
			state.storage.sql.exec(
				"INSERT INTO principals (id, created_at) VALUES (?, 0)",
				other,
			);
		});

		expect(
			await rejects(
				s,
				"INSERT INTO administrative_issuer (singleton, principal_id, created_at) VALUES (1, ?, 0)",
				other,
			),
		).toBe(true);
		expect(
			await rejects(
				s,
				"INSERT INTO administrative_issuer (singleton, principal_id, created_at) VALUES (2, ?, 0)",
				other,
			),
		).toBe(true);
		expect(
			await rejects(
				s,
				"UPDATE administrative_issuer SET principal_id = ?",
				other,
			),
		).toBe(true);
		expect(await rejects(s, "DELETE FROM administrative_issuer")).toBe(true);
	});

	it("rejects updates and deletes on every append-only table", async () => {
		const s = freshStub();
		await seedIdentity(s, identity("alice"));
		await fund(s, identity("alice"), 5);

		for (const statement of [
			"UPDATE transactions SET amount = 999",
			"DELETE FROM transactions",
			"UPDATE principals SET created_at = 9",
			"DELETE FROM principals",
			"UPDATE identity_bindings SET subject = 'x'",
			"DELETE FROM identity_bindings",
			"UPDATE idempotency_records SET stored_result = '{}'",
			"DELETE FROM idempotency_records",
		]) {
			expect(await rejects(s, statement), statement).toBe(true);
		}
		expect(await count(s, "transactions")).toBe(1);
		expect(await count(s, "idempotency_records")).toBe(1);
	});
});

describe("serialization and atomicity", () => {
	it("serializes concurrent transfers; no double-spend, no lost update", async () => {
		const s = freshStub();
		const alice = await seedIdentity(s, identity("alice"));
		const bob = await seedIdentity(s, identity("bob"));
		await fund(s, identity("alice"), 100);

		const attempts = await Promise.all(
			Array.from({ length: 20 }, () =>
				rpc(s).internalTransfer(DISCORD_ADAPTER_CALLER, idempotency(), {
					from: identity("alice"),
					to: identity("bob"),
					amount: 10,
				}),
			),
		);

		expect(attempts.filter((a) => a.status === 200)).toHaveLength(10);
		expect(attempts.filter((a) => a.status === 422)).toHaveLength(10);
		const balances = await query<{ id: string; balance: number }>(
			s,
			"SELECT id, balance FROM accounts",
		);
		expect(balances.find((a) => a.id === alice.accountId)?.balance).toBe(0);
		expect(balances.find((a) => a.id === bob.accountId)?.balance).toBe(100);
		expect(await count(s, "transactions")).toBe(11);
	});

	it("rolls back a section that fails after a partial write", async () => {
		const s = freshStub();
		const alice = await seedIdentity(s, identity("alice"));
		await runInDurableObject(s, async (_instance, state) => {
			const uow = createStorageUnitOfWork(state.storage, {
				nowMs: () => 1_234,
			});
			expect(() =>
				uow.transact((ctx) => {
					ctx.accounts.setBalance(rehydrate.accountId(alice.accountId), 50, 1);
					throw new Error("boom");
				}),
			).toThrow("boom");
		});

		expect(
			await rpc(s).internalBalance(DISCORD_ADAPTER_CALLER, identity("alice")),
		).toEqual({
			status: 200,
			body: { balance: 0 },
		});
	});

	it("preserves committed state across Durable Object eviction", async () => {
		const s = freshStub();
		await seedIdentity(s, identity("alice"));
		await seedIdentity(s, identity("bob"));
		await fund(s, identity("alice"), 100);
		await rpc(s).internalTransfer(DISCORD_ADAPTER_CALLER, idempotency(), {
			from: identity("alice"),
			to: identity("bob"),
			amount: 30,
		});

		await evictDurableObject(s);

		expect(
			await rpc(s).internalBalance(DISCORD_ADAPTER_CALLER, identity("alice")),
		).toEqual({ status: 200, body: { balance: 70 } });
		expect(
			await rpc(s).internalBalance(DISCORD_ADAPTER_CALLER, identity("bob")),
		).toEqual({ status: 200, body: { balance: 30 } });
		expect(await count(s, "transactions")).toBe(2);
	});
});

describe("production UnitOfWork", () => {
	it("permanently revokes context and repository handles at section close", async () => {
		const s = freshStub();
		await runInDurableObject(s, async (_i, state) => {
			const uow = createStorageUnitOfWork(state.storage, { nowMs: () => 1 });
			let escaped: TransactionContext["accounts"] | undefined;
			uow.transact((ctx) => {
				escaped = ctx.accounts;
			});
			expect(escaped).toBeDefined();
			expect(() => escaped?.totalSupply()).toThrow(/closed/);
			uow.transact(() => {
				expect(() => escaped?.findById(rehydrate.accountId("a"))).toThrow(
					/closed/,
				);
			});
		});
	});

	it("permanently revokes the TransactionContext itself after commit and rollback", async () => {
		const s = freshStub();
		await runInDurableObject(s, async (_i, state) => {
			const uow = createStorageUnitOfWork(state.storage, { nowMs: () => 1 });
			const keys: readonly (keyof TransactionContext)[] = [
				"nowMs",
				"principals",
				"accounts",
				"defaultAccounts",
				"transactions",
				"identityBindings",
				"administrativeIssuer",
				"idempotencyRecords",
				"registrationIntents",
			];
			let committed: TransactionContext | undefined;
			uow.transact((ctx) => {
				committed = ctx;
			});
			let aborted: TransactionContext | undefined;
			expect(() =>
				uow.transact((ctx) => {
					aborted = ctx;
					throw new Error("boom");
				}),
			).toThrow("boom");
			for (const ctx of [committed, aborted]) {
				for (const key of keys) {
					expect(() => (ctx as TransactionContext)[key]).toThrow(/closed/);
				}
			}
		});
	});

	it("rejects nested sections and object- or function-valued thenables with rollback", async () => {
		const s = freshStub();
		const alice = await seedIdentity(s, identity("alice"));
		await runInDurableObject(s, async (_i, state) => {
			const uow = createStorageUnitOfWork(state.storage, { nowMs: () => 1 });
			const id = rehydrate.accountId(alice.accountId);
			expect(() => uow.transact(() => uow.transact(() => 1))).toThrow(/nested/);
			expect(() =>
				uow.transact((ctx) => {
					ctx.accounts.setBalance(id, 9, 1);
					return Promise.resolve(1) as never;
				}),
			).toThrow(/PromiseLike/);
			// biome-ignore lint/suspicious/noThenProperty: intentional thenable fixture
			const functionThenable = Object.assign(() => 1, { then() {} });
			expect(() =>
				uow.transact((ctx) => {
					ctx.accounts.setBalance(id, 9, 1);
					return functionThenable as never;
				}),
			).toThrow(/PromiseLike/);
			expect(uow.transact((ctx) => ctx.accounts.findById(id)?.balance)).toBe(0);
		});
	});

	it("samples the clock once per section and hands out frozen records", async () => {
		const s = freshStub();
		const alice = await seedIdentity(s, identity("alice"));
		await runInDurableObject(s, async (_i, state) => {
			let samples = 0;
			const uow = createStorageUnitOfWork(state.storage, {
				nowMs: () => {
					samples += 1;
					return 7_777;
				},
			});
			uow.transact((ctx) => {
				const account = ctx.accounts.findById(
					rehydrate.accountId(alice.accountId),
				);
				expect(Object.isFrozen(account)).toBe(true);
				expect(() => {
					(account as { balance: number }).balance = 9;
				}).toThrow();
				expect(ctx.nowMs).toBe(7_777);
			});
			expect(samples).toBe(1);
		});
	});

	it("stamps the Transaction, balance, and replay record with the one frozen clock sample", async () => {
		const s = freshStub();
		const alice = await seedIdentity(s, identity("alice"));
		await runInDurableObject(s, async (instance) => {
			instance.clock = { nowMs: () => 5_555 };
		});
		await fund(s, identity("alice"), 5);

		const [tx] = await query<{ committed_at: number }>(
			s,
			"SELECT committed_at FROM transactions",
		);
		const [account] = await query<{ updated_at: number }>(
			s,
			"SELECT updated_at FROM accounts WHERE id = ?",
			alice.accountId,
		);
		const [record] = await query<{ created_at: number }>(
			s,
			"SELECT created_at FROM idempotency_records",
		);
		expect(tx?.committed_at).toBe(5_555);
		expect(account?.updated_at).toBe(5_555);
		expect(record?.created_at).toBe(5_555);
	});
});

describe("route-facing methods", () => {
	it("backstops the route-group caller inside the object", async () => {
		const s = freshStub();
		await seedIdentity(s, identity("alice"));
		const target = identity("alice");

		expect(
			await rpc(s).adminIssue(DISCORD_ADAPTER_CALLER, idempotency(), {
				target,
				amount: 1,
			}),
		).toMatchObject({ status: 403 });
		expect(
			await rpc(s).internalBalance(ADMIN_API_CALLER, target),
		).toMatchObject({
			status: 403,
		});
		expect(
			await rpc(s).internalHistory(ADMIN_API_CALLER, { ...target }),
		).toMatchObject({ status: 403 });
		expect(
			await rpc(s).internalTransfer(ADMIN_API_CALLER, idempotency(), {
				from: target,
				to: target,
				amount: 1,
			}),
		).toMatchObject({ status: 403 });
		expect(await count(s, "transactions")).toBe(0);
		expect(await count(s, "idempotency_records")).toBe(0);
	});

	it("adminIssue records the administrative issuer Principal and credits the target default Account", async () => {
		const s = freshStub();
		const alice = await seedIdentity(s, identity("alice"));
		const issuer = await administrativeIssuer(s);

		const response = await rpc(s).adminIssue(ADMIN_API_CALLER, idempotency(), {
			target: identity("alice"),
			amount: 40,
		});

		expect(response.status).toBe(200);
		const rows = await query<Record<string, unknown>>(
			s,
			"SELECT id, kind, issuer_principal_id, source_account_id, destination_account_id, amount FROM transactions",
		);
		expect(rows).toEqual([
			{
				id: (response.body as { transaction_id: string }).transaction_id,
				kind: "ISSUE",
				issuer_principal_id: issuer,
				source_account_id: null,
				destination_account_id: alice.accountId,
				amount: 40,
			},
		]);
	});

	it("adminIssue replays a duplicate without duplicating supply and 409s key reuse", async () => {
		const s = freshStub();
		await seedIdentity(s, identity("alice"));
		const params = idempotency("admin-key");

		const first = await rpc(s).adminIssue(ADMIN_API_CALLER, params, {
			target: identity("alice"),
			amount: 25,
		});
		const replay = await rpc(s).adminIssue(ADMIN_API_CALLER, params, {
			target: identity("alice"),
			amount: 25,
		});
		const reuse = await rpc(s).adminIssue(
			ADMIN_API_CALLER,
			{ ...params, requestFingerprint: "different" },
			{ target: identity("alice"), amount: 99 },
		);

		expect(replay).toEqual(first);
		expect(reuse).toMatchObject({
			status: 409,
			body: { error: "idempotency_key_reuse" },
		});
		expect(await count(s, "transactions")).toBe(1);
		const [supply] = await query<{ total: number }>(
			s,
			"SELECT SUM(balance) AS total FROM accounts",
		);
		expect(supply?.total).toBe(25);
		const [record] = await query<{ stored_result: string }>(
			s,
			"SELECT stored_result FROM idempotency_records WHERE technical_caller = ? AND idempotency_key = ?",
			ADMIN_API_CALLER,
			"admin-key",
		);
		expect(JSON.parse(record?.stored_result ?? "null")).toEqual(first);
	});

	it("adminIssue failures record nothing and leave the key retryable", async () => {
		const s = freshStub();
		const params = idempotency("retry-key");

		const unbound = await rpc(s).adminIssue(ADMIN_API_CALLER, params, {
			target: identity("later"),
			amount: 5,
		});
		expect(unbound).toMatchObject({
			status: 404,
			body: { error: "identity_not_bound" },
		});
		expect(await count(s, "idempotency_records")).toBe(0);

		await seedIdentity(s, identity("later"));
		const retried = await rpc(s).adminIssue(ADMIN_API_CALLER, params, {
			target: identity("later"),
			amount: 5,
		});
		expect(retried.status).toBe(200);
		expect(await count(s, "transactions")).toBe(1);
	});

	it("internalTransfer commits the TRANSFER and its transaction_id replay record atomically", async () => {
		const s = freshStub();
		await seedIdentity(s, identity("alice"));
		await seedIdentity(s, identity("bob"));
		await fund(s, identity("alice"), 50);
		const params = idempotency("transfer-key");

		const first = await rpc(s).internalTransfer(
			DISCORD_ADAPTER_CALLER,
			params,
			{
				from: identity("alice"),
				to: identity("bob"),
				amount: 20,
			},
		);
		const replay = await rpc(s).internalTransfer(
			DISCORD_ADAPTER_CALLER,
			params,
			{
				from: identity("alice"),
				to: identity("bob"),
				amount: 20,
			},
		);

		const [tx] = await query<{ id: string }>(
			s,
			"SELECT id FROM transactions WHERE kind = 'TRANSFER'",
		);
		expect(first).toEqual({
			status: 200,
			body: { transaction_id: tx?.id, from_balance: 30 },
		});
		expect(replay).toEqual(first);
		expect(await count(s, "transactions")).toBe(2);
	});

	it("leaves no replay record when the protected TRANSFER does not commit", async () => {
		const s = freshStub();
		await seedIdentity(s, identity("alice"));
		await seedIdentity(s, identity("bob"));
		const records = await count(s, "idempotency_records");

		const response = await rpc(s).internalTransfer(
			DISCORD_ADAPTER_CALLER,
			idempotency(),
			{ from: identity("alice"), to: identity("bob"), amount: 1 },
		);

		expect(response).toMatchObject({
			status: 422,
			body: { error: "insufficient_balance" },
		});
		expect(await count(s, "idempotency_records")).toBe(records);
		expect(await count(s, "transactions")).toBe(0);
	});

	it("rejects issuance that would overflow total supply as 422 overflow", async () => {
		const s = freshStub();
		await seedIdentity(s, identity("alice"));
		await seedIdentity(s, identity("bob"));
		await fund(s, identity("alice"), MAX);

		const response = await rpc(s).adminIssue(ADMIN_API_CALLER, idempotency(), {
			target: identity("bob"),
			amount: 1,
		});

		expect(response).toMatchObject({
			status: 422,
			body: { error: "overflow" },
		});
		const [supply] = await query<{ total: number }>(
			s,
			"SELECT SUM(balance) AS total FROM accounts",
		);
		expect(supply?.total).toBe(MAX);
	});
});
