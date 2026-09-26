import type { TransactionContext } from "../ports";
import {
	ADMIN_API_CALLER,
	type AdministrativeCaller,
	type ExternalIdentity,
	err,
	type UseCaseResult,
} from "../types";
import { executeIssue, type TransactionAccepted } from "./ledger";
import { isUnresolved, resolveDefaultAccount } from "./resolve-default-account";

/**
 * The administrative issuance request: the target ExternalIdentity and the
 * amount. No feature reason, campaign, or other legacy metadata.
 */
export type IssueToIdentityInput = {
	readonly target: ExternalIdentity;
	readonly amount: number;
};

/**
 * Administrative ISSUE — the only Phase 2 path that constructs an ISSUE:
 *
 *   authorize the administrative technical caller
 *   -> map it to the stable administrative issuer Principal
 *   -> resolve target identity -> Principal -> default Account
 *   -> ISSUE(admin issuer Principal, target default Account, amount).
 *
 * The `AdministrativeCaller` parameter type makes a call with another
 * technical caller inexpressible in typed code; the runtime guard
 * backstops untyped callers. Runs inside the caller's already-open section
 * so the idempotency record commits atomically with the ISSUE.
 *
 * @throws {Error} when the administrative issuer Principal was never
 *   initialized — an initialization contract violation, not a rejection.
 */
export function issueToIdentity(
	ctx: TransactionContext,
	caller: AdministrativeCaller,
	input: IssueToIdentityInput,
): UseCaseResult<TransactionAccepted> {
	if (caller !== ADMIN_API_CALLER) {
		return err({
			type: "forbidden",
			detail: `issuance requires the ${ADMIN_API_CALLER} caller, got ${String(caller)}`,
		});
	}
	const issuer = ctx.administrativeIssuer.find();
	if (issuer === undefined) {
		throw new Error("administrative issuer Principal is not initialized");
	}
	const target = resolveDefaultAccount(ctx, input.target, "caller");
	if (isUnresolved(target)) return err(target);
	return executeIssue(ctx, {
		issuerPrincipalId: issuer,
		destinationAccountId: target.account.id,
		amount: input.amount,
	});
}
