/**
 * Domain types of the application layer for the Phase 2 CommunityToken
 * service (issue #4). These types are provider- and runtime-independent:
 * they name internal identities and application records, never external
 * provider identifiers or platform types (issue #4 §2, §11).
 */

import type {
	OperationKind,
	RejectionCode,
} from "@communitytoken/economic-kernel";

export type { OperationKind, RejectionCode };

/**
 * Opaque, stable internal identifier of a User (issue #4 §5). Never derived
 * from an external provider; external identities resolve to it through an
 * IdentityBinding at the trusted boundary.
 */
export type UserId = string;

/**
 * Opaque identifier of a Wallet. The single treasury wallet's id is the
 * kernel's `TREASURY_WALLET_ID`.
 */
export type WalletId = string;

/** The `actor_kind` values persisted on `economic_operations` (issue #4 §13). */
export type ActorKind = "user" | "service" | "system";

/**
 * Who initiated a use case: application/audit context attached to the
 * persisted EconomicOperation. The actor is never an input to the economic
 * evaluator and is distinct from the funding wallet (issue #4 §13). The
 * union encodes the storage CHECK at compile time: `user` and `service`
 * actors carry an identifier, `system` carries none.
 */
export type Actor =
	| { readonly kind: "user"; readonly userId: UserId }
	| { readonly kind: "service"; readonly principalId: string }
	| { readonly kind: "system" };

/** The persisted `actor_kind` column value for `actor`. */
export function actorKind(actor: Actor): ActorKind {
	return actor.kind;
}

/** The persisted `actor_id` column value for `actor` (null iff `system`). */
export function actorId(actor: Actor): string | null {
	switch (actor.kind) {
		case "user":
			return actor.userId;
		case "service":
			return actor.principalId;
		case "system":
			return null;
	}
}

export type WalletKind = "system" | "user";

/**
 * Selects the wallet a read targets (issue #4 §17). The tagged union keeps
 * the treasury in its own namespace: an opaque user id can never alias it.
 */
export type WalletSelector =
	| { readonly type: "treasury" }
	| { readonly type: "user"; readonly userId: UserId };

/** Selects the deployment's single system wallet. */
export const TREASURY_SELECTOR: WalletSelector = { type: "treasury" };

/** Selects the wallet owned by `userId`. */
export function userSelector(userId: UserId): WalletSelector {
	return { type: "user", userId };
}

/** A wallet as the application layer reads it. `ownerUserId` is null iff treasury. */
export type Wallet = {
	readonly id: WalletId;
	readonly kind: WalletKind;
	readonly ownerUserId: UserId | null;
	readonly balance: number;
	readonly createdAt: number;
	readonly updatedAt: number;
};

/** A persisted EconomicOperation, including its §13 actor columns. */
export type OperationRecord = {
	readonly id: string;
	readonly kind: OperationKind;
	readonly metadata: string | null;
	readonly actorKind: ActorKind;
	readonly actorId: string | null;
	readonly createdAt: number;
};

/** A persisted LedgerTransaction. */
export type LedgerRecord = {
	readonly id: string;
	readonly operationId: string;
	readonly fromWalletId: WalletId;
	readonly toWalletId: WalletId;
	readonly amount: number;
	readonly createdAt: number;
};

/**
 * The operation+ledger join row a repository returns for history queries,
 * before requester-relative shaping. Owner ids are included for both
 * movement sides so the use case can derive `counterparty` (issue #4 §22).
 */
export type HistoryRow = {
	readonly id: string;
	readonly kind: OperationKind;
	readonly amount: number;
	readonly fromWalletId: WalletId;
	readonly fromOwnerUserId: UserId | null;
	readonly toWalletId: WalletId;
	readonly toOwnerUserId: UserId | null;
	readonly metadata: string | null;
	readonly actorKind: ActorKind;
	readonly actorId: string | null;
	readonly createdAt: number;
};

/** Movement direction relative to the requesting wallet. */
export type HistoryDirection = "in" | "out";

/**
 * One entry of a user's or the treasury's operation history (issue #4 §17,
 * §22). `counterparty` is `"treasury"` for a system-side movement, otherwise
 * the internal User id owning the other wallet; for a self-transfer it is
 * the requesting user themself.
 */
export type HistoryEntry = {
	readonly id: string;
	readonly kind: OperationKind;
	readonly amount: number;
	readonly fromWalletId: WalletId;
	readonly toWalletId: WalletId;
	readonly metadata: string | null;
	readonly actorKind: ActorKind;
	readonly actorId: string | null;
	readonly createdAt: number;
	readonly direction: HistoryDirection;
	readonly counterparty: "treasury" | UserId;
};

/**
 * One page of a cursor-paginated result. `nextCursor` is an opaque
 * continuation value owned by the repository implementation; it is `null`
 * when the result is exhausted (issue #4 §17).
 */
export type Page<T> = {
	readonly entries: readonly T[];
	readonly nextCursor: string | null;
};

/**
 * The actor is not permitted to run this use case — for example a non-user
 * actor on a wallet-owner operation, or a non-service actor on an
 * administrative operation (issue #4 §10, §13).
 */
export type ForbiddenError = {
	readonly type: "forbidden";
	readonly detail: string;
};

/** The economic kernel rejected the operation; `code` is passed through verbatim. */
export type RejectedError = {
	readonly type: "rejected";
	readonly code: RejectionCode;
	readonly detail: string;
};

/** The expected failures a caller is meant to handle. */
export type UseCaseError = ForbiddenError | RejectedError;

/**
 * Outcome of a use case: either the produced value or an expected failure.
 * Unexpected conditions (contract violations, storage faults) are thrown,
 * not returned.
 */
export type UseCaseResult<T> =
	| { readonly ok: true; readonly value: T }
	| { readonly ok: false; readonly error: UseCaseError };

export function ok<T>(value: T): UseCaseResult<T> {
	return { ok: true, value };
}

export function err<T>(error: UseCaseError): UseCaseResult<T> {
	return { ok: false, error };
}
