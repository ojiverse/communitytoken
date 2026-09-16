/**
 * In-memory implementations of the application ports. Test-only support:
 * they make the contract executable without a runtime while keeping the
 * same boundary discipline the production adapters must honor —
 * repositories exist only inside `transact`, ids are allocated by the
 * repository, and promise-returning work is rejected.
 */

import { TREASURY_WALLET_ID } from "@communitytoken/economic-kernel";
import {
	type CommunityTokenApplication,
	createCommunityTokenApplication,
} from "../src/application";
import type {
	Clock,
	LedgerRepository,
	OperationRepository,
	Synchronous,
	TransactionScope,
	UnitOfWork,
	WalletRepository,
} from "../src/ports";
import {
	actorId,
	actorKind,
	type HistoryRow,
	type LedgerRecord,
	type OperationRecord,
	type Page,
	type UserId,
	type Wallet,
	type WalletId,
} from "../src/types";

type StoredOperation = {
	readonly rowid: number;
	readonly record: OperationRecord;
};
type StoredLedger = { readonly rowid: number; readonly record: LedgerRecord };

/** The mutable state behind an in-memory `UnitOfWork`. */
export type InMemoryState = {
	readonly wallets: Map<WalletId, Wallet>;
	readonly operationRows: StoredOperation[];
	readonly ledgerRows: StoredLedger[];
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
	state.wallets.set(TREASURY_WALLET_ID, {
		id: TREASURY_WALLET_ID,
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
		findByOwnerUserId(userId) {
			for (const wallet of state.wallets.values()) {
				if (wallet.kind === "user" && wallet.ownerUserId === userId) {
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
				id: `op-${++state.nextId}`,
				kind: record.kind,
				metadata: record.metadata,
				actorKind: actorKind(record.actor),
				actorId: actorId(record.actor),
				createdAt: record.createdAt,
			};
			state.operationRows.push({ rowid: ++state.nextRowid, record: stored });
			return stored;
		},
		listForWallet(walletId, cursor, limit) {
			type JoinedRow = HistoryRow & { readonly rowid: number };
			const joined: JoinedRow[] = [];
			for (const { rowid, record: entry } of state.ledgerRows) {
				if (entry.fromWalletId !== walletId && entry.toWalletId !== walletId) {
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
				id: `tx-${++state.nextId}`,
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

/**
 * An in-memory `UnitOfWork`: `work` runs immediately against shared state.
 * The section still enforces the boundary invariant — promise-returning
 * work is rejected at runtime, mirroring what production adapters must do.
 */
export function createInMemoryUnitOfWork(state: InMemoryState): UnitOfWork {
	const scope: TransactionScope = {
		wallets: walletRepository(state),
		operations: operationRepository(state),
		ledger: ledgerRepository(state),
	};
	return {
		transact<R>(work: (tx: TransactionScope) => Synchronous<R>): R {
			const result = work(scope);
			if (
				typeof result === "object" &&
				result !== null &&
				"then" in result &&
				typeof result.then === "function"
			) {
				throw new Error(
					"atomic section must be synchronous: work returned a PromiseLike",
				);
			}
			return result;
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
export function createInMemoryFixture(options?: { readonly clock?: Clock }): {
	readonly app: CommunityTokenApplication;
	readonly state: InMemoryState;
	readonly clock: Clock;
	seedUser(userId: UserId): Wallet;
} {
	const state = createInMemoryState();
	const clock = options?.clock ?? stepClock();
	const app = createCommunityTokenApplication({
		uow: createInMemoryUnitOfWork(state),
		clock,
	});
	function seedUser(userId: UserId): Wallet {
		for (const wallet of state.wallets.values()) {
			if (wallet.ownerUserId === userId) {
				throw new Error(`user already seeded: ${userId}`);
			}
		}
		const wallet: Wallet = {
			id: `wallet-${++state.nextId}`,
			kind: "user",
			ownerUserId: userId,
			balance: 0,
			createdAt: 0,
			updatedAt: 0,
		};
		state.wallets.set(wallet.id, wallet);
		return wallet;
	}
	return { app, state, clock, seedUser };
}
