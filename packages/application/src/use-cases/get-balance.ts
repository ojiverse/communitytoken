import type { TransactionContext } from "../ports";
import { type ExternalIdentity, err, ok, type UseCaseResult } from "../types";
import { isUnresolved, resolveDefaultAccount } from "./resolve-default-account";

export type BalanceResult = {
	readonly balance: number;
};

/**
 * Self-only balance (actor-and-visibility specification): the balance of
 * the default Account of the Principal the caller's exact ExternalIdentity
 * resolves to. Other Accounts of that Principal are not visible here.
 *
 * Runs inside the caller's already-open section.
 */
export function getBalance(
	ctx: TransactionContext,
	caller: ExternalIdentity,
): UseCaseResult<BalanceResult> {
	const resolved = resolveDefaultAccount(ctx, caller, "caller");
	if (isUnresolved(resolved)) return err(resolved);
	return ok({ balance: resolved.account.balance });
}
