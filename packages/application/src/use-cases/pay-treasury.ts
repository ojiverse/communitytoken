import { TREASURY_WALLET_ID } from "@communitytoken/economic-kernel";
import type { ApplicationDeps } from "../application";
import type { Actor, UseCaseResult } from "../types";
import {
	economicFacts,
	evaluateAndPersist,
	missingWalletId,
	type OperationAccepted,
	requireUser,
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
 * `TREASURY_PAYMENT`: value returning from a user to the treasury (issue #4
 * §4). The source is the actor's own wallet by construction.
 */
export function payTreasury(
	deps: ApplicationDeps,
	actor: Actor,
	input: PayTreasuryInput,
): UseCaseResult<PayTreasuryResult> {
	const user = requireUser(actor, "payTreasury");
	if (!("userId" in user)) return user;
	return deps.uow.transact((tx) => {
		const from = tx.wallets.findByOwnerUserId(user.userId);
		const treasury = tx.wallets.findById(TREASURY_WALLET_ID);
		const result = evaluateAndPersist(
			tx,
			deps.clock,
			actor,
			economicFacts(from, treasury, tx.wallets.totalSupply()),
			{
				kind: "TREASURY_PAYMENT",
				fromWalletId: from?.id ?? missingWalletId(user.userId),
				toWalletId: TREASURY_WALLET_ID,
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
