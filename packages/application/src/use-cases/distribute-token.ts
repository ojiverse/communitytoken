import type { TransactionContext } from "../ports";
import type { AdminActor, UseCaseResult, UserId } from "../types";
import {
	economicFacts,
	evaluateAndPersist,
	missingWalletId,
	type OperationAccepted,
	requireAdmin,
	TREASURY_ID,
} from "./shared";

export type DistributeTokenInput = {
	readonly toUserId: UserId;
	readonly amount: number;
	readonly metadata?: string;
};

/**
 * `DISTRIBUTION`: moves already-issued treasury reserve to a user. Never
 * issues tokens implicitly — insufficient treasury rejects the operation
 * (the economic-transition specification). Restricted to the `admin-api` principal.
 *
 * Runs inside the caller's already-open section so outer orchestration can
 * extend the atomic unit around it.
 */
export function distributeToken(
	ctx: TransactionContext,
	actor: AdminActor,
	input: DistributeTokenInput,
): UseCaseResult<OperationAccepted> {
	const denial = requireAdmin(actor, "distributeToken");
	if (denial) return denial;
	const treasury = ctx.wallets.findById(TREASURY_ID);
	const to = ctx.wallets.findByOwnerUserId(input.toUserId);
	return evaluateAndPersist(
		ctx,
		actor,
		economicFacts(treasury, to, ctx.wallets.totalSupply()),
		{
			kind: "DISTRIBUTION",
			fromWalletId: TREASURY_ID,
			toWalletId: to?.id ?? missingWalletId(input.toUserId),
			amount: input.amount,
			...(input.metadata === undefined ? {} : { metadata: input.metadata }),
		},
	);
}
