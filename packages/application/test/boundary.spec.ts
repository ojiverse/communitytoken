import { describe, expect, it } from "vitest";
import { ok, payTreasury, transferToken, userSelector } from "../src/index";
import type {
	NewLedgerEntry,
	NewOperation,
	TransactionContext,
	WalletRepository,
} from "../src/ports";
import {
	type LedgerRecord,
	type OperationRecord,
	operationId,
	userId,
	type Wallet,
	type WalletId,
} from "../src/types";
import { TREASURY_ID } from "../src/use-cases/shared";
import { ADMIN, asAdmin, userActor } from "./fixtures";
import {
	createInMemoryFixture,
	createInMemoryState,
	createInMemoryUnitOfWork,
	fixedClock,
	stepClock,
} from "./in-memory";

function walletOf(
	state: ReturnType<typeof createInMemoryFixture>["state"],
	rawUserId: string,
) {
	const owner = userId(rawUserId);
	for (const wallet of state.wallets.values()) {
		if (wallet.ownerUserId === owner) return wallet;
	}
	return undefined;
}

describe("atomic boundary invariant", () => {
	it("rejects promise-returning work inside a section and persists nothing", () => {
		const state = createInMemoryState();
		const uow = createInMemoryUnitOfWork(state, fixedClock(1));
		const before = state.wallets.get(TREASURY_ID)?.balance;

		expect(() =>
			uow.transact((() => Promise.resolve(1) as unknown) as () => number),
		).toThrow(/synchronous/);
		expect(state.wallets.get(TREASURY_ID)?.balance).toBe(before);
	});

	it("rejects a section opened inside an open section", () => {
		const state = createInMemoryState();
		const uow = createInMemoryUnitOfWork(state, fixedClock(1));

		expect(() => uow.transact(() => uow.transact(() => 1))).toThrow(/nested/);
	});

	it("samples the clock once per section at entry: every timestamped write shares the value", () => {
		let calls = 0;
		const { app, state, seedUser } = createInMemoryFixture({
			clock: {
				nowMs() {
					calls += 1;
					return 4242;
				},
			},
		});
		seedUser("alice");

		app.issueToken(ADMIN, { amount: 10 });

		expect(calls).toBe(1);
		expect(state.operationRows[0]?.record.createdAt).toBe(4242);
		expect(state.ledgerRows[0]?.record.createdAt).toBe(4242);
		expect(state.wallets.get(TREASURY_ID)?.updatedAt).toBe(4242);

		app.distributeToken(ADMIN, { toUserId: userId("alice"), amount: 5 });
		expect(calls).toBe(2);
	});

	it("samples the clock exactly once for every section — rejected, read-only, or aborting", () => {
		let calls = 0;
		const { app, uow, seedUser } = createInMemoryFixture({
			clock: {
				nowMs() {
					calls += 1;
					return 4242;
				},
			},
		});
		seedUser("alice");

		const rejected = app.issueToken(ADMIN, { amount: -1 });
		expect(rejected.ok).toBe(false);
		const read = app.getBalance(
			userActor("alice"),
			userSelector(userId("alice")),
		);
		expect(read.ok).toBe(true);
		expect(() =>
			uow.transact(() => {
				throw new Error("boom");
			}),
		).toThrow(/boom/);

		expect(calls).toBe(3);
	});

	it("freezes now_ms at section entry: an advancing clock cannot split a section", () => {
		const fx = createInMemoryFixture({ clock: stepClock(1000, 5000) });
		fx.seedUser("alice");
		fx.seedUser("bob");
		fx.app.issueToken(ADMIN, { amount: 100 });
		fx.app.distributeToken(ADMIN, { toUserId: userId("alice"), amount: 100 });

		const r = fx.uow.transact((ctx) => {
			const t = transferToken(ctx, userActor("alice"), {
				toUserId: userId("bob"),
				amount: 10,
			});
			if (!t.ok) return t;
			const p = payTreasury(ctx, userActor("alice"), { amount: 5 });
			if (!p.ok) return p;
			return ok(ctx.nowMs);
		});

		// The third section samples 11000 once; both operations inside share
		// it even though the underlying clock advances 5000ms per read.
		expect(r).toEqual({ ok: true, value: 11000 });
		expect(
			fx.state.operationRows
				.slice(-2)
				.every((o) => o.record.createdAt === 11000),
		).toBe(true);
		expect(
			fx.state.ledgerRows.slice(-2).every((l) => l.record.createdAt === 11000),
		).toBe(true);
		expect(walletOf(fx.state, "alice")?.updatedAt).toBe(11000);
	});

	it("a forbidden call writes nothing", () => {
		const { app, state } = createInMemoryFixture();

		const r = app.issueToken(asAdmin(userActor("alice")), { amount: 10 });

		expect(r).toMatchObject({ ok: false, error: { type: "forbidden" } });
		expect(state.operationRows).toHaveLength(0);
		expect(state.ledgerRows).toHaveLength(0);
	});
});

