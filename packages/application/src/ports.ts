/**
 * Ports of the application layer (transaction-consistency specification):
 * the behavioral contracts the runtime-independent use cases require from
 * their environment.
 *
 * Boundary invariant for every implementation:
 *
 *   Atomic mutation sections contain no await / external I/O.
 *   Repository operations used inside that boundary are synchronous.
 *   Async network work must complete before entering the serialized commit
 *   section.
 */

import type {
	Account,
	AccountId,
	IdempotencyRecord,
	Page,
	PrincipalId,
	PrincipalRecord,
	RegistrationIntent,
	RegistrationIntentId,
	TransactionRecord,
} from "./types";

/**
 * The application clock authority (temporal-authority specification).
 * Callers never supply authoritative timestamps; the `UnitOfWork` samples
 * the clock once per serialized section. Tests inject a fixed or stepping
 * clock.
 */
export interface Clock {
	/** Returns the current time as Unix epoch milliseconds. */
	nowMs(): number;
}

/**
 * Rejects promise-producing work at compile time: an atomic section contains
 * no `await` / external I/O. A function returning `R = Promise<X>` fails to
 * assign to `() => Synchronous<R>` because the conditional resolves to
 * `never`.
 */
export type Synchronous<R> = R extends PromiseLike<unknown> ? never : R;

/**
 * The set of repositories valid inside one atomic section. Handles exist
 * only as part of the `TransactionContext`, so repository use outside the
 * boundary is unrepresentable.
 */
export type TransactionScope = {
	readonly principals: PrincipalRepository;
	readonly accounts: AccountRepository;
	readonly defaultAccounts: DefaultAccountRepository;
	readonly transactions: TransactionRepository;
	readonly identityBindings: IdentityBindingRepository;
	readonly administrativeIssuer: AdministrativeIssuerRepository;
	readonly idempotencyRecords: IdempotencyRepository;
	readonly registrationIntents: RegistrationIntentRepository;
};

/**
 * One open atomic section: the repositories plus the section's frozen clock.
 * Use-case operations take this context so that outer orchestration can own
 * the transaction and extend the atomic unit — an idempotency record commits
 * in the same section as the monetary mutation it protects.
 *
 * The context is valid only while its owning section is open: every
 * property read and every repository method throws once the owning
 * `transact` call returns, and a stale handle never becomes usable again
 * while a later section is open. Repository values are storage-owned
 * immutable records.
 */
export type TransactionContext = TransactionScope & {
	/**
	 * The section's single frozen `now_ms` (temporal-authority
	 * specification): sampled exactly once after entering the serialized
	 * transaction and before `work` runs.
	 */
	readonly nowMs: number;
};

/**
 * The serialized atomic commit boundary every application mutation runs
 * inside (transaction-consistency specification). The production
 * implementation maps this onto the CommunityState Durable Object's
 * synchronous storage transaction.
 */
export interface UnitOfWork {
	/**
	 * Runs `work` inside one serialized atomic section and returns its
	 * result. On entry the implementation samples its `Clock` exactly once
	 * and freezes the value as `ctx.nowMs`, then invokes `work` with the
	 * open `TransactionContext`, whose handles are revoked permanently when
	 * the call returns. When `work` throws or returns a PromiseLike, no
	 * write made inside the section is persisted.
	 * @throws {Error} when `work` returns a PromiseLike (the type guard can
	 *   be escaped through `any`; implementations check at runtime too).
	 * @throws {Error} when a section is opened inside an already-open
	 *   section — sections compose by sharing one context, never by nesting.
	 */
	transact<R>(work: (ctx: TransactionContext) => Synchronous<R>): R;
}

/** The fields of a Principal the caller supplies; `id` is allocated by the repository. */
export type NewPrincipal = {
	readonly createdAt: number;
};

/**
 * Principal storage. A Principal carries no kind; it may exist without any
 * Account or IdentityBinding. Append-only — no update or deletion path.
 */
export interface PrincipalRepository {
	/** Returns the Principal with `id`, or `undefined` when it does not exist. */
	findById(id: PrincipalId): PrincipalRecord | undefined;

	/**
	 * Inserts a Principal and returns the stored record, including the id
	 * allocated at the persistence boundary.
	 */
	insert(record: NewPrincipal): PrincipalRecord;
}

