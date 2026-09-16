import type { ApplicationDeps } from "../application";
import type { Actor, UseCaseResult, UserId } from "../types";
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
 */
export function transferToken(
	deps: ApplicationDeps,
	actor: Actor,
	input: TransferTokenInput,
): UseCaseResult<TransferTokenResult> {
	const user = requireUser(actor, "transferToken");
	if (!("userId" in user)) return user;
	return deps.uow.transact((tx) => {
		const from = tx.wallets.findByOwnerUserId(user.userId);
		const to = tx.wallets.findByOwnerUserId(input.toUserId);
		const result = evaluateAndPersist(
			tx,
			deps.clock,
			actor,
			economicFacts(from, to, tx.wallets.totalSupply()),
			{
				kind: "P2P_TRANSFER",
				fromWalletId: from?.id ?? missingWalletId(user.userId),
				toWalletId: to?.id ?? missingWalletId(input.toUserId),
				amount: input.amount,
				...(input.metadata === undefined ? {} : { metadata: input.metadata }),
			},
		);
		if (!result.ok) return result;
		const post = tx.wallets.findById(from?.id ?? missingWalletId(user.userId));
		return {
			ok: true,
			value: {
				operationId: result.value.operationId,
				fromBalance: post?.balance ?? 0,
			},
		};
	});
}
