/**
 * Domain types of the application layer for the Phase 2 CommunityToken
 * service (see docs/specification/README.md). These types are provider- and runtime-independent:
 * they name internal identities and application records, never external
 * provider identifiers or platform types (the transaction-consistency and authentication/delegation specifications).
 */

import type {
	OperationKind,
	RejectionCode,
} from "@communitytoken/economic-kernel";

export type { OperationKind, RejectionCode };

declare const brand: unique symbol;

/**
 * An opaque identifier: a `T` whose origin is fixed to `B` at compile time.
 * Branding keeps stable internal identifiers (User, Wallet, records)
 * non-substitutable with each other and with external identifiers such as an
 * OIDC `sub` or a Discord snowflake (the identity and authentication/delegation specifications).
 */
export type Brand<T, B> = T & { readonly [brand]: B };

/**
 * Opaque, stable internal identifier of a User (the identity specification). Never derived
 * from an external provider; external identities resolve to it through an
 * IdentityBinding at the trusted boundary.
 */
export type UserId = Brand<string, "UserId">;

/**
 * Brands/rehydrates a persisted internal User identifier as `UserId`.
 * Creation/allocation belongs to the persistence boundary (the persistence specification).
 */
export function userId(raw: string): UserId {
	return raw as UserId;
}

/**
 * Opaque identifier of a Wallet. The single treasury wallet's id is the
 * kernel's `TREASURY_WALLET_ID`.
 */
export type WalletId = Brand<string, "WalletId">;

/** Brands `raw` as a WalletId. Persistence owns id allocation. */
export function walletId(raw: string): WalletId {
	return raw as WalletId;
}

/** Opaque identifier of a persisted EconomicOperation. */
export type OperationId = Brand<string, "OperationId">;

/** Brands `raw` as an OperationId. Persistence owns id allocation. */
export function operationId(raw: string): OperationId {
	return raw as OperationId;
}

/** Opaque identifier of a persisted LedgerTransaction. */
export type LedgerId = Brand<string, "LedgerId">;

/** Brands `raw` as a LedgerId. Persistence owns id allocation. */
export function ledgerId(raw: string): LedgerId {
	return raw as LedgerId;
}

/**
 * Rehydration of persisted identifiers: brands raw storage strings as
 * opaque ids. This is the visible unsafe boundary — only persistence
 * adapters and test support may turn an arbitrary string into an internal
 * id; the application API consumes already-branded values (the persistence specification).
 */
export const rehydrate = {
	userId,
	walletId,
	operationId,
	ledgerId,
} as const;

/** The `actor_kind` values persisted on `economic_operations` (the actor/visibility specification). */
export type ActorKind = "user" | "service" | "system";

/**
 * The administrative service principal of the actor/visibility specification: the only actor
 * permitted to run `TOKEN_ISSUANCE` and `DISTRIBUTION`. Bound at the
 * `/api/v1/admin/*` boundary; other service principals (e.g. `discord-adapter`)
 * are not administrative.
 */
export const ADMIN_API_PRINCIPAL = "admin-api";

/** A resolved internal User acting on their own wallet (the actor/visibility specification). */
export type UserActor = {
	readonly kind: "user";
	readonly userId: UserId;
};

/** A trusted service principal identified by its credential id (the actor/visibility specification). */
export type ServiceActor = {
	readonly kind: "service";
	readonly principalId: string;
};

/**
 * The administrative actor: the `admin-api` service principal. Administrative
 * use cases take this type so that calling them with any other principal is
 * inexpressible in typed code (the authentication/delegation and actor/visibility specifications).
 */
export type AdminActor = ServiceActor & {
	readonly principalId: typeof ADMIN_API_PRINCIPAL;
};

/** A scheduled/policy initiator; carries no identifier (the actor/visibility specification). */
export type SystemActor = {
	readonly kind: "system";
};

