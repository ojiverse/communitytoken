import { runInDurableObject } from "cloudflare:test";
import {
	executeIssue,
	executeTransfer,
	rehydrate,
	type TransactionAccepted,
	type TransactionContext,
	type UseCaseResult,
} from "@communitytoken/application";
import type {
	EconomicHarness,
	HarnessCommand,
	HarnessResult,
	TransactionView,
} from "@communitytoken/economic-contract";
import type { CommunityState } from "../src/index";
import { createStorageUnitOfWork } from "../src/unit-of-work";

/**
 * Adapts the production CommunityState storage to the shared primitive
 * ledger contract. The production object exposes no generic ledger RPC —
 * administrative issuance is its only ISSUE path — so the harness runs the
 * application's primitive ledger operations inside the object through
 * `runInDurableObject`, over the production SQLite schema, repositories,
 * and `UnitOfWork`. Passing the suite proves the production persistence
 * preserves the primitive invariants for arbitrary Principals and Accounts.
 */

type Row = {
	readonly id: string;
	readonly kind: "ISSUE" | "TRANSFER";
	readonly issuer_principal_id: string | null;
	readonly source_account_id: string | null;
	readonly destination_account_id: string;
	readonly amount: number;
	readonly committed_at: number;
};

function toView(row: Row): TransactionView {
	if (row.kind === "ISSUE") {
		return {
			id: row.id,
			kind: "ISSUE",
			issuerPrincipalId: row.issuer_principal_id ?? "",
			sourceAccountId: null,
			destinationAccountId: row.destination_account_id,
			amount: row.amount,
			committedAt: row.committed_at,
		};
	}
	return {
		id: row.id,
		kind: "TRANSFER",
		issuerPrincipalId: null,
		sourceAccountId: row.source_account_id ?? "",
		destinationAccountId: row.destination_account_id,
		amount: row.amount,
		committedAt: row.committed_at,
	};
}

function executeCommand(
	ctx: TransactionContext,
	command: HarnessCommand,
): UseCaseResult<TransactionAccepted> {
	return command.kind === "ISSUE"
		? executeIssue(ctx, {
				issuerPrincipalId: rehydrate.principalId(command.issuerPrincipalId),
				destinationAccountId: rehydrate.accountId(command.destinationAccountId),
				amount: command.amount,
			})
		: executeTransfer(ctx, {
				sourceAccountId: rehydrate.accountId(command.sourceAccountId),
				destinationAccountId: rehydrate.accountId(command.destinationAccountId),
				amount: command.amount,
			});
}

export function createProductionHarness(
	stub: DurableObjectStub<CommunityState>,
): EconomicHarness {
	let tick = 1_700_000_000_000;
	function inSection<R>(work: (ctx: TransactionContext) => R): Promise<R> {
		return runInDurableObject(stub, (_instance, state) => {
			const uow = createStorageUnitOfWork(state.storage, {
				nowMs: () => tick++,
			});
			return uow.transact((ctx) => work(ctx) as never) as R;
		});
	}
	return {
		async reset() {
			// Each test constructs a fresh DO id; only the administrative
			// issuer Principal pre-exists, and it owns no Account.
		},

		createPrincipal() {
			return inSection(
				(ctx) => ctx.principals.insert({ createdAt: ctx.nowMs }).id,
			);
		},

		createAccount(ownerPrincipalId: string) {
			return inSection(
				(ctx) =>
					ctx.accounts.insert({
						ownerPrincipalId: rehydrate.principalId(ownerPrincipalId),
						createdAt: ctx.nowMs,
					}).id,
			);
		},

		async apply(command: HarnessCommand): Promise<HarnessResult> {
			const result = await inSection((ctx) => executeCommand(ctx, command));
			if (result.ok) {
				return { accepted: true, transactionId: result.value.transactionId };
			}
			if (result.error.type !== "rejected") {
				throw new Error(`unexpected ${result.error.type} failure`);
			}
			return { accepted: false, code: result.error.code };
		},

		async balanceOf(accountId: string) {
			const balance = await inSection(
				(ctx) => ctx.accounts.findById(rehydrate.accountId(accountId))?.balance,
			);
			if (balance === undefined) throw new Error(`no account: ${accountId}`);
			return balance;
		},

		totalSupply() {
			return inSection((ctx) => ctx.accounts.totalSupply());
		},

		issuedAmount() {
			return runInDurableObject(stub, (_instance, state) =>
				Number(
					state.storage.sql
						.exec(
							"SELECT COALESCE(SUM(amount), 0) AS total FROM transactions WHERE kind = 'ISSUE'",
						)
						.one()["total"],
				),
			);
		},

		transactions() {
			return runInDurableObject(stub, (_instance, state) =>
				(
					state.storage.sql
						.exec(
							"SELECT id, kind, issuer_principal_id, source_account_id, destination_account_id, amount, committed_at FROM transactions ORDER BY rowid",
						)
						.toArray() as unknown as Row[]
				).map(toView),
			);
		},
	};
}
