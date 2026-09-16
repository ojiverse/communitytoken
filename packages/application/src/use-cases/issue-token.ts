import { TREASURY_WALLET_ID } from "@communitytoken/economic-kernel";
import type { ApplicationDeps } from "../application";
import type { Actor, UseCaseResult } from "../types";
import {
	economicFacts,
	evaluateAndPersist,
	type OperationAccepted,
	requireService,
} from "./shared";

export type IssueTokenInput = {
	readonly amount: number;
	readonly metadata?: string;
};

/**
 * Explicit `TOKEN_ISSUANCE`: increases total supply by crediting the
 * treasury (issue #4 §4 — issuance is always explicit and auditable).
 * Restricted to service actors; the `/admin/*` boundary binds the concrete
 * principal.
 */
export function issueToken(
	deps: ApplicationDeps,
	actor: Actor,
	input: IssueTokenInput,
): UseCaseResult<OperationAccepted> {
	const denial = requireService(actor, "issueToken");
	if (denial) return denial;
	return deps.uow.transact((tx) => {
		const treasury = tx.wallets.findById(TREASURY_WALLET_ID);
		return evaluateAndPersist(
			tx,
			deps.clock,
			actor,
			economicFacts(treasury, treasury, tx.wallets.totalSupply()),
			{
				kind: "TOKEN_ISSUANCE",
				fromWalletId: TREASURY_WALLET_ID,
				toWalletId: TREASURY_WALLET_ID,
				amount: input.amount,
				...(input.metadata === undefined ? {} : { metadata: input.metadata }),
			},
		);
	});
}
