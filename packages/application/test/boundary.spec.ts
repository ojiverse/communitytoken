import { describe, expect, it } from "vitest";
import type {
	AccountRepository,
	TransactionContext,
	TransactionScope,
} from "../src/ports";
import {
	type Account,
	type AccountId,
	ADMIN_API_CALLER,
	type AdministrativeCaller,
	type ExternalIdentity,
	ok,
	type TransactionRecord,
} from "../src/types";
import { getBalance } from "../src/use-cases/get-balance";
import { issueToIdentity } from "../src/use-cases/issue-to-identity";
import { transferBetweenIdentities } from "../src/use-cases/transfer-between-identities";
import {
	createInMemoryFixture,
	createInMemoryState,
	createInMemoryUnitOfWork,
	fixedClock,
	stepClock,
} from "./in-memory";

type Fixture = ReturnType<typeof createInMemoryFixture>;

function issue(fx: Fixture, target: ExternalIdentity, amount: number) {
	return fx.uow.transact((ctx) =>
		issueToIdentity(ctx, ADMIN_API_CALLER, { target, amount }),
	);
}

/** A fixture with alice funded to 100 and an unfunded bob. */
function funded(options?: Parameters<typeof createInMemoryFixture>[0]) {
	const fx = createInMemoryFixture(options);
	const alice = fx.seedIdentity("alice");
	const bob = fx.seedIdentity("bob");
	const r = issue(fx, alice.identity, 100);
	if (!r.ok) throw new Error("funding failed");
	return { fx, alice, bob };
}

describe("atomic boundary invariant", () => {
	it("rejects promise-returning work inside a section and persists nothing", () => {
		const state = createInMemoryState();
		const uow = createInMemoryUnitOfWork(state, fixedClock(1));

		expect(() =>
			uow.transact((ctx) => {
				ctx.principals.insert({ createdAt: ctx.nowMs });
				return Promise.resolve(1) as unknown as number;
			}),
		).toThrow(/synchronous/);
		expect(state.principals.size).toBe(0);
	});

	it("rejects a function-valued thenable and persists nothing", () => {
		const state = createInMemoryState();
		const uow = createInMemoryUnitOfWork(state, fixedClock(1));
		// biome-ignore lint/suspicious/noThenProperty: the test intentionally constructs a thenable to exercise the runtime guard
		const thenable = Object.assign(() => {}, { then() {} });

		expect(() =>
			uow.transact((ctx) => {
				ctx.principals.insert({ createdAt: ctx.nowMs });
				return thenable as unknown as number;
			}),
		).toThrow(/synchronous/);
		expect(state.principals.size).toBe(0);
	});

	it("rejects a section opened inside an open section", () => {
		const state = createInMemoryState();
		const uow = createInMemoryUnitOfWork(state, fixedClock(1));

		expect(() => uow.transact(() => uow.transact(() => 1))).toThrow(/nested/);
	});

	it("samples the clock once per section at entry: every timestamped write shares the value", () => {
		let calls = 0;
		const fx = createInMemoryFixture({
			clock: {
				nowMs() {
					calls += 1;
					return 4242;
				},
			},
		});
		const alice = fx.seedIdentity("alice");

		issue(fx, alice.identity, 10);

		expect(calls).toBe(1);
		expect(fx.state.transactionRows[0]?.record.committedAt).toBe(4242);
		expect(fx.state.accounts.get(alice.accountId)?.updatedAt).toBe(4242);
	});

	it("samples the clock exactly once for every section — rejected, read-only, or aborting", () => {
		let calls = 0;
		const fx = createInMemoryFixture({
			clock: {
				nowMs() {
					calls += 1;
					return 4242;
				},
			},
		});
		const alice = fx.seedIdentity("alice");

		expect(issue(fx, alice.identity, -1).ok).toBe(false);
		expect(fx.uow.transact((ctx) => getBalance(ctx, alice.identity)).ok).toBe(
			true,
		);
		expect(() =>
			fx.uow.transact(() => {
				throw new Error("boom");
			}),
		).toThrow(/boom/);

		expect(calls).toBe(3);
	});

	it("a forbidden administrative call writes nothing", () => {
		const fx = createInMemoryFixture();
		const alice = fx.seedIdentity("alice");

		const r = fx.uow.transact((ctx) =>
			issueToIdentity(ctx, "discord-adapter" as AdministrativeCaller, {
				target: alice.identity,
				amount: 10,
			}),
		);

		expect(r).toMatchObject({ ok: false, error: { type: "forbidden" } });
		expect(fx.state.transactionRows).toHaveLength(0);
	});
});

