import type { TransactionContext } from "../ports";
import {
	type Actor,
	type AdminActor,
	err,
	ok,
	type TreasuryWalletSelector,
	type UseCaseResult,
	type UserActor,
	type UserWalletSelector,
	type WalletSelector,
} from "../types";
import { forbidden, requireAdmin, TREASURY_ID } from "./shared";

export type BalanceResult = {
	readonly balance: number;
};

/**
 * Reads a user wallet's balance under the actor/visibility specification self-only visibility rule: a
 * user may read only their own wallet. A user with no wallet is reported as
 * `WALLET_NOT_FOUND`.
 *
 * Runs inside the caller's already-open section so outer orchestration can
 * compose the read with other work in the same atomic unit.
 */
export function getBalance(
	ctx: TransactionContext,
	actor: UserActor,
	selector: UserWalletSelector,
): UseCaseResult<BalanceResult>;

/**
 * Reads the treasury balance — administrative treasury inspection (the authentication/delegation
 * and actor/visibility specifications): only the `admin-api` principal may express the call.
 */
export function getBalance(
	ctx: TransactionContext,
	actor: AdminActor,
	selector: TreasuryWalletSelector,
): UseCaseResult<BalanceResult>;

export function getBalance(
	ctx: TransactionContext,
	actor: Actor,
	selector: WalletSelector,
): UseCaseResult<BalanceResult> {
	if (selector.type === "treasury") {
		const denial = requireAdmin(actor, "getBalance(treasury)");
		if (denial) return denial;
		const treasury = ctx.wallets.findById(TREASURY_ID);
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
	const wallet = ctx.wallets.findByOwnerUserId(selector.userId);
	if (wallet === undefined) {
		return err({
			type: "rejected",
			code: "WALLET_NOT_FOUND",
			detail: `no wallet for user ${selector.userId}`,
		});
	}
	return ok({ balance: wallet.balance });
}