describe("composable transaction context", () => {
	it("an outer section composes use cases under one frozen now_ms", () => {
		let calls = 0;
		const fx = createInMemoryFixture({
			clock: {
				nowMs() {
					calls += 1;
					return 777;
				},
			},
		});
		fx.seedUser("alice");
		fx.seedUser("bob");
		fx.app.issueToken(ADMIN, { amount: 100 });
		fx.app.distributeToken(ADMIN, { toUserId: userId("alice"), amount: 100 });
		expect(calls).toBe(2);

		// The PR-3 shape: outer orchestration owns the section and composes
		// use-case operations with its own writes (e.g. an idempotency record).
		const r = fx.uow.transact((ctx) => {
			const t = transferToken(ctx, userActor("alice"), {
				toUserId: userId("bob"),
				amount: 10,
			});
			if (!t.ok) return t;
			const p = payTreasury(ctx, userActor("alice"), { amount: 5 });
			if (!p.ok) return p;
			return ok({ transfer: t.value, payment: p.value });
		});

		expect(r.ok).toBe(true);
		expect(calls).toBe(3);
		const ops = fx.state.operationRows.slice(-2);
		expect(ops.map((o) => o.record.kind)).toEqual([
			"P2P_TRANSFER",
			"TREASURY_PAYMENT",
		]);
		expect(ops.every((o) => o.record.createdAt === 777)).toBe(true);
		expect(
			fx.state.ledgerRows.slice(-2).every((l) => l.record.createdAt === 777),
		).toBe(true);
		expect(walletOf(fx.state, "alice")?.balance).toBe(85);
		expect(walletOf(fx.state, "alice")?.updatedAt).toBe(777);
	});

	it("a rejection is a value: the outer section decides what else commits", () => {
		const fx = createInMemoryFixture();
		fx.seedUser("alice");
		fx.seedUser("bob");
		fx.app.issueToken(ADMIN, { amount: 100 });
		fx.app.distributeToken(ADMIN, { toUserId: userId("alice"), amount: 100 });
		const opsBefore = fx.state.operationRows.length;

		// The rejected op writes nothing itself; the committed transfer is the
		// outer section's own decision, as is a stored rejection result.
		const r = fx.uow.transact((ctx) => {
			const t = transferToken(ctx, userActor("alice"), {
				toUserId: userId("bob"),
				amount: 10,
			});
			if (!t.ok) return t;
			return payTreasury(ctx, userActor("alice"), { amount: 9999 });
		});

		expect(r).toMatchObject({
			ok: false,
			error: { type: "rejected", code: "INSUFFICIENT_BALANCE" },
		});
		expect(walletOf(fx.state, "alice")?.balance).toBe(90);
		expect(walletOf(fx.state, "bob")?.balance).toBe(10);
		expect(fx.state.operationRows).toHaveLength(opsBefore + 1);
	});

	it("a throw inside the composed section rolls back every write", () => {
		const fx = createInMemoryFixture();
		fx.seedUser("alice");
		fx.seedUser("bob");
		fx.app.issueToken(ADMIN, { amount: 100 });
		fx.app.distributeToken(ADMIN, { toUserId: userId("alice"), amount: 100 });
		const opsBefore = fx.state.operationRows.length;
		const ledgerBefore = fx.state.ledgerRows.length;

		expect(() =>
			fx.uow.transact((ctx) => {
				const t = transferToken(ctx, userActor("alice"), {
					toUserId: userId("bob"),
					amount: 10,
				});
				if (!t.ok) throw new Error("unexpected rejection");
				throw new Error("abort after accepted op");
			}),
		).toThrow(/abort/);

		expect(walletOf(fx.state, "alice")?.balance).toBe(100);
		expect(walletOf(fx.state, "bob")?.balance).toBe(0);
		expect(fx.state.operationRows).toHaveLength(opsBefore);
		expect(fx.state.ledgerRows).toHaveLength(ledgerBefore);
	});
});

