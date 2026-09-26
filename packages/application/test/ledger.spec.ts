import {
	defineEconomicContract,
	type EconomicHarness,
	type TransactionView,
} from "@communitytoken/economic-contract";
import { describe, expect, it } from "vitest";
import type { TransactionScope } from "../src/ports";
import { rehydrate, type TransactionRecord } from "../src/types";
import { executeIssue, executeTransfer } from "../src/use-cases/ledger";
import {
	createInMemoryFixture,
	createInMemoryState,
	createInMemoryUnitOfWork,
	stepClock,
} from "./in-memory";

function view(record: TransactionRecord): TransactionView {
	return { ...record };
}

/**
 * The primitive ledger operations over the in-memory UnitOfWork as a
 * contract-suite adapter: the application's evaluate/persist path must
 * satisfy the same storage-independent contract as the kernel reference.
 */
function createApplicationLedgerHarness(): EconomicHarness {
	let state = createInMemoryState();
	let uow = createInMemoryUnitOfWork(state, stepClock());
	return {
		async reset() {
			state = createInMemoryState();
			uow = createInMemoryUnitOfWork(state, stepClock());
		},
		async createPrincipal() {
			return uow.transact(
				(ctx) => ctx.principals.insert({ createdAt: ctx.nowMs }).id,
			);
		},
		async createAccount(owner) {
			return uow.transact(
				(ctx) =>
					ctx.accounts.insert({
						ownerPrincipalId: rehydrate.principalId(owner),
						createdAt: ctx.nowMs,
					}).id,
			);
		},
		async apply(command) {
			const result = uow.transact((ctx) =>
				command.kind === "ISSUE"
					? executeIssue(ctx, {
							issuerPrincipalId: rehydrate.principalId(
								command.issuerPrincipalId,
							),
							destinationAccountId: rehydrate.accountId(
								command.destinationAccountId,
							),
							amount: command.amount,
						})
					: executeTransfer(ctx, {
							sourceAccountId: rehydrate.accountId(command.sourceAccountId),
							destinationAccountId: rehydrate.accountId(
								command.destinationAccountId,
							),
							amount: command.amount,
						}),
			);
			if (result.ok) {
				return { accepted: true, transactionId: result.value.transactionId };
			}
			if (result.error.type !== "rejected") {
				throw new Error(`unexpected ${result.error.type}`);
			}
			return { accepted: false, code: result.error.code };
		},
		async balanceOf(accountId) {
			const account = state.accounts.get(rehydrate.accountId(accountId));
			if (account === undefined) throw new Error(`no account: ${accountId}`);
			return account.balance;
		},
		async totalSupply() {
			return uow.transact((ctx) => ctx.accounts.totalSupply());
		},
		async issuedAmount() {
			return state.transactionRows.reduce(
				(sum, { record }) =>
					record.kind === "ISSUE" ? sum + record.amount : sum,
				0,
			);
		},
		async transactions() {
			return state.transactionRows.map(({ record }) => view(record));
		},
	};
}

defineEconomicContract(
	"application ledger over in-memory UnitOfWork",
	createApplicationLedgerHarness,
);

describe("primitive ledger persistence", () => {
	it("stamps the Transaction and every balance write with the section's frozen now_ms", () => {
		const fx = createInMemoryFixture({ clock: stepClock(1000, 5000) });
		const owner = fx.seedPrincipal();
		const a = fx.seedAccount(owner);
		const b = fx.seedAccount(owner);

		const r = fx.uow.transact((ctx) => {
			const issued = executeIssue(ctx, {
				issuerPrincipalId: owner,
				destinationAccountId: a,
				amount: 10,
			});
			if (!issued.ok) return issued;
			return executeTransfer(ctx, {
				sourceAccountId: a,
				destinationAccountId: b,
				amount: 4,
			});
		});

		expect(r.ok).toBe(true);
		expect(
			fx.state.transactionRows.map(({ record }) => record.committedAt),
		).toEqual([1000, 1000]);
		expect(fx.state.accounts.get(a)?.updatedAt).toBe(1000);
		expect(fx.state.accounts.get(b)?.updatedAt).toBe(1000);
	});

	it("rolls balance writes back when the Transaction insert fails", () => {
		let fail = false;
		const fx = createInMemoryFixture({
			wrapScope: (scope): TransactionScope => ({
				...scope,
				transactions: {
					...scope.transactions,
					insert(record) {
						if (fail) throw new Error("injected transactions.insert failure");
						return scope.transactions.insert(record);
					},
				},
			}),
		});
		const owner = fx.seedPrincipal();
		const a = fx.seedAccount(owner, 50);
		const b = fx.seedAccount(owner);
		fail = true;

		expect(() =>
			fx.uow.transact((ctx) =>
				executeTransfer(ctx, {
					sourceAccountId: a,
					destinationAccountId: b,
					amount: 10,
				}),
			),
		).toThrow(/injected/);

		expect(fx.balanceOf(a)).toBe(50);
		expect(fx.balanceOf(b)).toBe(0);
		expect(fx.state.transactionRows).toHaveLength(0);
	});

	it("a rejection writes nothing and returns the kernel code verbatim", () => {
		const fx = createInMemoryFixture();
		const owner = fx.seedPrincipal();
		const a = fx.seedAccount(owner, 5);

		const r = fx.uow.transact((ctx) =>
			executeTransfer(ctx, {
				sourceAccountId: a,
				destinationAccountId: a,
				amount: 6,
			}),
		);

		expect(r).toMatchObject({
			ok: false,
			error: { type: "rejected", code: "INSUFFICIENT_BALANCE" },
		});
		expect(fx.state.transactionRows).toHaveLength(0);
	});
});
