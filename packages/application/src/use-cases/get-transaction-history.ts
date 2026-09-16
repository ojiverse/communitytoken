import { TREASURY_WALLET_ID } from "@communitytoken/economic-kernel";
import type { ApplicationDeps } from "../application";
import {
	type Actor,
	err,
	type HistoryEntry,
	type HistoryRow,
	ok,
	type Page,
	type UseCaseResult,
	type Wallet,
	type WalletSelector,
} from "../types";
import { forbidden, requireService } from "./shared";

export type HistoryRequest = {
	readonly cursor?: string | null;
	readonly limit?: number;
};

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

/** Clamps `limit` into the §17 contract: default 50, maximum 100. */
export function clampHistoryLimit(limit: number | undefined): number {
	if (limit === undefined || !Number.isFinite(limit)) return DEFAULT_LIMIT;
	return Math.min(MAX_LIMIT, Math.max(1, Math.floor(limit)));
}

/**
 * Shapes a join row into the requester-relative history entry of issue #4
 * §22: `direction` is `"in"` iff the subject wallet is the destination (a
 * self-transfer is therefore `"in"`); `counterparty` is the other side's
 * owning user, or `"treasury"` for the system wallet.
 */
export function shapeHistoryEntry(
	row: HistoryRow,
	subject: Wallet,
): HistoryEntry {
	const selfMovement =
		row.fromWalletId === subject.id && row.toWalletId === subject.id;
	const counterparty = selfMovement
		? (subject.ownerUserId ?? "treasury")
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
		actorKind: row.actorKind,
		actorId: row.actorId,
		createdAt: row.createdAt,
		direction: row.toWalletId === subject.id ? "in" : "out",
		counterparty,
	};
}

/**
 * Newest-first cursor-paginated history of the selected wallet under §17
 * self-only visibility. `TOKEN_ISSUANCE` never appears in a user's history:
 * its ledger movement touches only the treasury wallet, so the wallet filter
 * excludes it by construction. The treasury selector is the administrative
 * view and does show issuances.
 */
export function getTransactionHistory(
	deps: ApplicationDeps,
	actor: Actor,
	selector: WalletSelector,
	request: HistoryRequest,
): UseCaseResult<Page<HistoryEntry>> {
	return deps.uow.transact((tx) => {
		let subject: Wallet;
		if (selector.type === "treasury") {
			const denial = requireService(actor, "getTransactionHistory(treasury)");
			if (denial) return denial;
			const treasury = tx.wallets.findById(TREASURY_WALLET_ID);
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
			const wallet = tx.wallets.findByOwnerUserId(selector.userId);
			if (wallet === undefined) {
				return err({
					type: "rejected",
					code: "WALLET_NOT_FOUND",
					detail: `no wallet for user ${selector.userId}`,
				});
			}
			subject = wallet;
		}
		const page = tx.operations.listForWallet(
			subject.id,
			request.cursor ?? null,
			clampHistoryLimit(request.limit),
		);
		return ok({
			entries: page.entries.map((row) => shapeHistoryEntry(row, subject)),
			nextCursor: page.nextCursor,
		});
	});
}