describe("in-memory UnitOfWork rollback", () => {
	function fixtureWithFault() {
		let fail: "operations.insert" | "ledger.insert" | null = null;
		const fx = createInMemoryFixture({
			wrapScope: (scope) => ({
				...scope,
				operations: {
					...scope.operations,
					insert(record: NewOperation) {
						if (fail === "operations.insert") {
							throw new Error("injected operations.insert failure");
						}
						return scope.operations.insert(record);
					},
				},
				ledger: {
					...scope.ledger,
					insert(entry: NewLedgerEntry) {
						if (fail === "ledger.insert") {
							throw new Error("injected ledger.insert failure");
						}
						return scope.ledger.insert(entry);
					},
				},
			}),
		});
		fx.seedUser("alice");
		fx.seedUser("bob");
		fx.app.issueToken(ADMIN, { amount: 100 });
		fx.app.distributeToken(ADMIN, { toUserId: userId("alice"), amount: 100 });
		return {
			fx,
			setFail(value: typeof fail) {
				fail = value;
			},
		};
	}

	function expectUnchanged(
		fx: ReturnType<typeof fixtureWithFault>["fx"],
		counts: { readonly ops: number; readonly ledger: number },
	) {
		expect(walletOf(fx.state, "alice")?.balance).toBe(100);
		expect(walletOf(fx.state, "bob")?.balance).toBe(0);
		expect(fx.state.operationRows).toHaveLength(counts.ops);
		expect(fx.state.ledgerRows).toHaveLength(counts.ledger);
	}

	it("balance writes roll back when the operation insert fails", () => {
		const { fx, setFail } = fixtureWithFault();
		const counts = {
			ops: fx.state.operationRows.length,
			ledger: fx.state.ledgerRows.length,
		};
		setFail("operations.insert");

		expect(() =>
			fx.app.transferToken(userActor("alice"), {
				toUserId: userId("bob"),
				amount: 10,
			}),
		).toThrow(/injected/);

		expectUnchanged(fx, counts);
	});

	it("balance and operation writes roll back when the ledger insert fails", () => {
		const { fx, setFail } = fixtureWithFault();
		const counts = {
			ops: fx.state.operationRows.length,
			ledger: fx.state.ledgerRows.length,
		};
		setFail("ledger.insert");

		expect(() =>
			fx.app.transferToken(userActor("alice"), {
				toUserId: userId("bob"),
				amount: 10,
			}),
		).toThrow(/injected/);

		expectUnchanged(fx, counts);
	});

	it("a callback that mutates then throws persists nothing", () => {
		const { fx } = fixtureWithFault();
		const counts = {
			ops: fx.state.operationRows.length,
			ledger: fx.state.ledgerRows.length,
		};

		expect(() =>
			fx.uow.transact((ctx) => {
				ctx.wallets.setBalance(TREASURY_ID, 9999, ctx.nowMs);
				throw new Error("abort");
			}),
		).toThrow(/abort/);

		expect(fx.state.wallets.get(TREASURY_ID)?.balance).toBe(0);
		expectUnchanged(fx, counts);
	});

	it("a callback that mutates then returns a PromiseLike persists nothing", () => {
		const { fx } = fixtureWithFault();
		const counts = {
			ops: fx.state.operationRows.length,
			ledger: fx.state.ledgerRows.length,
		};

		expect(() =>
			fx.uow.transact((ctx) => {
				ctx.wallets.setBalance(TREASURY_ID, 9999, ctx.nowMs);
				return Promise.resolve(0) as unknown as number;
			}),
		).toThrow(/synchronous/);

		expect(fx.state.wallets.get(TREASURY_ID)?.balance).toBe(0);
		expectUnchanged(fx, counts);
	});

	it("a callback that returns a function-valued thenable persists nothing", () => {
		const { fx } = fixtureWithFault();
		const counts = {
			ops: fx.state.operationRows.length,
			ledger: fx.state.ledgerRows.length,
		};
		// biome-ignore lint/suspicious/noThenProperty: the test intentionally constructs a thenable to exercise the runtime guard
		const thenable = Object.assign(() => {}, { then() {} });

		expect(() =>
			fx.uow.transact((ctx) => {
				ctx.wallets.setBalance(TREASURY_ID, 9999, ctx.nowMs);
				return thenable as unknown as number;
			}),
		).toThrow(/synchronous/);

		expect(fx.state.wallets.get(TREASURY_ID)?.balance).toBe(0);
		expectUnchanged(fx, counts);
	});
});

