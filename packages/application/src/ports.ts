/**
 * Ports of the application layer (the transaction-consistency specification): the behavioral contracts the
 * runtime-independent use cases require from their environment. Only the
 * ports consumed by the initial economic use cases are declared here; later
 * phases add theirs with the feature that consumes them.
 *
 * Boundary invariant for every implementation:
 *
 *   Atomic mutation sections contain no await / external I/O.
 *   Repository operations used inside that boundary are synchronous.
 *   Async network work must complete before entering the serialized commit
 *   section.
 */

import type {
	Actor,
	HistoryRow,
	IdempotencyRecord,
	LedgerRecord,
	OperationId,
	OperationKind,
	OperationRecord,
	Page,
	RegistrationIntent,
	RegistrationIntentId,
	UserId,
	UserRecord,
	UserWallet,
	Wallet,
	WalletId,
} from "./types";

/**
 * The application clock authority (the temporal-authority specification). Callers never supply
 * authoritative timestamps; the production implementation samples
 * `Date.now()` once inside each serialized transaction and serves that
 * frozen value for the whole transaction. Tests inject a fixed or stepping
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
	readonly wallets: WalletRepository;
	readonly operations: OperationRepository;
	readonly ledger: LedgerRepository;
	readonly identityBindings: IdentityBindingRepository;
	readonly idempotencyRecords: IdempotencyRepository;
	readonly users: UserRepository;
	readonly registrationIntents: RegistrationIntentRepository;
};

/**
 * One open atomic section: the repositories plus the section's frozen clock.
 * Use-case operations take this context so that outer orchestration can own
 * the transaction and extend the atomic unit — an idempotency check and its
 * recorded result, or a Daily Reward claim row, commit in the same section
 * as the economic mutation (the transaction, idempotency, and Daily Reward specifications).
 *
 * The context is valid only while its owning section is open: every
 * repository method it exposes throws once the owning `transact` call
 * returns — handles must not outlive the boundary, and a stale handle
 * never becomes usable again while a later section is open. Repository
 * values are storage-owned immutable records: they cannot alias-mutate
 * repository state, which only changes through repository mutation
 * methods.
 */
export type TransactionContext = TransactionScope & {
	/**
	 * The section's single frozen `now_ms` (the temporal-authority specification): the `UnitOfWork`
	 * implementation samples its `Clock` exactly once after entering the
	 * serialized transaction and before `work` runs, so every timestamped
	 * write in the section shares one value and a clock read during the
	 * callback cannot split it.
	 */
	readonly nowMs: number;
};

/**
 * The serialized atomic commit boundary every application mutation runs
 * inside (the transaction-consistency specification). The production implementation maps this onto the
 * CommunityState Durable Object's synchronous storage transaction; the
 * boundary is a contract of this layer, not a Cloudflare type.
 */
export interface UnitOfWork {
	/**
	 * Runs `work` inside one serialized atomic section and returns its
	 * result. On entry the implementation samples its `Clock` exactly once
	 * and freezes the value as `ctx.nowMs` (the temporal-authority specification), then invokes
	 * `work` with the open `TransactionContext`: repository handles valid
	 * only for this section — they are revoked permanently when the call
	 * returns, so a captured context or repository cannot read or write
	 * outside the boundary, and it never becomes usable again while a
	 * later section is open. When the section does not commit — `work` throws or
	 * returns a PromiseLike — no repository write made inside it is
	 * persisted; a rejected use case persists nothing at all. `work` must
	 * be synchronous — `Synchronous<R>` rejects promise-returning functions
	 * at compile time.
	 * @throws {Error} when `work` returns a PromiseLike (the type guard can
	 *   be escaped through `any`; implementations must check at runtime too).
	 * @throws {Error} when a section is opened inside an already-open
	 *   section — sections compose by sharing one context, never by nesting.
	 */
	transact<R>(work: (ctx: TransactionContext) => Synchronous<R>): R;
}

/**
 * Wallets as the use cases need them: lookup by id or owning user, absolute
 * balance writes driven by kernel `EconomicEffect` deltas, and the total
 * supply fact the evaluator requires.
 */
export interface WalletRepository {
	/** Returns the wallet with `id`, or `undefined` when it does not exist. */
	findById(id: WalletId): Wallet | undefined;