/**
 * The fields of an Account the caller supplies; `id` is allocated by the
 * repository, `balance` starts at zero, and `updatedAt` equals `createdAt`
 * — Account creation never creates monetary value.
 */
export type NewAccount = {
	readonly ownerPrincipalId: PrincipalId;
	readonly createdAt: number;
};

/**
 * Account storage: lookup, zero-balance creation, absolute balance writes
 * driven by primitive effects, and the total supply fact.
 */
export interface AccountRepository {
	/** Returns the Account with `id`, or `undefined` when it does not exist. */
	findById(id: AccountId): Account | undefined;

	/**
	 * Inserts a zero-balance Account owned by `record.ownerPrincipalId` and
	 * returns the stored record including its allocated id. A Principal may
	 * own any number of Accounts.
	 * @throws {Error} when `ownerPrincipalId` names no existing Principal
	 *   (the storage foreign key rejects the insert).
	 */
	insert(record: NewAccount): Account;

	/**
	 * Sets `id`'s absolute balance and stamps `updatedAt`. Callers compute
	 * the new balance from facts read inside the same section; the
	 * repository does not accumulate deltas.
	 * @throws {Error} when `id` names no existing Account, or `balance` is
	 *   outside the monetary balance domain (storage CHECK).
	 */
	setBalance(id: AccountId, balance: number, updatedAt: number): void;

	/** Returns the sum of all Account balances — the total supply. */
	totalSupply(): number;
}

/** The fields of a default-Account designation (persistence specification). */
export type NewDefaultAccountDesignation = {
	readonly principalId: PrincipalId;
	readonly accountId: AccountId;
	readonly createdAt: number;
};

/**
 * Application-owned default-Account designation: `Principal -> Account`,
 * zero or one per Principal, and only an Account owned by that Principal.
 * It is not a generic role registry and does not alter primitive Account
 * semantics. Designations are immutable once made.
 */
export interface DefaultAccountRepository {
	/**
	 * Returns the Account designated as `principalId`'s default, or
	 * `undefined` when the Principal has no designation.
	 */
	findAccountId(principalId: PrincipalId): AccountId | undefined;

	/**
	 * Designates `designation.accountId` as the Principal's default.
	 * @throws {Error} when the Principal already has a designation, when the
	 *   Account is not owned by that Principal, or when the Account is
	 *   already designated for another Principal (storage primary key,
	 *   composite foreign key, and unique constraints).
	 */
	designate(designation: NewDefaultAccountDesignation): void;
}

/** The fields of an ISSUE the caller supplies; `id` is allocated by the repository. */
export type NewIssueTransaction = {
	readonly kind: "ISSUE";
	readonly issuerPrincipalId: PrincipalId;
	readonly destinationAccountId: AccountId;
	readonly amount: number;
	readonly committedAt: number;
};

/** The fields of a TRANSFER the caller supplies; `id` is allocated by the repository. */
export type NewTransferTransaction = {
	readonly kind: "TRANSFER";
	readonly sourceAccountId: AccountId;
	readonly destinationAccountId: AccountId;
	readonly amount: number;
	readonly committedAt: number;
};

/** A Transaction to append. */
export type NewTransaction = NewIssueTransaction | NewTransferTransaction;

/**
 * Immutable Transaction history. Append is the only mutation — the storage
 * floor rejects updates and deletes.
 */
export interface TransactionRepository {
	/**
	 * Appends a Transaction and returns the stored record, including the id
	 * allocated at the persistence boundary.
	 * @throws {Error} when a referenced Principal or Account does not exist
	 *   or the amount is outside the monetary domain (storage constraints).
	 */
	insert(record: NewTransaction): TransactionRecord;

	/**
	 * Returns the Transactions whose source or destination is `accountId`,
	 * newest first. `cursor` is the opaque continuation value from a
	 * previous call (`null` for the first page); the implementation owns
	 * its encoding. `nextCursor` is `null` when exhausted. `limit` is a
	 * positive page size already validated by the caller.
	 */
	listForAccount(
		accountId: AccountId,
		cursor: string | null,
		limit: number,
	): Page<TransactionRecord>;
}

