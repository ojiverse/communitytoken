import { TREASURY_WALLET_ID } from "@communitytoken/economic-kernel";
import type { ApplicationDeps } from "../application";
import type { Actor, UseCaseResult, UserId } from "../types";
import {
	economicFacts,
	evaluateAndPersist,
	missingWalletId,
	type OperationAccepted,
	requireService,
} from "./shared";

export type DistributeTokenInput = {
	readonly toUserId: UserId;
	readonly amount: number;
	readonly metadata?: string;
};

/**
 * `DISTRIBUTION`: moves already-issued treasury reserve to a user. Never
 * issues tokens implicitly — insufficient treasury rejects the operation
 * (issue #4 §4). Restricted to service actors.
 */
export function distributeToken(
	deps: ApplicationDeps,
	actor: Actor,
	input: DistributeTokenInput,
): UseCaseResult<OperationAccepted> {
	const denial = requireService(actor, "distributeToken");
	if (denial) return denial;
	return deps.uow.transact((tx) => {
		const treasury = tx.wallets.findById(TREASURY_WALLET_ID);
		const to = tx.wallets.findByOwnerUserId(input.toUserId);
		return evaluateAndPersist(
			tx,
			deps.clock,
			actor,
			economicFacts(treasury, to, tx.wallets.totalSupply()),
			{
				kind: "DISTRIBUTION",
				fromWalletId: TREASURY_WALLET_ID,
				toWalletId: to?.id ?? missingWalletId(input.toUserId),
				amount: input.amount,
				...(input.metadata === undefined ? {} : { metadata: input.metadata }),
			},
		);
	});
}