/**
 * Who initiated a use case: application/audit context attached to the
 * persisted EconomicOperation. The actor is never an input to the economic
 * evaluator and is distinct from the funding wallet (the actor/visibility specification). The
 * union encodes the storage CHECK at compile time: `user` and `service`
 * actors carry an identifier, `system` carries none.
 */
export type Actor = UserActor | ServiceActor | SystemActor;

/**
 * The the actor/visibility specification actor columns as persisted on `economic_operations` and joined
 * into history rows: kind and id form one union, so a `system` actor cannot
 * carry an id and `user`/`service` actors cannot lack one.
 */
export type PersistedActor =
	| { readonly actorKind: "user"; readonly actorId: UserId }
	| { readonly actorKind: "service"; readonly actorId: string }
	| { readonly actorKind: "system"; readonly actorId: null };

/**
 * Projects an `Actor` onto the actor/visibility specification persisted columns. Repositories call
 * this when storing an `EconomicOperation`; there is no reverse — stored
 * columns never rehydrate into an `Actor`.
 */
export function persistedActor(actor: Actor): PersistedActor {
	switch (actor.kind) {
		case "user":
			return { actorKind: "user", actorId: actor.userId };
		case "service":
			return { actorKind: "service", actorId: actor.principalId };
		case "system":
			return { actorKind: "system", actorId: null };
	}
}

/**
 * Re-derives the persisted actor columns of a stored record — for example
 * when joining an `EconomicOperation` into a history row — without losing
 * the kind/id correlation the union encodes.
 */
export function persistedActorOf(record: PersistedActor): PersistedActor {
	switch (record.actorKind) {
		case "user":
			return { actorKind: "user", actorId: record.actorId };
		case "service":
			return { actorKind: "service", actorId: record.actorId };
		case "system":
			return { actorKind: "system", actorId: record.actorId };
	}
}

export type WalletKind = "system" | "user";

/**
 * Selects the deployment's single system wallet. Treasury reads are
 * administrative: use cases pair this selector with `AdminActor` so a
 * non-admin principal cannot express the call (the authentication/delegation and actor/visibility specifications).
 */
export type TreasuryWalletSelector = { readonly type: "treasury" };

/**
 * Selects the wallet owned by a user. User reads are self-only: use cases
 * pair this selector with the matching `UserActor` (the actor/visibility specification).
 */
export type UserWalletSelector = {
	readonly type: "user";
	readonly userId: UserId;
};

/**
 * Selects the wallet a read targets (the actor/visibility specification). The tagged union keeps
 * the treasury in its own namespace: an opaque user id can never alias it,
 * and each variant binds to the actor type allowed to read it.
 */
export type WalletSelector = TreasuryWalletSelector | UserWalletSelector;

/** Selects the deployment's single system wallet. */
export const TREASURY_SELECTOR: TreasuryWalletSelector = { type: "treasury" };

/** Selects the wallet owned by `id`. */
export function userSelector(id: UserId): UserWalletSelector {
	return { type: "user", userId: id };
}

type WalletBase = {
	readonly id: WalletId;
	readonly balance: number;
	readonly createdAt: number;
	readonly updatedAt: number;
};

/** The deployment's single system wallet; owned by no user. */
export type SystemWallet = WalletBase & {
	readonly kind: "system";
	readonly ownerUserId: null;
};

/** A wallet owned by exactly one internal User. */
export type UserWallet = WalletBase & {
	readonly kind: "user";
	readonly ownerUserId: UserId;
};

/**
 * A wallet as the application layer reads it. The discriminated union makes
 * the storage CHECK unrepresentable to violate: a system wallet has no owner,
 * a user wallet always has one.
 */
export type Wallet = SystemWallet | UserWallet;

/** A persisted EconomicOperation, including the actor/visibility specification actor columns. */
export type OperationRecord = {
	readonly id: OperationId;
	readonly kind: OperationKind;
	readonly metadata: string | null;
	readonly createdAt: number;
} & PersistedActor;