/** The fields of an IdentityBinding the caller supplies (identity specification). */
export type NewIdentityBinding = {
	readonly issuer: string;
	readonly subject: string;
	readonly principalId: PrincipalId;
	readonly createdAt: number;
};

/**
 * IdentityBinding storage (identity specification): resolves an exact
 * `(issuer, subject)` external identity to the stable Principal it is bound
 * to. Append-only — no unlink, disable, or reassignment path.
 */
export interface IdentityBindingRepository {
	/**
	 * Returns the Principal bound to the exact `(issuer, subject)` pair, or
	 * `undefined` when no binding exists. No normalization is applied.
	 */
	findPrincipalIdByExternal(
		issuer: string,
		subject: string,
	): PrincipalId | undefined;

	/**
	 * Returns every subject bound to `principalId` under the exact
	 * `issuer`, in no particular order; empty when there is none. Used for
	 * the unique same-issuer counterparty projection.
	 */
	listSubjects(principalId: PrincipalId, issuer: string): readonly string[];

	/**
	 * Appends the IdentityBinding for `binding`'s exact pair. Called only by
	 * registration completion.
	 * @throws {Error} when the pair is already bound (storage UNIQUE).
	 */
	insert(binding: NewIdentityBinding): void;
}

/**
 * The application-owned mapping from the single administrative technical
 * authority to its stable issuer Principal. It holds at most one row, is
 * immutable once set, and is not a Principal subtype or role registry.
 */
export interface AdministrativeIssuerRepository {
	/**
	 * Returns the administrative issuer Principal, or `undefined` before
	 * initialization has created it.
	 */
	find(): PrincipalId | undefined;

	/**
	 * Records `principalId` as the administrative issuer Principal.
	 * @throws {Error} when a mapping already exists or `principalId` names
	 *   no existing Principal (storage constraints).
	 */
	insert(principalId: PrincipalId, createdAt: number): void;
}

/**
 * The fields of a RegistrationIntent the caller supplies; `id` is allocated
 * by the repository, `status` starts `"active"`, and `consumedAt` starts
 * `null`. `expiresAt` must equal `createdAt + 600_000`.
 */
export type NewRegistrationIntent = {
	readonly expectedIssuer: string;
	readonly expectedSubject: string;
	readonly state: string;
	readonly nonce: string;
	readonly proofKeySecret: string;
	readonly createdAt: number;
	readonly expiresAt: number;
};

/**
 * RegistrationIntent storage (registration specification), keyed by the
 * unguessable `state` correlation value. Only `active -> consumed` and
 * `active -> superseded` transitions are legal and identity/proof columns
 * are immutable.
 */
export interface RegistrationIntentRepository {
	/**
	 * Returns the intent with the exact `state`, or `undefined`. Expiry
	 * evaluation (`nowMs >= expiresAt`) is the caller's job.
	 */
	findByState(state: string): RegistrationIntent | undefined;

	/**
	 * Marks every status-`active` intent of the exact pair `superseded`,
	 * including already-expired ones. Non-active rows are untouched.
	 */
	supersedeActive(expectedIssuer: string, expectedSubject: string): void;

	/**
	 * Inserts a new status-`active` intent and returns the stored record.
	 * @throws {Error} when `expiresAt !== createdAt + 600_000` or another
	 *   active intent exists for the pair (storage constraints).
	 */
	insert(record: NewRegistrationIntent): RegistrationIntent;

	/**
	 * Marks the intent `id` `consumed` at `consumedAt`.
	 * @throws {Error} when `id` is not status-`active`.
	 */
	markConsumed(id: RegistrationIntentId, consumedAt: number): void;
}

/**
 * IdempotencyRecord storage (idempotency specification), keyed by
 * `(technicalCaller, idempotencyKey)`. Append is the only mutation — a
 * record is written only when the protected mutation it guards commits in
 * the same section, and records never expire or change.
 */
export interface IdempotencyRepository {
	/**
	 * Returns the replay record for the pair, or `undefined` when no
	 * protected mutation has committed under it.
	 */
	find(
		technicalCaller: string,
		idempotencyKey: string,
	): IdempotencyRecord | undefined;

	/**
	 * Persists `record` as the replay record of a committed protected
	 * mutation.
	 * @throws {Error} when a record for the pair already exists.
	 */
	insert(record: IdempotencyRecord): void;
}
