import type { TransactionContext } from "../ports";
import type {
	Actor,
	OperationKind,
	UseCaseResult,
	Wallet,
	WalletId,
	WalletSelector,
} from "../types";
import {
	economicFacts,
	evaluateAndPersist,
	missingWalletId,
	type OperationAccepted,
	TREASURY_ID,
} from "./shared";

/**
 * An economic command expressed with `WalletSelector`s instead of resolved
 * wallet ids — the input shape of `applyEconomicCommand`. The selector union
 * keeps the treasury in its own namespace, so an opaque user id can never
 * alias the system wallet.
 */
export type EconomicSelectorCommand = {
	readonly kind: OperationKind;
	readonly from: WalletSelector;
	readonly to: WalletSelector;
	readonly amount: number;
	readonly metadata?: string;
};

/** Resolves a selector to the wallet it names, or `undefined` when absent. */
function resolveWallet(
	ctx: TransactionContext,
	selector: WalletSelector,
): Wallet | undefined {
	return selector.type === "treasury"
		? ctx.wallets.findById(TREASURY_ID)
		: ctx.wallets.findByOwnerUserId(selector.userId);
}

/**
 * The wallet id the kernel command carries for `selector`: the resolved
 * wallet's id when it exists, otherwise a label that can only produce a
 * `WALLET_NOT_FOUND` rejection — never a fabricated movement.
 */
function commandWalletId(
	selector: WalletSelector,
	wallet: Wallet | undefined,
): WalletId {
	if (selector.type === "treasury") return TREASURY_ID;
	return wallet?.id ?? missingWalletId(selector.userId);
}

/**
 * Non-facade, composable application operation for the unchanged Phase 1
 * contract adapter: resolves the command's `WalletSelector`s, reads current
 * facts, and delegates to the same evaluate/persist choreography as the
 * product use cases. It performs no actor authorization — the caller is a
 * trusted test-support surface that supplies the persisted `actor`
 * explicitly; actor context never feeds the economic evaluator anyway. This
 * is test-support plumbing with no HTTP/product route.
 *
 * Runs inside the caller's already-open section so outer orchestration can
 * extend the atomic unit around it.
 */
export function applyEconomicCommand(
	ctx: TransactionContext,
	actor: Actor,
	command: EconomicSelectorCommand,
): UseCaseResult<OperationAccepted> {
	const from = resolveWallet(ctx, command.from);
	const to = resolveWallet(ctx, command.to);
	return evaluateAndPersist(
		ctx,
		actor,
		economicFacts(from, to, ctx.wallets.totalSupply()),
		{
			kind: command.kind,
			fromWalletId: commandWalletId(command.from, from),
			toWalletId: commandWalletId(command.to, to),
			amount: command.amount,
			...(command.metadata === undefined ? {} : { metadata: command.metadata }),
		},
	);
}