	/**
	 * Returns the `user`-kind wallet owned by `userId`, or `undefined` when
	 * the user owns none (unregistered user or absent wallet).
	 */
	findByOwnerUserId(userId: UserId): Wallet | undefined;

	/**
	 * Sets `id`'s absolute balance to `balance` and stamps `updatedAt`.
	 * Callers compute the new balance from facts read inside the same
	 * transaction; the repository does not accumulate deltas.
	 */
	setBalance(id: WalletId, balance: number, updatedAt: number): void;

	/**
	 * Inserts the single zero-balance `user`-kind wallet owned by
	 * `record.ownerUserId` and returns the stored wallet, including the id
	 * allocated at the persistence boundary. `updatedAt` equals
	 * `createdAt`. Only registration creates user wallets, so no
	 * general-purpose wallet insert exists — the kind/balance fields are
	 * not caller-supplied.
	 * @throws {Error} when `ownerUserId` already owns a wallet (the storage
	 *   UNIQUE constraint on `owner_user_id` rejects the insert).
	 */
	insertUserWallet(record: NewUserWallet): UserWallet;

	/** Returns the sum of all wallet balances — the economic-state specification `supply(S)` fact. */
	totalSupply(): number;
}

/** The fields of an EconomicOperation the caller supplies; `id` is allocated by the repository. */
export type NewOperation = {
	readonly kind: OperationKind;
	readonly metadata: string | null;
	readonly actor: Actor;
	readonly createdAt: number;
};

/**
 * EconomicOperation records. Append is the only mutation; history queries
 * join each operation to its ledger movement (the economic-state specification `op : L -> O`
 * correspondence is a bijection in the current model).
 */
export interface OperationRepository {
	/**
	 * Appends a new EconomicOperation and returns the stored record,
	 * including the id allocated at the persistence boundary and the
	 * `actor_kind`/`actor_id` columns derived from `record.actor`.
	 */
	insert(record: NewOperation): OperationRecord;

	/**
	 * Returns the operation+ledger join rows whose movement touches
	 * `walletId` (`from_wallet_id` or `to_wallet_id` equals it), newest
	 * first. `cursor` is the opaque continuation value from a previous call;
	 * pass `null` for the first page. The implementation owns the cursor
	 * encoding (production encodes the storage rowid per the persistence specification).
	 * `nextCursor` is `null` when the result is exhausted. `limit` is a
	 * positive page size already validated by the caller.
	 */
	listForWallet(
		walletId: WalletId,
		cursor: string | null,
		limit: number,
	): Page<HistoryRow>;
}

/** The fields of a LedgerTransaction the caller supplies; `id` is allocated by the repository. */
export type NewLedgerEntry = {
	readonly operationId: OperationId;
	readonly fromWalletId: WalletId;
	readonly toWalletId: WalletId;
	readonly amount: number;
	readonly createdAt: number;
};

/**
 * LedgerTransaction records. Append is the only mutation — the ledger is
 * append-only as a matter of storage-enforced semantics (the transaction-consistency specification).
 */
export interface LedgerRepository {
	/**
	 * Appends a LedgerTransaction bound to `entry.operationId` and returns
	 * the stored record, including the id allocated at the persistence
	 * boundary.
	 */
	insert(entry: NewLedgerEntry): LedgerRecord;
}

/**
 * The fields of a user-owned Wallet the caller supplies; `id` is allocated
 * by the repository and `kind`, `balance`, and `updatedAt` are fixed to
 * `"user"`, `0`, and `createdAt` — a registration wallet cannot be a system
 * wallet or carry a non-zero balance.
 */
export type NewUserWallet = {
	readonly ownerUserId: UserId;
	readonly createdAt: number;
};

/** The fields of a User the caller supplies; `id` is allocated by the repository. */
export type NewUser = {
	readonly createdAt: number;
};

/** The fields of an IdentityBinding the caller supplies (the identity specification). */
export type NewIdentityBinding = {
	readonly issuer: string;
	readonly subject: string;
	readonly userId: UserId;
	readonly createdAt: number;
};