/** A persisted LedgerTransaction. */
export type LedgerRecord = {
	readonly id: LedgerId;
	readonly operationId: OperationId;
	readonly fromWalletId: WalletId;
	readonly toWalletId: WalletId;
	readonly amount: number;
	readonly createdAt: number;
};

/**
 * The operation+ledger join row a repository returns for history queries,
 * before requester-relative shaping. Owner ids are included for both
 * movement sides so the use case can derive `counterparty` (the persistence specification).
 */
export type HistoryRow = {
	readonly id: OperationId;
	readonly kind: OperationKind;
	readonly amount: number;
	readonly fromWalletId: WalletId;
	readonly fromOwnerUserId: UserId | null;
	readonly toWalletId: WalletId;
	readonly toOwnerUserId: UserId | null;
	readonly metadata: string | null;
	readonly createdAt: number;
} & PersistedActor;

/**
 * Movement direction relative to the requesting wallet (the actor/visibility specification):
 * `"in"` when value arrives, `"out"` when it leaves, `"self"` for a
 * self-movement whose net balance delta is zero (a `P2P_TRANSFER` whose
 * source and destination are the same wallet). A `TOKEN_ISSUANCE` ledger
 * row also reads `from == to == treasury`, but issuance is genuinely
 * incoming value, so it reports `"in"`.
 */
export type HistoryDirection = "in" | "out" | "self";

/**
 * One entry of a user's or the treasury's operation history (the actor/visibility specification,
 * the persistence specification). `counterparty` is `"treasury"` for a system-side movement, otherwise
 * the internal User id owning the other wallet; for a self-transfer it is
 * the requesting user themself.
 */
export type HistoryEntry = {
	readonly id: OperationId;
	readonly kind: OperationKind;
	readonly amount: number;
	readonly fromWalletId: WalletId;
	readonly toWalletId: WalletId;
	readonly metadata: string | null;
	readonly createdAt: number;
	readonly direction: HistoryDirection;
	readonly counterparty: "treasury" | UserId;
} & PersistedActor;

/**
 * One page of a cursor-paginated result. `nextCursor` is an opaque
 * continuation value owned by the repository implementation; it is `null`
 * when the result is exhausted (the actor/visibility specification).
 */
export type Page<T> = {
	readonly entries: readonly T[];
	readonly nextCursor: string | null;
};

/**
 * A persisted IdempotencyRecord (the idempotency specification): the replay
 * record of a protected mutation that committed under the
 * `(servicePrincipal, idempotencyKey)` pair. `storedResult` is the opaque
 * serialized outcome the trusted boundary replays on a matching request;
 * `fingerprintVersion` + `requestFingerprint` identify the request the
 * record belongs to, so the same key under a different request is a
 * conflict rather than a replay.
 */
export type IdempotencyRecord = {
	readonly servicePrincipal: string;
	readonly idempotencyKey: string;
	readonly fingerprintVersion: string;
	readonly requestFingerprint: string;
	readonly storedResult: string;
	readonly createdAt: number;
};

/**
 * The actor is not permitted to run this use case — for example a non-user
 * actor on a wallet-owner operation, or a non-admin actor on an
 * administrative operation (the authentication/delegation and actor/visibility specifications).
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

/**
 * A caller-supplied value violated the use case's input contract — for
 * example a history page `limit` outside `1..100` (`INVALID_LIMIT`).
 * Distinct from a kernel `rejected`: the evaluator never ran. `code` is
 * machine-readable so callers can branch on the reason without parsing
 * `detail`.
 */
export type InvalidInputError = {
	readonly type: "invalid-input";
	readonly code: "INVALID_LIMIT";
	readonly detail: string;
};

/** The expected failures a caller is meant to handle. */
export type UseCaseError = ForbiddenError | RejectedError | InvalidInputError;

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
