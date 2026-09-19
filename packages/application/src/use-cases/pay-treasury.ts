import type { TransactionContext } from "../ports";
import type { UseCaseResult, UserActor } from "../types";
import {
	economicFacts,
	evaluateAndPersist,
	missingWalletId,
	type OperationAccepted,
	requireUser,
	TREASURY_ID,
} from "./shared";

export type PayTreasuryInput = {
	readonly amount: number;
	readonly metadata?: string;
};

export type PayTreasuryResult = OperationAccepted & {
	/** The payer's balance after the payment. */
	readonly fromBalance: number;
};

/**
 * `TREASURY_PAYMENT`: value returning from a user to the treasury (the economic-state specification). The source is the actor's own wallet by construction.
 *
 * Runs inside the caller's already-open section so outer orchestration can
 * extend the atomic unit around it.
 */
export function payTreasury(
	ctx: TransactionContext,
	actor: UserActor,
	input: PayTreasuryInput,
): UseCaseResult<PayTreasuryResult> {
	const user = requireUser(actor, "payTreasury");
	if (!("userId" in user)) return user;
	const from = ctx.wallets.findByOwnerUserId(user.userId);
	const treasury = ctx.wallets.findById(TREASURY_ID);
	const result = evaluateAndPersist(
		ctx,
		actor,
		economicFacts(from, treasury, ctx.wallets.totalSupply()),
		{
			kind: "TREASURY_PAYMENT",
			fromWalletId: from?.id ?? missingWalletId(user.userId),
			toWalletId: TREASURY_ID,
			amount: input.amount,
			...(input.metadata === undefined ? {} : { metadata: input.metadata }),
		},
	);
	if (!result.ok) return result;
	// Same postcondition as transferToken: an accepted payment had an
	// existing source wallet — a missing post-read fails loudly.
	const post = ctx.wallets.findById(from?.id ?? missingWalletId(user.userId));
	if (post === undefined) {
		throw new Error("source wallet disappeared inside transaction");
	}
	return {
		ok: true,
		value: {
			operationId: result.value.operationId,
			fromBalance: post.balance,
		},
	};
}
