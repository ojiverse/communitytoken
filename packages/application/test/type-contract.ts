/**
 * Compile-time negative coverage for the types-as-design contract (the
 * identity, economic-state, and persistence specifications). Every
 * `@ts-expect-error` below must remain a type error: if a public signature
 * is accidentally weakened, `tsc --noEmit` reports the directive as unused
 * and `pnpm check` fails. This file is never executed — vitest only runs
 * `*.spec.ts`.
 */
import {
	type AccountId,
	ADMIN_API_CALLER,
	type PrincipalId,
	rehydrate,
	type TransactionContext,
	type TransactionRecord,
	type UnitOfWork,
} from "../src/index";
import { issueToIdentity } from "../src/use-cases/issue-to-identity";

export function forbiddenByType(
	ctx: TransactionContext,
	uow: UnitOfWork,
): readonly unknown[] {
	const results: unknown[] = [];

	// @ts-expect-error a plain string is not a PrincipalId
	const pidFromString: PrincipalId = "alice";
	// @ts-expect-error an AccountId is not a PrincipalId
	const pidFromAccount: PrincipalId = rehydrate.accountId("account-1");
	// @ts-expect-error a PrincipalId is not an AccountId
	const aidFromPrincipal: AccountId = rehydrate.principalId("principal-1");
	results.push(pidFromString, pidFromAccount, aidFromPrincipal);

	const alice = { issuer: "https://issuer.test", subject: "alice" };
	results.push(
		// @ts-expect-error the adapter technical caller cannot issue
		issueToIdentity(ctx, "discord-adapter", { target: alice, amount: 1 }),
	);
	results.push(
		issueToIdentity(ctx, ADMIN_API_CALLER, {
			target: alice,
			amount: 1,
			// @ts-expect-error administrative issuance carries no legacy metadata
			metadata: "welcome bonus",
		}),
	);

	// @ts-expect-error an ISSUE cannot omit its issuer Principal
	const issueWithoutIssuer: TransactionRecord = {
		id: rehydrate.transactionId("tx-1"),
		kind: "ISSUE",
		issuerPrincipalId: null,
		sourceAccountId: null,
		destinationAccountId: rehydrate.accountId("account-1"),
		amount: 1,
		committedAt: 0,
	};
	// @ts-expect-error a TRANSFER cannot carry an issuer Principal
	const transferWithIssuer: TransactionRecord = {
		id: rehydrate.transactionId("tx-2"),
		kind: "TRANSFER",
		issuerPrincipalId: rehydrate.principalId("principal-1"),
		sourceAccountId: rehydrate.accountId("account-1"),
		destinationAccountId: rehydrate.accountId("account-2"),
		amount: 1,
		committedAt: 0,
	};
	// @ts-expect-error an ISSUE has no source Account
	const issueWithSource: TransactionRecord = {
		id: rehydrate.transactionId("tx-3"),
		kind: "ISSUE",
		issuerPrincipalId: rehydrate.principalId("principal-1"),
		sourceAccountId: rehydrate.accountId("account-1"),
		destinationAccountId: rehydrate.accountId("account-2"),
		amount: 1,
		committedAt: 0,
	};
	results.push(issueWithoutIssuer, transferWithIssuer, issueWithSource);

	// @ts-expect-error async transaction callbacks are forbidden
	results.push(uow.transact(async () => 1));

	return results;
}