describe("closed transaction context", () => {
	it("a captured context cannot read or write after the section commits", () => {
		const fx = createInMemoryFixture();
		fx.seedUser("alice");
		let captured!: TransactionContext;
		fx.uow.transact((ctx) => {
			captured = ctx;
			return 0;
		});

		expect(() => captured.wallets.findById(TREASURY_ID)).toThrow(/closed/);
		expect(() => captured.wallets.setBalance(TREASURY_ID, 9999, 1)).toThrow(
			/closed/,
		);
		expect(() => captured.wallets.totalSupply()).toThrow(/closed/);
		expect(() =>
			captured.operations.listForWallet(TREASURY_ID, null, 10),
		).toThrow(/closed/);
		expect(() =>
			captured.ledger.insert({
				operationId: operationId("op-leaked"),
				fromWalletId: TREASURY_ID,
				toWalletId: TREASURY_ID,
				amount: 1,
				createdAt: 0,
			}),
		).toThrow(/closed/);

		expect(fx.state.wallets.get(TREASURY_ID)?.balance).toBe(0);
		expect(fx.state.operationRows).toHaveLength(0);
		expect(fx.state.ledgerRows).toHaveLength(0);
	});

	it("a captured context is unusable after the section aborts", () => {
		const fx = createInMemoryFixture();
		let captured!: TransactionContext;
		expect(() =>
			fx.uow.transact((ctx) => {
				captured = ctx;
				throw new Error("abort");
			}),
		).toThrow(/abort/);

		expect(() => captured.wallets.totalSupply()).toThrow(/closed/);
		expect(() => captured.wallets.setBalance(TREASURY_ID, 1, 1)).toThrow(
			/closed/,
		);
	});

	it("every property read on a captured context throws after the section commits", () => {
		const fx = createInMemoryFixture();
		let captured!: TransactionContext;
		fx.uow.transact((ctx) => {
			captured = ctx;
			return 0;
		});

		expect(() => captured.nowMs).toThrow(/closed/);
		expect(() => captured.wallets).toThrow(/closed/);
		expect(() => captured.operations).toThrow(/closed/);
		expect(() => captured.ledger).toThrow(/closed/);
		expect(() => captured.identityBindings).toThrow(/closed/);
		expect(() => captured.idempotencyRecords).toThrow(/closed/);
	});

	it("every property read on a captured context throws after the section aborts", () => {
		const fx = createInMemoryFixture();
		let captured!: TransactionContext;
		expect(() =>
			fx.uow.transact((ctx) => {
				captured = ctx;
				throw new Error("abort");
			}),
		).toThrow(/abort/);

		expect(() => captured.nowMs).toThrow(/closed/);
		expect(() => captured.wallets).toThrow(/closed/);
		expect(() => captured.operations).toThrow(/closed/);
		expect(() => captured.ledger).toThrow(/closed/);
		expect(() => captured.identityBindings).toThrow(/closed/);
		expect(() => captured.idempotencyRecords).toThrow(/closed/);
	});

	it("a captured context stays dead while a later section is open", () => {
		const fx = createInMemoryFixture();
		let stale!: TransactionContext;
		fx.uow.transact((ctx) => {
			stale = ctx;
			return 0;
		});

		expect(() =>
			fx.uow.transact((ctx) => {
				void stale.nowMs;
				ctx.wallets.totalSupply();
			}),
		).toThrow(/closed/);
	});

	it("a captured repository handle is revoked with its section", () => {
		const fx = createInMemoryFixture();
		let wallets!: WalletRepository;
		fx.uow.transact((ctx) => {
			wallets = ctx.wallets;
			return 0;
		});

		expect(() => wallets.findById(TREASURY_ID)).toThrow(/closed/);
		expect(() => wallets.setBalance(TREASURY_ID, 5, 0)).toThrow(/closed/);
	});

	it("a later section works normally after an earlier context was revoked", () => {
		const fx = createInMemoryFixture();
		let stale!: TransactionContext;
		fx.uow.transact((ctx) => {
			stale = ctx;
			return 0;
		});

		const r = fx.app.issueToken(ADMIN, { amount: 10 });

		expect(r.ok).toBe(true);
		expect(fx.state.wallets.get(TREASURY_ID)?.balance).toBe(10);
		expect(() => stale.wallets.totalSupply()).toThrow(/closed/);
	});

	it("a stale context stays dead while a later section is open", () => {
		const fx = createInMemoryFixture();
		fx.app.issueToken(ADMIN, { amount: 50 });
		let stale!: TransactionContext;
		fx.uow.transact((ctx) => {
			stale = ctx;
			return 0;
		});

		// A's context must not revive while B is open — and it must not
		// bypass B's staging to mutate committed state.
		expect(() =>
			fx.uow.transact((ctx) => {
				stale.wallets.setBalance(TREASURY_ID, 9999, ctx.nowMs);
				ctx.wallets.setBalance(TREASURY_ID, 1, ctx.nowMs);
				throw new Error("abort B");
			}),
		).toThrow(/closed/);

		expect(fx.state.wallets.get(TREASURY_ID)?.balance).toBe(50);
	});

	it("a stale repository handle cannot read or write while a later section is open", () => {
		const fx = createInMemoryFixture();
		let staleWallets!: WalletRepository;
		fx.uow.transact((ctx) => {
			staleWallets = ctx.wallets;
			return 0;
		});

		expect(() =>
			fx.uow.transact(() => staleWallets.findById(TREASURY_ID)),
		).toThrow(/closed/);
		expect(() => fx.uow.transact(() => staleWallets.totalSupply())).toThrow(
			/closed/,
		);
	});
});

