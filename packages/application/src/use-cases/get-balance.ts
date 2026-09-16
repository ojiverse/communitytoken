import { TREASURY_WALLET_ID } from "@communitytoken/economic-kernel";
import type { ApplicationDeps } from "../application";
import {
	type Actor,
	err,
	ok,
	type UseCaseResult,
	type WalletSelector,
} from "../types";
import { forbidden, requireService } from "./shared";

export type BalanceResult = {
	readonly balance: number;
};

/**
 * Reads a wallet balance under the §17 self-only visibility rule: a user may
 * read only their own wallet; the treasury is readable only by service
 * actors. A user with no wallet is reported as `WALLET_NOT_FOUND`.
 */
export function getBalance(
	deps: ApplicationDeps,
	actor: Actor,
	selector: WalletSelector,
): UseCaseResult<BalanceResult> {
	return deps.uow.transact((tx) => {
		if (selector.type === "treasury") {
			const denial = requireService(actor, "getBalance(treasury)");
			if (denial) return denial;
			const treasury = tx.wallets.findById(TREASURY_WALLET_ID);
			if (treasury === undefined) {
				throw new Error("treasury wallet is missing");
			}
			return ok({ balance: treasury.balance });
		}
		if (actor.kind !== "user" || actor.userId !== selector.userId) {
			return forbidden(
				`getBalance is self-only: a ${actor.kind} actor cannot read user ${selector.userId}`,
			);
		}
		const wallet = tx.wallets.findByOwnerUserId(selector.userId);
		if (wallet === undefined) {
			return err({
				type: "rejected",
				code: "WALLET_NOT_FOUND",
				detail: `no wallet for user ${selector.userId}`,
			});
		}
		return ok({ balance: wallet.balance });
	});
}
