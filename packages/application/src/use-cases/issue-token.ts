import type { TransactionContext } from "../ports";
import type { AdminActor, UseCaseResult } from "../types";
import {
	economicFacts,
	evaluateAndPersist,
	type OperationAccepted,
	requireAdmin,
	TREASURY_ID,
} from "./shared";

export type IssueTokenInput = {
	readonly amount: number;
	readonly metadata?: string;
};

/**
 * Explicit `TOKEN_ISSUANCE`: increases total supply by crediting the
 * treasury (the economic-transition specification — issuance is always explicit and auditable).
 * Restricted to the `admin-api` principal; the `AdminActor` parameter type
 * makes a call with any other actor inexpressible in typed code, and the
 * runtime guard backstops untyped callers.
 *
 * Runs inside the caller's already-open section so outer orchestration can
 * extend the atomic unit around it.
 */
export function issueToken(
	ctx: TransactionContext,
	actor: AdminActor,
	input: IssueTokenInput,
): UseCaseResult<OperationAccepted> {
	const denial = requireAdmin(actor, "issueToken");
	if (denial) return denial;
	const treasury = ctx.wallets.findById(TREASURY_ID);
	return evaluateAndPersist(
		ctx,
		actor,
		economicFacts(treasury, treasury, ctx.wallets.totalSupply()),
		{
			kind: "TOKEN_ISSUANCE",
			fromWalletId: TREASURY_ID,
			toWalletId: TREASURY_ID,
			amount: input.amount,
			...(input.metadata === undefined ? {} : { metadata: input.metadata }),
		},
	);
}
