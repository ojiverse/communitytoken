/**
 * Domain types of the application layer (see docs/specification). These
 * types are provider- and runtime-independent: they name internal
 * identifiers and application records, never external provider identifiers
 * or platform types. The primitive monetary vocabulary is Principal,
 * Account, and Transaction with ISSUE and TRANSFER as the only kinds.
 */

import type {
	RejectionCode,
	TransactionKind,
} from "@communitytoken/economic-kernel";

export type { RejectionCode, TransactionKind };

declare const brand: unique symbol;

/**
 * An opaque identifier: a `T` whose origin is fixed to `B` at compile time.
 * Branding keeps internal identifiers non-substitutable with each other and
 * with external identifiers such as an OIDC `sub` (the identity and
 * persistence specifications).
 */
export type Brand<T, B> = T & { readonly [brand]: B };

/**
 * Opaque, stable internal identifier of a Principal. Never derived from an
 * external provider; an ExternalIdentity resolves to it through an
 * IdentityBinding at the trusted boundary.
 */
export type PrincipalId = Brand<string, "PrincipalId">;

/** Opaque identifier of an Account. */
export type AccountId = Brand<string, "AccountId">;

/** Opaque identifier of a committed Transaction. */
export type TransactionId = Brand<string, "TransactionId">;

/** Opaque identifier of a persisted RegistrationIntent. */
export type RegistrationIntentId = Brand<string, "RegistrationIntentId">;

function principalId(raw: string): PrincipalId {
	return raw as PrincipalId;
}

function accountId(raw: string): AccountId {
	return raw as AccountId;
}

function transactionId(raw: string): TransactionId {
	return raw as TransactionId;
}

function registrationIntentId(raw: string): RegistrationIntentId {
	return raw as RegistrationIntentId;
}

/**
 * Rehydration of persisted identifiers: brands raw storage strings as
 * opaque ids. This is the visible unsafe boundary — only persistence
 * adapters and test support may turn an arbitrary string into an internal
 * id; the application API consumes already-branded values. Identifier
 * allocation belongs to the persistence boundary.
 */
export const rehydrate = {
	principalId,
	accountId,
	transactionId,
	registrationIntentId,
} as const;

/**
 * An exact external identity: the ordered `(issuer, subject)` pair. The
 * full pair is the identity key — subject alone is insufficient (identity
 * specification).
 */
export type ExternalIdentity = {
	readonly issuer: string;
	readonly subject: string;
};

/**
 * The authenticated administrative technical caller. It is a technical
 * authority, not a domain Principal: the application maps it to the one
 * stable administrative issuer Principal (authentication/delegation
 * specification).
 */
export const ADMIN_API_CALLER = "admin-api";

/** The type of the administrative technical caller. */
export type AdministrativeCaller = typeof ADMIN_API_CALLER;

/** A persisted Principal. Carries no kind or subtype. */
export type PrincipalRecord = {
	readonly id: PrincipalId;
	readonly createdAt: number;
};

/**
 * A persisted Account: a non-negative balance container owned by exactly
 * one Principal. There is no Account kind or role.
 */
export type Account = {
	readonly id: AccountId;
	readonly ownerPrincipalId: PrincipalId;
	readonly balance: number;
	readonly createdAt: number;
	readonly updatedAt: number;
};

/** A committed ISSUE: issuer Principal present, source absent. */
export type IssueTransactionRecord = {
	readonly id: TransactionId;
	readonly kind: "ISSUE";
	readonly issuerPrincipalId: PrincipalId;
	readonly sourceAccountId: null;
	readonly destinationAccountId: AccountId;
	readonly amount: number;
	readonly committedAt: number;
};

/** A committed TRANSFER: source present, no issuer or actor. */
export type TransferTransactionRecord = {
	readonly id: TransactionId;
	readonly kind: "TRANSFER";
	readonly issuerPrincipalId: null;
	readonly sourceAccountId: AccountId;
	readonly destinationAccountId: AccountId;
	readonly amount: number;
	readonly committedAt: number;
};

/**
 * One immutable committed Transaction. The union encodes the structural
 * rule at compile time: ISSUE carries an issuer and no source, TRANSFER a
 * source and no issuer.
 */