describe("composable transaction context", () => {
	it("an outer section composes use cases under one frozen now_ms", () => {
		const { fx, alice, bob } = funded({ clock: stepClock(1000, 5000) });

		const r = fx.uow.transact((ctx) => {
			const t = transferBetweenIdentities(ctx, {
				from: alice.identity,
				to: bob.identity,
				amount: 10,
			});
			if (!t.ok) return t;
			const i = issueToIdentity(ctx, ADMIN_API_CALLER, {
				target: bob.identity,
				amount: 5,
			});
			if (!i.ok) return i;
			return ok(ctx.nowMs);
		});

		// The second section samples 6000 once; both Transactions inside share
		// it even though the underlying clock advances 5000ms per read.
		expect(r).toEqual({ ok: true, value: 6000 });
		const last = fx.state.transactionRows.slice(-2).map(({ record }) => record);
		expect(last.map((t) => [t.kind, t.committedAt])).toEqual([
			["TRANSFER", 6000],
			["ISSUE", 6000],
		]);
		expect(fx.state.accounts.get(bob.accountId)).toMatchObject({
			balance: 15,
			updatedAt: 6000,
		});
	});

	it("a rejection is a value: the outer section decides what else commits", () => {
		const { fx, alice, bob } = funded();
		const before = fx.state.transactionRows.length;

		const r = fx.uow.transact((ctx) => {
			const t = transferBetweenIdentities(ctx, {
				from: alice.identity,
				to: bob.identity,
				amount: 10,
			});
			if (!t.ok) return t;
			return transferBetweenIdentities(ctx, {
				from: alice.identity,
				to: bob.identity,
				amount: 9999,
			});
		});

		expect(r).toMatchObject({
			ok: false,
			error: { type: "rejected", code: "INSUFFICIENT_BALANCE" },
		});
		expect(fx.balanceOf(alice.accountId)).toBe(90);
		expect(fx.balanceOf(bob.accountId)).toBe(10);
		expect(fx.state.transactionRows).toHaveLength(before + 1);
	});

	it("a throw inside the composed section rolls back every write", () => {
		const { fx, alice, bob } = funded();
		const before = fx.state.transactionRows.length;

		expect(() =>
			fx.uow.transact((ctx) => {
				const t = transferBetweenIdentities(ctx, {
					from: alice.identity,
					to: bob.identity,
					amount: 10,
				});
				if (!t.ok) throw new Error("unexpected rejection");
				throw new Error("abort after accepted transfer");
			}),
		).toThrow(/abort/);

		expect(fx.balanceOf(alice.accountId)).toBe(100);
		expect(fx.balanceOf(bob.accountId)).toBe(0);
		expect(fx.state.transactionRows).toHaveLength(before);
	});
});

describe("closed transaction context", () => {
	it("a captured context cannot read or write after the section commits", () => {
		const { fx, alice } = funded();
		let captured!: TransactionContext;
		fx.uow.transact((ctx) => {
			captured = ctx;
			return 0;
		});

		expect(() => captured.accounts.findById(alice.accountId)).toThrow(/closed/);
		expect(() =>
			captured.accounts.setBalance(alice.accountId, 9999, 1),
		).toThrow(/closed/);
		expect(() => captured.accounts.totalSupply()).toThrow(/closed/);
		expect(() =>
			captured.transactions.listForAccount(alice.accountId, null, 10),
		).toThrow(/closed/);
		expect(() =>
			captured.transactions.insert({
				kind: "ISSUE",
				issuerPrincipalId: fx.adminIssuer,
				destinationAccountId: alice.accountId,
				amount: 1,
				committedAt: 0,
			}),
		).toThrow(/closed/);

		expect(fx.balanceOf(alice.accountId)).toBe(100);
		expect(fx.state.transactionRows).toHaveLength(1);
	});

	it("every property read on a captured context throws after commit and after abort", () => {
		const fx = createInMemoryFixture();
		let committed!: TransactionContext;
		fx.uow.transact((ctx) => {
			committed = ctx;
			return 0;
		});
		let aborted!: TransactionContext;
		expect(() =>
			fx.uow.transact((ctx) => {
				aborted = ctx;
				throw new Error("abort");
			}),
		).toThrow(/abort/);

		for (const captured of [committed, aborted]) {
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
			for (const key of keys) {
				expect(() => captured[key]).toThrow(/closed/);
			}
		}
	});

	it("a stale context stays dead while a later section is open and cannot bypass its staging", () => {
		const { fx, alice } = funded();
		let stale!: TransactionContext;
		fx.uow.transact((ctx) => {
			stale = ctx;
			return 0;
		});

		expect(() =>
			fx.uow.transact((ctx) => {
				stale.accounts.setBalance(alice.accountId, 9999, ctx.nowMs);
				ctx.accounts.setBalance(alice.accountId, 1, ctx.nowMs);
				throw new Error("abort B");
			}),
		).toThrow(/closed/);

		expect(fx.balanceOf(alice.accountId)).toBe(100);
	});

	it("a captured repository handle is revoked with its section, and later sections work normally", () => {
		const { fx, alice } = funded();
		let accounts!: AccountRepository;
		fx.uow.transact((ctx) => {
			accounts = ctx.accounts;
			return 0;
		});

		expect(() => accounts.findById(alice.accountId)).toThrow(/closed/);
		expect(() =>
			fx.uow.transact(() => accounts.findById(alice.accountId)),
		).toThrow(/closed/);
		expect(issue(fx, alice.identity, 10).ok).toBe(true);
		expect(fx.balanceOf(alice.accountId)).toBe(110);
	});
});