/**
 * The fields of a RegistrationIntent the caller supplies; `id` is allocated
 * by the repository, `status` starts `"active"`, and `consumedAt` starts
 * `null`. `expiresAt` must equal `createdAt + 600_000` (the storage CHECK
 * enforces it).
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
 * IdentityBinding storage (the identity specification): resolves an exact
 * `(issuer, subject)` external identity to the stable internal User it is
 * bound to. Creation is registration-owned — `insert` exists only so the
 * registration completion section can commit the binding atomically with
 * the User and wallet it points to. No unlink/disable/reassignment path
 * exists in Phase 2.
 */
export interface IdentityBindingRepository {
	/**
	 * Returns the internal User bound to the exact `(issuer, subject)`
	 * pair, or `undefined` when no binding exists. Both arguments are
	 * already wire-validated non-empty strings; no normalization is
	 * applied — the lookup is an exact match.
	 */
	findUserIdByExternal(issuer: string, subject: string): UserId | undefined;

	/**
	 * Appends the IdentityBinding for `binding`'s exact `(issuer, subject)`
	 * pair. Called only inside the registration completion section.
	 * @throws {Error} when the `(issuer, subject)` pair is already bound
	 *   (the storage UNIQUE constraint rejects the insert).
	 */
	insert(binding: NewIdentityBinding): void;
}

/**
 * User storage (the identity specification): registration allocates a
 * stable internal User per proven external identity. Append-only — a User
 * has no update or deletion path in Phase 2.
 */
export interface UserRepository {
	/**
	 * Inserts a User and returns the stored record, including the id
	 * allocated at the persistence boundary (`crypto.randomUUID()`).
	 */
	insert(record: NewUser): UserRecord;
}

/**
 * RegistrationIntent storage (the registration specification): the
 * one-shot registration transaction state keyed by the unguessable
 * `state` correlation value. Lifecycle is storage-enforced: only
 * `active -> consumed` (non-null `consumed_at`) and
 * `active -> superseded` (null `consumed_at`) transitions are legal, and
 * identity/proof columns are immutable.
 */
export interface RegistrationIntentRepository {
	/**
	 * Returns the intent with the exact `state` correlation value, or
	 * `undefined` when none exists. The status/lifecycle columns are
	 * returned verbatim — expiry evaluation (`nowMs >= expiresAt`) is the
	 * caller's job.
	 */
	findByState(state: string): RegistrationIntent | undefined;

	/**
	 * Marks every status-`active` intent of the exact
	 * `(expectedIssuer, expectedSubject)` pair `superseded` — including
	 * already-expired ones, which keeps the partial unique index from
	 * blocking the replacement insert. Non-active rows are untouched.
	 */
	supersedeActive(expectedIssuer: string, expectedSubject: string): void;

	/**
	 * Inserts a new status-`active` intent and returns the stored record,
	 * including the id allocated at the persistence boundary
	 * (`crypto.randomUUID()`).
	 * @throws {Error} when `record.expiresAt !== record.createdAt +
	 *   600_000` or another active intent exists for the pair (storage
	 *   CHECK / partial unique index reject the insert).
	 */
	insert(record: NewRegistrationIntent): RegistrationIntent;

	/**
	 * Marks the intent `id` `consumed` at `consumedAt` — the single-use
	 * terminal transition. Only ever called on a status-`active` row.
	 * @throws {Error} when `id` is not status-`active` (the lifecycle
	 *   trigger rejects the transition).
	 */
	markConsumed(id: RegistrationIntentId, consumedAt: number): void;
}

/**
 * IdempotencyRecord storage (the idempotency specification): the durable
 * replay table keyed by `(servicePrincipal, idempotencyKey)`. Append is the
 * only mutation — a record is written only when the protected mutation it
 * guards commits in the same serialized section, and records never expire
 * or change.
 */
export interface IdempotencyRepository {
	/**
	 * Returns the stored replay record for the
	 * `(servicePrincipal, idempotencyKey)` pair, or `undefined` when no
	 * protected mutation has ever committed under that pair.
	 */
	find(
		servicePrincipal: string,
		idempotencyKey: string,
	): IdempotencyRecord | undefined;

	/**
	 * Persists `record` as the replay record of a committed protected
	 * mutation. Called at most once per `(servicePrincipal,
	 * idempotencyKey)` pair — the storage floor enforces uniqueness.
	 * @throws {Error} when a record for the pair already exists.
	 */
	insert(record: IdempotencyRecord): void;
}
