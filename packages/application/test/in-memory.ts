/**
 * In-memory implementations of the application ports. Test-only support:
 * they make the contract executable without a runtime while keeping the
 * same boundary discipline the production adapters must honor —
 * repositories exist only inside `transact`, ids are allocated by the
 * repository, promise-returning work is rejected, and a section commits
 * all-or-nothing.
 */

import {
	type CommunityTokenApplication,
	createCommunityTokenApplication,
} from "../src/application";
import type {
	Clock,
	LedgerRepository,
	OperationRepository,
	Synchronous,
	TransactionContext,
	TransactionScope,
	UnitOfWork,
	WalletRepository,
} from "../src/ports";
import {
	actorId,
	actorKind,
	type HistoryRow,
	type LedgerRecord,
	ledgerId,
	type OperationRecord,
	operationId,
	type Page,
	userId,
	type Wallet,
	type WalletId,
	walletId,
} from "../src/types";
import { TREASURY_ID } from "../src/use-cases/shared";

type StoredOperation = {
	readonly rowid: number;
	readonly record: OperationRecord;
};
type StoredLedger = { readonly rowid: number; readonly record: LedgerRecord };

/** The mutable state behind an in-memory `UnitOfWork`. */
export type InMemoryState = {
	wallets: Map<WalletId, Wallet>;
	operationRows: StoredOperation[];
	ledgerRows: StoredLedger[];
	nextId: number;
	nextRowid: number;
};

/** A fresh community: the treasury wallet and nothing else. */
export function createInMemoryState(): InMemoryState {
	const state: InMemoryState = {
		wallets: new Map(),
		operationRows: [],
		ledgerRows: [],
		nextId: 0,
		nextRowid: 0,
	};
	state.wallets.set(TREASURY_ID, {
		id: TREASURY_ID,
		kind: "system",
		ownerUserId: null,
		balance: 0,
		createdAt: 0,
		updatedAt: 0,
	});
	return state;
}

function walletRepository(state: InMemoryState): WalletRepository {
	return {
		findById(id) {
			return state.wallets.get(id);
		},
		findByOwnerUserId(owner) {
			for (const wallet of state.wallets.values()) {
				if (wallet.kind === "user" && wallet.ownerUserId === owner) {
					return wallet;
				}
			}
			return undefined;
		},
		setBalance(id, balance, updatedAt) {
			const wallet = state.wallets.get(id);
			if (wallet === undefined) {
				throw new Error(`setBalance on missing wallet: ${id}`);
			}
			state.wallets.set(id, { ...wallet, balance, updatedAt });
		},
		totalSupply() {
			let total = 0;
			for (const wallet of state.wallets.values()) total += wallet.balance;
			return total;
		},
	};
}

function operationRepository(state: InMemoryState): OperationRepository {
	return {
		insert(record) {
			const stored: OperationRecord = {
				id: operationId(`op-${++state.nextId}`),
				kind: record.kind,
				metadata: record.metadata,
				actorKind: actorKind(record.actor),
				actorId: actorId(record.actor),
				createdAt: record.createdAt,
			};
			state.operationRows.push({ rowid: ++state.nextRowid, record: stored });
			return stored;
		},
		listForWallet(id, cursor, limit) {
			type JoinedRow = HistoryRow & { readonly rowid: number };
			const joined: JoinedRow[] = [];
			for (const { rowid, record: entry } of state.ledgerRows) {
				if (entry.fromWalletId !== id && entry.toWalletId !== id) {
					continue;
				}
				const operation = state.operationRows.find(
					(o) => o.record.id === entry.operationId,
				);
				if (operation === undefined) {
					throw new Error(`ledger entry ${entry.id} has no operation`);
				}
				joined.push({
					rowid,
					id: operation.record.id,
					kind: operation.record.kind,
					amount: entry.amount,
					fromWalletId: entry.fromWalletId,
					fromOwnerUserId:
						state.wallets.get(entry.fromWalletId)?.ownerUserId ?? null,
					toWalletId: entry.toWalletId,
					toOwnerUserId:
						state.wallets.get(entry.toWalletId)?.ownerUserId ?? null,
					metadata: operation.record.metadata,
					actorKind: operation.record.actorKind,
					actorId: operation.record.actorId,
					createdAt: operation.record.createdAt,
				});
			}
			joined.sort((a, b) => b.rowid - a.rowid);
			const remaining =
				cursor === null
					? joined
					: joined.filter((row) => row.rowid < Number(cursor));
			const pageRows = remaining.slice(0, limit);
			const nextCursor =
				remaining.length > pageRows.length
					? String(pageRows.at(-1)?.rowid)
					: null;
			const page: Page<HistoryRow> = {
				entries: pageRows.map(({ rowid: _rowid, ...rest }) => rest),
				nextCursor,
			};
			return page;
		},
	};
}

function ledgerRepository(state: InMemoryState): LedgerRepository {
	return {
		insert(entry) {
			const stored: LedgerRecord = {
				id: ledgerId(`tx-${++state.nextId}`),
				operationId: entry.operationId,
				fromWalletId: entry.fromWalletId,
				toWalletId: entry.toWalletId,
				amount: entry.amount,
				createdAt: entry.createdAt,
			};
			state.ledgerRows.push({ rowid: ++state.nextRowid, record: stored });
			return stored;
		},
	};
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
	return (
		typeof value === "object" &&
		value !== null &&
		"then" in value &&
		typeof (value as { then: unknown }).then === "function"
	);
}

/**
 * Copies the stores a section can write. Records are immutable values, so
 * copying the containers is a faithful snapshot: a write inside the section
 * replaces a map entry or appends a row, never mutates a shared record.
 */