describe("repository value integrity", () => {
	it("a returned Account cannot alias-mutate storage, inside or after a section", () => {
		const { fx, alice } = funded();
		let handedOut!: Account;

		expect(() =>
			fx.uow.transact((ctx) => {
				const account = ctx.accounts.findById(alice.accountId);
				if (account === undefined) throw new Error("missing");
				handedOut = account;
				Object.assign(account, { balance: 9999 });
				return 0;
			}),
		).toThrow();

		expect(() => Object.assign(handedOut, { balance: 0 })).toThrow();
		expect(fx.balanceOf(alice.accountId)).toBe(100);
	});

	it("Transaction records returned by insert are frozen", () => {
		const { fx, alice } = funded();
		let record!: TransactionRecord;
		fx.uow.transact((ctx) => {
			record = ctx.transactions.insert({
				kind: "TRANSFER",
				sourceAccountId: alice.accountId,
				destinationAccountId: alice.accountId,
				amount: 1,
				committedAt: ctx.nowMs,
			});
			return 0;
		});

		expect(() => Object.assign(record, { amount: 9999 })).toThrow();
		expect(fx.state.transactionRows.at(-1)?.record.amount).toBe(1);
	});
});

describe("default-Account designation floor (in-memory parity with the schema)", () => {
	it("admits at most one designation per Principal", () => {
		const fx = createInMemoryFixture();
		const alice = fx.seedIdentity("alice");
		const second = fx.seedAccount(alice.principalId);

		expect(() =>
			fx.uow.transact((ctx) =>
				ctx.defaultAccounts.designate({
					principalId: alice.principalId,
					accountId: second,
					createdAt: ctx.nowMs,
				}),
			),
		).toThrow(/already has a default/);
		expect(fx.state.defaultAccounts.get(alice.principalId)).toBe(
			alice.accountId,
		);
	});

	it("rejects designating an Account owned by another Principal", () => {
		const fx = createInMemoryFixture();
		const alice = fx.seedIdentity("alice");
		const bare = fx.seedPrincipal();

		expect(() =>
			fx.uow.transact((ctx) =>
				ctx.defaultAccounts.designate({
					principalId: bare,
					accountId: alice.accountId,
					createdAt: ctx.nowMs,
				}),
			),
		).toThrow(/not owned/);
		expect(fx.state.defaultAccounts.has(bare)).toBe(false);
	});
});

describe("impossible postconditions", () => {
	it("an accepted transfer whose source Account vanishes fails loudly and rolls back", () => {
		let armed = false;
		const written = new Set<AccountId>();
		const { fx, alice, bob } = funded({
			wrapScope: (scope): TransactionScope => ({
				...scope,
				accounts: {
					...scope.accounts,
					findById(id: AccountId) {
						return written.has(id) ? undefined : scope.accounts.findById(id);
					},
					setBalance(id: AccountId, balance: number, updatedAt: number) {
						scope.accounts.setBalance(id, balance, updatedAt);
						if (armed) written.add(id);
					},
				},
			}),
		});
		const before = fx.state.transactionRows.length;
		armed = true;

		expect(() =>
			fx.uow.transact((ctx) =>
				transferBetweenIdentities(ctx, {
					from: alice.identity,
					to: bob.identity,
					amount: 10,
				}),
			),
		).toThrow(/disappeared/);

		expect(fx.balanceOf(alice.accountId)).toBe(100);
		expect(fx.balanceOf(bob.accountId)).toBe(0);
		expect(fx.state.transactionRows).toHaveLength(before);
	});
});