describe("repository value integrity", () => {
	it("a returned wallet cannot alias-mutate storage before an abort", () => {
		const fx = createInMemoryFixture();
		fx.app.issueToken(ADMIN, { amount: 10 });

		expect(() =>
			fx.uow.transact((ctx) => {
				const wallet = ctx.wallets.findById(TREASURY_ID);
				if (wallet === undefined) throw new Error("missing");
				Object.assign(wallet, { balance: 9999 });
				throw new Error("abort");
			}),
		).toThrow();

		expect(fx.state.wallets.get(TREASURY_ID)?.balance).toBe(10);
	});

	it("a wallet handed out inside a section stays frozen after commit", () => {
		const fx = createInMemoryFixture();
		fx.app.issueToken(ADMIN, { amount: 10 });
		let wallet!: Wallet;
		fx.uow.transact((ctx) => {
			const found = ctx.wallets.findById(TREASURY_ID);
			if (found === undefined) throw new Error("missing");
			wallet = found;
			return 0;
		});

		expect(() => Object.assign(wallet, { balance: 0 })).toThrow();
		expect(fx.state.wallets.get(TREASURY_ID)?.balance).toBe(10);
	});

	it("records returned by insert cannot alias-mutate stored rows", () => {
		const fx = createInMemoryFixture();
		let op!: OperationRecord;
		let entry!: LedgerRecord;
		fx.uow.transact((ctx) => {
			op = ctx.operations.insert({
				kind: "TOKEN_ISSUANCE",
				metadata: null,
				actor: ADMIN,
				createdAt: ctx.nowMs,
			});
			entry = ctx.ledger.insert({
				operationId: op.id,
				fromWalletId: TREASURY_ID,
				toWalletId: TREASURY_ID,
				amount: 1,
				createdAt: ctx.nowMs,
			});
			return 0;
		});

		expect(() => Object.assign(op, { kind: "P2P_TRANSFER" })).toThrow();
		expect(() => Object.assign(entry, { amount: 9999 })).toThrow();
		expect(fx.state.operationRows[0]?.record.kind).toBe("TOKEN_ISSUANCE");
		expect(fx.state.ledgerRows[0]?.record.amount).toBe(1);
	});
});