function cloneState(state: InMemoryState): InMemoryState {
	return {
		wallets: new Map(state.wallets),
		operationRows: [...state.operationRows],
		ledgerRows: [...state.ledgerRows],
		nextId: state.nextId,
		nextRowid: state.nextRowid,
	};
}

function commitState(target: InMemoryState, staging: InMemoryState): void {
	target.wallets = staging.wallets;
	target.operationRows = staging.operationRows;
	target.ledgerRows = staging.ledgerRows;
	target.nextId = staging.nextId;
	target.nextRowid = staging.nextRowid;
}

export type InMemoryUnitOfWorkOptions = {
	/**
	 * Fault-injection seam: transforms the section's repository scope before
	 * `work` runs — for example wrapping `operations.insert` to throw
	 * mid-section. Applied to every section this `UnitOfWork` opens.
	 */
	readonly wrapScope?:
		| ((scope: TransactionScope) => TransactionScope)
		| undefined;
};

/**
 * Binds a repository to the section's open/closed lifetime: every method
 * asserts the section is still open before delegating, so a repository
 * handle that escapes its `transact` callback can neither read nor mutate
 * state after the section closes — whether it committed or rolled back.
 */
function guardRepository<T extends object>(
	repository: T,
	assertOpen: () => void,
): T {
	return new Proxy(repository, {
		get(target, property, receiver) {
			const value = Reflect.get(target, property, receiver);
			if (typeof value !== "function") return value;
			return function (this: unknown, ...args: unknown[]) {
				assertOpen();
				return (value as (...a: unknown[]) => unknown).apply(target, args);
			};
		},
	});
}

/**
 * An in-memory `UnitOfWork` faithful to the atomic boundary it models:
 * entering a section samples the `Clock` exactly once and freezes the value
 * as `ctx.nowMs` (issue #4 §8); `work` runs against a staging copy of the
 * state that replaces the committed state only when `work` returns a
 * non-Promise result — a throw, including the runtime PromiseLike check,
 * discards the staging copy, so no observable state change survives an
 * aborted section. Repository handles are revoked when the section closes,
 * and sections do not nest: composing work shares the open
 * `TransactionContext`.
 */
export function createInMemoryUnitOfWork(
	state: InMemoryState,
	clock: Clock,
	options?: InMemoryUnitOfWorkOptions,
): UnitOfWork {
	let open = false;
	return {
		transact<R>(work: (ctx: TransactionContext) => Synchronous<R>): R {
			if (open) {
				throw new Error(
					"nested transact sections are not supported: share the open TransactionContext",
				);
			}
			open = true;
			function assertOpen() {
				if (!open) {
					throw new Error("transaction context is closed");
				}
			}
			try {
				const staging = cloneState(state);
				const scope: TransactionScope = {
					wallets: walletRepository(staging),
					operations: operationRepository(staging),
					ledger: ledgerRepository(staging),
				};
				const wrapped = options?.wrapScope?.(scope) ?? scope;
				// §8: exactly one clock sample per section, taken before any
				// caller code runs.
				const nowMs = clock.nowMs();
				const ctx: TransactionContext = {
					nowMs,
					wallets: guardRepository(wrapped.wallets, assertOpen),
					operations: guardRepository(wrapped.operations, assertOpen),
					ledger: guardRepository(wrapped.ledger, assertOpen),
				};
				const result = work(ctx);
				if (isPromiseLike(result)) {
					throw new Error(
						"atomic section must be synchronous: work returned a PromiseLike",
					);
				}
				commitState(state, staging);
				return result;
			} finally {
				open = false;
			}
		},
	};
}

/** A clock that returns `initial` and advances by `step` on every sample. */
export function stepClock(
	initial = 1_700_000_000_000,
	step = 1,
): Clock & {
	readonly current: number;
} {
	let now = initial;
	return {
		get current() {
			return now;
		},
		nowMs() {
			const value = now;
			now += step;
			return value;
		},
	};
}

/** A clock that always returns `nowMs`; every sample is identical. */
export function fixedClock(nowMs: number): Clock {
	return {
		nowMs() {
			return nowMs;
		},
	};
}

/**
 * A ready-to-use in-memory application plus the fixture handles tests need:
 * `seedUser` creates the user's wallet (registration is not an economic
 * concern and is owned by a later PR), and `state` exposes the raw stores
 * for assertions.
 */
export function createInMemoryFixture(options?: {
	readonly clock?: Clock;
	readonly wrapScope?: (scope: TransactionScope) => TransactionScope;
}): {
	readonly app: CommunityTokenApplication;
	readonly state: InMemoryState;
	readonly clock: Clock;
	readonly uow: UnitOfWork;
	seedUser(rawUserId: string): Wallet;
} {
	const state = createInMemoryState();
	const clock = options?.clock ?? stepClock();
	const uow = createInMemoryUnitOfWork(state, clock, {
		wrapScope: options?.wrapScope,
	});
	const app = createCommunityTokenApplication({ uow });
	function seedUser(rawUserId: string): Wallet {
		const owner = userId(rawUserId);
		for (const wallet of state.wallets.values()) {
			if (wallet.ownerUserId === owner) {
				throw new Error(`user already seeded: ${rawUserId}`);
			}
		}
		const wallet: Wallet = {
			id: walletId(`wallet-${++state.nextId}`),
			kind: "user",
			ownerUserId: owner,
			balance: 0,
			createdAt: 0,
			updatedAt: 0,
		};
		state.wallets.set(wallet.id, wallet);
		return wallet;
	}
	return { app, state, clock, uow, seedUser };
}
