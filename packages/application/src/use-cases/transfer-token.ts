import type { TransactionContext } from "../ports";
import type { UseCaseResult, UserActor, UserId } from "../types";
import {
	economicFacts,
	evaluateAndPersist,
	missingWalletId,
	type OperationAccepted,
	requireUser,
} from "./shared";

export type TransferTokenInput = {
	readonly toUserId: UserId;
	readonly amount: number;
	readonly metadata?: string;
};

export type TransferTokenResult = OperationAccepted & {
	/** The sender's balance after the transfer. */
	readonly fromBalance: number;
};

/**
 * `P2P_TRANSFER` between two user wallets. The source is the actor's own
 * wallet by construction: a user actor can only move their own funds, and a
 * self-transfer is a valid net-zero movement that is still recorded
 * (issue #4 §22, economic-model §3).
 *
 * Runs inside the caller's already-open section so outer orchestration can
 * extend the atomic unit around it — for example the idempotency record of
 * issue #4 §12 commits in the same section as the transfer.
 */
export function transferToken(
	ctx: TransactionContext,
	actor: UserActor,
	input: TransferTokenInput,
): UseCaseResult<TransferTokenResult> {
	const user = requireUser(actor, "transferToken");
	if (!("userId" in user)) return user;
	const from = ctx.wallets.findByOwnerUserId(user.userId);
	const to = ctx.wallets.findByOwnerUserId(input.toUserId);
	const result = evaluateAndPersist(
		ctx,
		actor,
		economicFacts(from, to, ctx.wallets.totalSupply()),
		{
			kind: "P2P_TRANSFER",
			fromWalletId: from?.id ?? missingWalletId(user.userId),
			toWalletId: to?.id ?? missingWalletId(input.toUserId),
			amount: input.amount,
			...(input.metadata === undefined ? {} : { metadata: input.metadata }),
		},
	);
	if (!result.ok) return result;
	// An accepted transfer had an existing source wallet when facts were
	// evaluated; a missing post-read is a storage contract violation, not a
	// zero balance — fail loudly rather than fabricate a business value.
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