describe("impossible postconditions", () => {
	function fixtureWithVanishingWallet() {
		let vanish = false;
		let target: WalletId | null = null;
		const fx = createInMemoryFixture({
			wrapScope: (scope) => ({
				...scope,
				wallets: {
					...scope.wallets,
					findById(id: WalletId) {
						if (vanish && id === target) return undefined;
						return scope.wallets.findById(id);
					},
				},
			}),
		});
		const alice = fx.seedUser("alice");
		target = alice.id;
		fx.seedUser("bob");
		fx.app.issueToken(ADMIN, { amount: 100 });
		fx.app.distributeToken(ADMIN, { toUserId: userId("alice"), amount: 100 });
		return {
			fx,
			setVanish(value: boolean) {
				vanish = value;
			},
		};
	}

	it("an accepted transfer whose source wallet vanishes fails loudly and rolls back", () => {
		const { fx, setVanish } = fixtureWithVanishingWallet();
		const ops = fx.state.operationRows.length;
		const led = fx.state.ledgerRows.length;
		setVanish(true);

		expect(() =>
			fx.app.transferToken(userActor("alice"), {
				toUserId: userId("bob"),
				amount: 10,
			}),
		).toThrow(/disappeared/);

		setVanish(false);
		expect(walletOf(fx.state, "alice")?.balance).toBe(100);
		expect(walletOf(fx.state, "bob")?.balance).toBe(0);
		expect(fx.state.operationRows).toHaveLength(ops);
		expect(fx.state.ledgerRows).toHaveLength(led);
	});

	it("an accepted payment whose source wallet vanishes fails loudly and rolls back", () => {
		const { fx, setVanish } = fixtureWithVanishingWallet();
		const ops = fx.state.operationRows.length;
		const led = fx.state.ledgerRows.length;
		setVanish(true);

		expect(() =>
			fx.app.payTreasury(userActor("alice"), { amount: 10 }),
		).toThrow(/disappeared/);

		setVanish(false);
		expect(walletOf(fx.state, "alice")?.balance).toBe(100);
		expect(fx.state.operationRows).toHaveLength(ops);
		expect(fx.state.ledgerRows).toHaveLength(led);
	});
});
