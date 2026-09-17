import type { TransactionContext } from "../ports";
import {
	type Actor,
	type AdminActor,
	err,
	type HistoryEntry,
	type HistoryRow,
	ok,
	type Page,
	persistedActorOf,
	type TreasuryWalletSelector,
	type UseCaseResult,
	type UserActor,
	type UserWalletSelector,
	type Wallet,
	type WalletSelector,
} from "../types";
import { forbidden, requireAdmin, TREASURY_ID } from "./shared";

export type HistoryRequest = {
	readonly cursor?: string | null;
	/**
	 * Page size: an integer in `1..100`, default 50 (issue #4 §17). Values
	 * outside the contract are an `invalid-input` failure, never clamped.
	 */
	readonly limit?: number;
};

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

/**
 * Validates `limit` against the §17 contract: an integer in `1..100`,
 * defaulting to 50. Out-of-contract values are an `invalid-input` failure —
 * the boundary owns rejecting malformed requests, and this layer does not
 * silently normalize caller input.
 */
export function historyLimit(
	limit: number | undefined,
): number | UseCaseResult<never> {
	if (limit === undefined) return DEFAULT_LIMIT;
	if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
		return err({
			type: "invalid-input",
			code: "INVALID_LIMIT",
			detail: `history limit must be an integer in 1..${MAX_LIMIT}, got ${limit}`,
		});
	}
	return limit;
}

/**
 * Shapes a join row into the requester-relative history entry of issue #4
 * §22: `direction` is `"self"` for a net-zero self-movement (a
 * `P2P_TRANSFER` whose sides are the subject wallet), `"in"` iff value
 * arrives at the subject, otherwise `"out"`; `counterparty` is the other
 * side's owning user, or `"treasury"` for the system wallet.
 */
export function shapeHistoryEntry(
	row: HistoryRow,
	subject: Wallet,
): HistoryEntry {
	const selfMovement =
		row.fromWalletId === subject.id && row.toWalletId === subject.id;
	const direction = selfMovement
		? row.kind === "P2P_TRANSFER"
			? "self"
			: "in"
		: row.toWalletId === subject.id
			? "in"
			: "out";
	const counterparty = selfMovement
		? subject.kind === "user"
			? subject.ownerUserId
			: "treasury"
		: row.toWalletId === subject.id
			? (row.fromOwnerUserId ?? "treasury")
			: (row.toOwnerUserId ?? "treasury");
	return {
		id: row.id,
		kind: row.kind,
		amount: row.amount,
		fromWalletId: row.fromWalletId,
		toWalletId: row.toWalletId,
		metadata: row.metadata,
		createdAt: row.createdAt,
		direction,
		counterparty,
		...persistedActorOf(row),
	};
}

/**
 * Newest-first cursor-paginated history of a user wallet under §17 self-only
 * visibility. `TOKEN_ISSUANCE` never appears in a user's history: its ledger
 * movement touches only the treasury wallet, so the wallet filter excludes
 * it by construction.
 */
export function getTransactionHistory(
	ctx: TransactionContext,
	actor: UserActor,
	selector: UserWalletSelector,
	request: HistoryRequest,
): UseCaseResult<Page<HistoryEntry>>;

/**
 * Newest-first cursor-paginated treasury history — administrative treasury
 * inspection (issue #4 §10, §17): only the `admin-api` principal may express
 * the call. The treasury view does include issuances.
 */
export function getTransactionHistory(
	ctx: TransactionContext,
	actor: AdminActor,
	selector: TreasuryWalletSelector,
	request: HistoryRequest,
): UseCaseResult<Page<HistoryEntry>>;

export function getTransactionHistory(
	ctx: TransactionContext,
	actor: Actor,
	selector: WalletSelector,
	request: HistoryRequest,
): UseCaseResult<Page<HistoryEntry>> {
	const limit = historyLimit(request.limit);
	if (typeof limit !== "number") return limit;
	let subject: Wallet;
	if (selector.type === "treasury") {
		const denial = requireAdmin(actor, "getTransactionHistory(treasury)");
		if (denial) return denial;
		const treasury = ctx.wallets.findById(TREASURY_ID);
		if (treasury === undefined) {
			throw new Error("treasury wallet is missing");
		}
		subject = treasury;
	} else {
		if (actor.kind !== "user" || actor.userId !== selector.userId) {
			return forbidden(
				`getTransactionHistory is self-only: a ${actor.kind} actor cannot read user ${selector.userId}`,
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
		subject = wallet;
	}
	const page = ctx.operations.listForWallet(
		subject.id,
		request.cursor ?? null,
		limit,
	);
	return ok({
		entries: page.entries.map((row) => shapeHistoryEntry(row, subject)),
		nextCursor: page.nextCursor,
	});
}