export type TransactionRecord =
	| IssueTransactionRecord
	| TransferTransactionRecord;

/**
 * Direction relative to the viewed Account (actor-and-visibility
 * specification): `"in"` when value arrives (every ISSUE into the viewed
 * Account), `"out"` when it leaves, `"self"` for a TRANSFER whose source
 * and destination are both the viewed Account.
 */
export type HistoryDirection = "in" | "out" | "self";

/**
 * One self-history entry. It exposes primitive Transaction facts plus the
 * product projection, never an internal Principal or Account identifier.
 * `counterparty` is `null` for ISSUE and for a TRANSFER whose other
 * Principal has zero or several bindings under the caller's issuer.
 */
export type HistoryEntry = {
	readonly transactionId: TransactionId;
	readonly kind: TransactionKind;
	readonly amount: number;
	readonly committedAt: number;
	readonly direction: HistoryDirection;
	readonly counterparty: ExternalIdentity | null;
};

/**
 * One page of a cursor-paginated result. `nextCursor` is an opaque
 * continuation value owned by the repository implementation; it is `null`
 * when the result is exhausted.
 */
export type Page<T> = {
	readonly entries: readonly T[];
	readonly nextCursor: string | null;
};

/** The `status` values persisted on registration intents (registration specification). */
export type RegistrationIntentStatus = "active" | "consumed" | "superseded";

/**
 * A persisted RegistrationIntent (registration specification): a one-shot
 * registration transaction fixing one expected external identity, the
 * correlation `state`, the authentication `nonce`, and the
 * provider-independent proof-key secret. `expiresAt` is exactly
 * `createdAt + 600_000`; `consumedAt` is set iff `status` is `"consumed"`.
 * An intent may remain status-`active` past `expiresAt`, but is then
 * unusable.
 */
export type RegistrationIntent = {
	readonly id: RegistrationIntentId;
	readonly expectedIssuer: string;
	readonly expectedSubject: string;
	readonly state: string;
	readonly nonce: string;
	readonly proofKeySecret: string;
	readonly status: RegistrationIntentStatus;
	readonly createdAt: number;
	readonly expiresAt: number;
	readonly consumedAt: number | null;
};

/**
 * A persisted IdempotencyRecord (idempotency specification): the replay
 * record of a protected mutation that committed under the
 * `(technicalCaller, idempotencyKey)` pair. `storedResult` is the opaque
 * serialized outcome the trusted boundary replays on a matching request;
 * `fingerprintVersion` + `requestFingerprint` identify the request the
 * record belongs to. It is replay state only — never the authority for
 * ISSUE provenance.
 */
export type IdempotencyRecord = {
	readonly technicalCaller: string;
	readonly idempotencyKey: string;
	readonly fingerprintVersion: string;
	readonly requestFingerprint: string;
	readonly storedResult: string;
	readonly createdAt: number;
};

/** The technical caller is not permitted to run this use case. */
export type ForbiddenError = {
	readonly type: "forbidden";
	readonly detail: string;
};

/** The primitive evaluator rejected the transition; `code` is passed through verbatim. */
export type RejectedError = {
	readonly type: "rejected";
	readonly code: RejectionCode;
	readonly detail: string;
};

/**
 * A caller-supplied value violated the use case's input contract — for
 * example a history page `limit` outside `1..100`. The evaluator never ran.
 */
export type InvalidInputError = {
	readonly type: "invalid-input";
	readonly code: "INVALID_LIMIT";
	readonly detail: string;
};

/**
 * An ExternalIdentity could not be resolved to a Principal's default
 * Account: the identity is unbound, or its Principal has no default
 * Account designation. The `RECIPIENT_` codes name the transfer
 * destination side.
 */
export type UnresolvedError = {
	readonly type: "unresolved";
	readonly code:
		| "IDENTITY_NOT_BOUND"
		| "DEFAULT_ACCOUNT_NOT_DESIGNATED"
		| "RECIPIENT_NOT_BOUND"
		| "RECIPIENT_DEFAULT_ACCOUNT_NOT_DESIGNATED";
	readonly detail: string;
};

/** The expected failures a caller is meant to handle. */
export type UseCaseError =
	| ForbiddenError
	| RejectedError
	| InvalidInputError
	| UnresolvedError;

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
