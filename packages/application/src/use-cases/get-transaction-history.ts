import type { TransactionContext } from "../ports";
import {
	type AccountId,
	type ExternalIdentity,
	err,
	type HistoryEntry,
	ok,
	type Page,
	type TransactionRecord,
	type UseCaseResult,
} from "../types";
import { isUnresolved, resolveDefaultAccount } from "./resolve-default-account";

export type HistoryRequest = {
	readonly cursor?: string | null;
	/**
	 * Page size: an integer in `1..100`, default 50. Values outside the
	 * contract are an `invalid-input` failure, never clamped.
	 */
	readonly limit?: number;
};

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

/**
 * Validates `limit`: an integer in `1..100`, defaulting to 50.
 * Out-of-contract values are an `invalid-input` failure.
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
 * The counterparty projection of the actor-and-visibility specification
 * for one TRANSFER touching the viewed Account:
 *
 *   - self-transfer -> the caller's exact ExternalIdentity;
 *   - otherwise the other Account's owner Principal's ExternalIdentity
 *     under the caller's issuer, only when exactly one such binding
 *     exists; zero or several -> none. No arbitrary choice is made.
 *
 * @throws {Error} when the other Account does not exist — history rows
 *   reference existing Accounts by construction.
 */
function transferCounterparty(
	ctx: TransactionContext,
	record: TransactionRecord & { readonly kind: "TRANSFER" },
	viewed: AccountId,
	caller: ExternalIdentity,
): ExternalIdentity | null {
	const other =
		record.sourceAccountId === viewed
			? record.destinationAccountId
			: record.sourceAccountId;
	if (other === viewed) {
		return { issuer: caller.issuer, subject: caller.subject };
	}
	const account = ctx.accounts.findById(other);
	if (account === undefined) {
		throw new Error(`history references a missing account: ${other}`);
	}
	const subjects = ctx.identityBindings.listSubjects(
		account.ownerPrincipalId,
		caller.issuer,
	);
	const [only] = subjects;
	return subjects.length === 1 && only !== undefined
		? { issuer: caller.issuer, subject: only }
		: null;
}

/**
 * Shapes a Transaction into the caller-relative entry: direction is `self`
 * when a TRANSFER's source and destination are the viewed Account, `in`
 * when value arrives (every ISSUE into it), otherwise `out`. Internal
 * Principal and Account identifiers never appear in the entry.
 */
function shapeEntry(
	ctx: TransactionContext,
	record: TransactionRecord,
	viewed: AccountId,
	caller: ExternalIdentity,
): HistoryEntry {
	const base = {
		transactionId: record.id,
		kind: record.kind,
		amount: record.amount,
		committedAt: record.committedAt,
	};
	if (record.kind === "ISSUE") {
		return { ...base, direction: "in", counterparty: null };
	}
	const direction =
		record.sourceAccountId === viewed && record.destinationAccountId === viewed
			? "self"
			: record.destinationAccountId === viewed
				? "in"
				: "out";
	return {
		...base,
		direction,
		counterparty: transferCounterparty(ctx, record, viewed, caller),
	};
}

/**
 * Newest-first cursor-paginated self-history of the caller's default
 * Account (actor-and-visibility specification). A self-transfer appears
 * once. Runs inside the caller's already-open section.
 */
export function getTransactionHistory(
	ctx: TransactionContext,
	caller: ExternalIdentity,
	request: HistoryRequest,
): UseCaseResult<Page<HistoryEntry>> {
	const limit = historyLimit(request.limit);
	if (typeof limit !== "number") return limit;
	const resolved = resolveDefaultAccount(ctx, caller, "caller");
	if (isUnresolved(resolved)) return err(resolved);
	const viewed = resolved.account.id;
	const page = ctx.transactions.listForAccount(
		viewed,
		request.cursor ?? null,
		limit,
	);
	return ok({
		entries: page.entries.map((record) =>
			shapeEntry(ctx, record, viewed, caller),
		),
		nextCursor: page.nextCursor,
	});
}
