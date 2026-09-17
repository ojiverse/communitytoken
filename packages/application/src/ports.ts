/**
 * Ports of the application layer (issue #4 §2): the behavioral contracts the
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
	LedgerRecord,
	OperationId,
	OperationKind,
	OperationRecord,
	Page,
	UserId,
	Wallet,
	WalletId,
} from "./types";

/**
 * The application clock authority (issue #4 §8). Callers never supply
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
};

/**
 * One open atomic section: the repositories plus the section's frozen clock.
 * Use-case operations take this context so that outer orchestration can own
 * the transaction and extend the atomic unit — an idempotency check and its
 * recorded result, or a Daily Reward claim row, commit in the same section
 * as the economic mutation (issue #4 §3, §12, §16).
 *
 * The context is valid only while its section is open: every repository
 * method it exposes throws once the owning `transact` call returns —
 * handles must not outlive the boundary.
 */
export type TransactionContext = TransactionScope & {
	/**
	 * The section's single frozen `now_ms` (issue #4 §8): the `UnitOfWork`
	 * implementation samples its `Clock` exactly once after entering the
	 * serialized transaction and before `work` runs, so every timestamped
	 * write in the section shares one value and a clock read during the
	 * callback cannot split it.
	 */
	readonly nowMs: number;
};

/**
 * The serialized atomic commit boundary every application mutation runs
 * inside (issue #4 §2–§3). The production implementation maps this onto the
 * CommunityState Durable Object's synchronous storage transaction; the
 * boundary is a contract of this layer, not a Cloudflare type.
 */
export interface UnitOfWork {
	/**
	 * Runs `work` inside one serialized atomic section and returns its
	 * result. On entry the implementation samples its `Clock` exactly once
	 * and freezes the value as `ctx.nowMs` (issue #4 §8), then invokes
	 * `work` with the open `TransactionContext`: repository handles valid
	 * only for this section — they are revoked when the call returns, so a
	 * captured context or repository cannot read or write outside the
	 * boundary. When the section does not commit — `work` throws or
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

	/** Returns the sum of all wallet balances — the §4 `supply(S)` fact. */
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
 * join each operation to its ledger movement (the §4 `op : L -> O`
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
	 * encoding (production encodes the storage rowid per issue #4 §22).
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
 * append-only as a matter of storage-enforced semantics (issue #4 §3).
 */
export interface LedgerRepository {
	/**
	 * Appends a LedgerTransaction bound to `entry.operationId` and returns
	 * the stored record, including the id allocated at the persistence
	 * boundary.
	 */
	insert(entry: NewLedgerEntry): LedgerRecord;
}
