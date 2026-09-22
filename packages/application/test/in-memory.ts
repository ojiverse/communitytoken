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
	IdempotencyRepository,
	IdentityBindingRepository,
	LedgerRepository,
	OperationRepository,
	RegistrationIntentRepository,
	Synchronous,
	TransactionContext,
	TransactionScope,
	UnitOfWork,
	UserRepository,
	WalletRepository,
} from "../src/ports";
import {
	type HistoryRow,
	type IdempotencyRecord,
	type LedgerRecord,
	ledgerId,
	type OperationRecord,
	operationId,
	type Page,
	persistedActor,
	persistedActorOf,
	type RegistrationIntent,
	type RegistrationIntentId,
	registrationIntentId,
	type UserId,
	type UserRecord,
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

/**
 * The mutable state behind an in-memory `UnitOfWork`. `identityBindings`
 * keys an exact `(issuer, subject)` pair and `idempotencyRecords` keys a
 * `(servicePrincipal, idempotencyKey)` pair — both encoded as
 * `JSON.stringify([a, b])` so no separator can collide with content.
 */
export type InMemoryState = {
	wallets: Map<WalletId, Wallet>;
	operationRows: StoredOperation[];
	ledgerRows: StoredLedger[];
	identityBindings: Map<string, UserId>;
	idempotencyRecords: Map<string, IdempotencyRecord>;
	users: Map<UserId, UserRecord>;
	registrationIntents: Map<RegistrationIntentId, RegistrationIntent>;
	nextId: number;
	nextRowid: number;
};

/** A fresh community: the treasury wallet and nothing else. */
export function createInMemoryState(): InMemoryState {
	const state: InMemoryState = {
		wallets: new Map(),
		operationRows: [],
		ledgerRows: [],
		identityBindings: new Map(),
		idempotencyRecords: new Map(),
		users: new Map(),
		registrationIntents: new Map(),
		nextId: 0,
		nextRowid: 0,
	};
	// Stored records are frozen: a value handed out by a repository can
	// never alias-mutate storage state — updates only happen through
	// repository mutation methods, which store fresh frozen records.
	const treasury: Wallet = {
		id: TREASURY_ID,
		kind: "system",
		ownerUserId: null,
		balance: 0,
		createdAt: 0,
		updatedAt: 0,
	};
	state.wallets.set(TREASURY_ID, Object.freeze(treasury));
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
			state.wallets.set(id, Object.freeze({ ...wallet, balance, updatedAt }));
		},
		insertUserWallet(record) {
			const wallet: Wallet = {
				id: walletId(`wallet-${++state.nextId}`),
				kind: "user",
				ownerUserId: record.ownerUserId,
				balance: 0,
				createdAt: record.createdAt,
				updatedAt: record.createdAt,
			};
			if (this.findByOwnerUserId(record.ownerUserId) !== undefined) {
				throw new Error(`user already owns a wallet: ${record.ownerUserId}`);
			}
			state.wallets.set(wallet.id, Object.freeze(wallet));
			return wallet;
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
			const stored: OperationRecord = Object.freeze({
				id: operationId(`op-${++state.nextId}`),
				kind: record.kind,
				metadata: record.metadata,
				createdAt: record.createdAt,
				...persistedActor(record.actor),
			});
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
					createdAt: operation.record.createdAt,
					...persistedActorOf(operation.record),
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
			const stored: LedgerRecord = Object.freeze({
				id: ledgerId(`tx-${++state.nextId}`),
				operationId: entry.operationId,
				fromWalletId: entry.fromWalletId,
				toWalletId: entry.toWalletId,
				amount: entry.amount,
				createdAt: entry.createdAt,
			});
			state.ledgerRows.push({ rowid: ++state.nextRowid, record: stored });
			return stored;
		},
	};
}

function identityBindingRepository(
	state: InMemoryState,
): IdentityBindingRepository {
	return {
		findUserIdByExternal(issuer, subject) {
			return state.identityBindings.get(JSON.stringify([issuer, subject]));
		},
		insert(binding) {
			const key = JSON.stringify([binding.issuer, binding.subject]);
			if (state.identityBindings.has(key)) {
				throw new Error(
					`identity already bound: ${binding.issuer}:${binding.subject}`,
				);
			}
			state.identityBindings.set(key, binding.userId);
		},
	};
}

function userRepository(state: InMemoryState): UserRepository {
	return {
		insert(record) {
			const user: UserRecord = Object.freeze({
				id: userId(`user-${++state.nextId}`),
				createdAt: record.createdAt,
			});
			state.users.set(user.id, user);
			return user;
		},
	};
}

/**
 * In-memory RegistrationIntent storage with the same lifecycle floor the
 * production triggers enforce: only `active -> consumed` /
 * `active -> superseded` transitions exist, and `supersedeActive` covers
 * every status-active row of the pair, expired or not.
 */
function registrationIntentRepository(
	state: InMemoryState,
): RegistrationIntentRepository {
	return {
		findByState(state_) {
			for (const intent of state.registrationIntents.values()) {
				if (intent.state === state_) return intent;
			}
			return undefined;
		},
		supersedeActive(expectedIssuer, expectedSubject) {
			for (const intent of state.registrationIntents.values()) {
				if (
					intent.expectedIssuer === expectedIssuer &&
					intent.expectedSubject === expectedSubject &&
					intent.status === "active"
				) {
					state.registrationIntents.set(
						intent.id,
						Object.freeze({ ...intent, status: "superseded" }),
					);
				}
			}
		},
		insert(record) {
			if (record.expiresAt !== record.createdAt + 600_000) {
				throw new Error("expiresAt must equal createdAt + 600000");
			}
			for (const intent of state.registrationIntents.values()) {
				if (
					intent.status === "active" &&
					intent.expectedIssuer === record.expectedIssuer &&
					intent.expectedSubject === record.expectedSubject
				) {
					throw new Error(
						`active intent already exists for ${record.expectedIssuer}:${record.expectedSubject}`,
					);
				}
				if (intent.state === record.state) {
					throw new Error(`duplicate intent state: ${record.state}`);
				}
			}
			const intent: RegistrationIntent = Object.freeze({
				id: registrationIntentId(`intent-${++state.nextId}`),
				...record,
				status: "active",
				consumedAt: null,
			});
			state.registrationIntents.set(intent.id, intent);
			return intent;
		},
		markConsumed(id, consumedAt) {
			const intent = state.registrationIntents.get(id);
			if (intent === undefined) {
				throw new Error(`markConsumed on missing intent: ${id}`);
			}
			if (intent.status !== "active") {
				throw new Error(
					`illegal intent transition: ${intent.status} -> consumed`,
				);
			}
			state.registrationIntents.set(
				id,
				Object.freeze({ ...intent, status: "consumed", consumedAt }),
			);
		},
	};
}

function idempotencyRepository(state: InMemoryState): IdempotencyRepository {
	const key = (principal: string, idempotencyKey: string) =>
		JSON.stringify([principal, idempotencyKey]);
	return {
		find(servicePrincipal, idempotencyKey) {
			return state.idempotencyRecords.get(
				key(servicePrincipal, idempotencyKey),
			);
		},
		insert(record) {
			const k = key(record.servicePrincipal, record.idempotencyKey);
			if (state.idempotencyRecords.has(k)) {
				throw new Error(
					`duplicate idempotency record: ${record.servicePrincipal}/${record.idempotencyKey}`,
				);
			}
			state.idempotencyRecords.set(k, Object.freeze(record));
		},
	};
}

/**
 * Runtime thenable detection: functions are thenable-capable too
 * (`Object.assign(fn, { then() {} })`), so both non-null objects and
 * functions are inspected before checking for a callable `.then`.
 */
function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
	const canBeThenable =
		(typeof value === "object" && value !== null) ||
		typeof value === "function";
	return (
		canBeThenable &&
		"then" in value &&
		typeof (value as { then: unknown }).then === "function"
	);
}

/**
 * Copies the stores a section can write. Stored records are frozen at
 * write time, so copying the containers is a faithful snapshot: a write
 * inside the section replaces a map entry or appends a row, and a record
 * handed out by a repository method can never alias-mutate storage.
 */
function cloneState(state: InMemoryState): InMemoryState {
	return {
		wallets: new Map(state.wallets),
		operationRows: [...state.operationRows],
		ledgerRows: [...state.ledgerRows],
		identityBindings: new Map(state.identityBindings),
		idempotencyRecords: new Map(state.idempotencyRecords),
		users: new Map(state.users),
		registrationIntents: new Map(state.registrationIntents),
		nextId: state.nextId,
		nextRowid: state.nextRowid,
	};
}

function commitState(target: InMemoryState, staging: InMemoryState): void {
	target.wallets = staging.wallets;
	target.operationRows = staging.operationRows;
	target.ledgerRows = staging.ledgerRows;
	target.identityBindings = staging.identityBindings;
	target.idempotencyRecords = staging.idempotencyRecords;
	target.users = staging.users;
	target.registrationIntents = staging.registrationIntents;
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
 * Binds the `TransactionContext` itself to the section's lifetime — the
 * same semantics the production adapter enforces: every property trap
 * asserts the section is still open, so a context captured outside
 * `transact` is permanently unusable. Reading `nowMs` or a repository
 * slot throws exactly like calling a revoked repository method, whether
 * the section committed or rolled back, and a later section never revives
 * a stale context.
 */
function guardContext(
	ctx: TransactionContext,
	assertOpen: () => void,
): TransactionContext {
	return new Proxy(ctx, {
		get(target, property, receiver) {
			assertOpen();
			return Reflect.get(target, property, receiver);
		},
		set(target, property, value, receiver) {
			assertOpen();
			return Reflect.set(target, property, value, receiver);
		},
		has(target, property) {
			assertOpen();
			return Reflect.has(target, property);
		},
		deleteProperty(target, property) {
			assertOpen();
			return Reflect.deleteProperty(target, property);
		},
		defineProperty(target, property, descriptor) {
			assertOpen();
			return Reflect.defineProperty(target, property, descriptor);
		},
		getOwnPropertyDescriptor(target, property) {
			assertOpen();
			return Reflect.getOwnPropertyDescriptor(target, property);
		},
		ownKeys(target) {
			assertOpen();
			return Reflect.ownKeys(target);
		},
	});
}

/**
 * An in-memory `UnitOfWork` faithful to the atomic boundary it models:
 * entering a section samples the `Clock` exactly once and freezes the value
 * as `ctx.nowMs` (the temporal-authority specification); `work` runs against a staging copy of the
 * state that replaces the committed state only when `work` returns a
 * non-Promise result — a throw, including the runtime PromiseLike check,
 * discards the staging copy, so no observable state change survives an
 * aborted section. The `TransactionContext` itself and the repository
 * handles bound to it are revoked when the section closes — reading a
 * property of a closed context throws, exactly like the production
 * adapter — and sections do not nest: composing work shares the open
 * `TransactionContext`.
 */
export function createInMemoryUnitOfWork(
	state: InMemoryState,
	clock: Clock,
	options?: InMemoryUnitOfWorkOptions,
): UnitOfWork {
	let active = false;
	return {
		transact<R>(work: (ctx: TransactionContext) => Synchronous<R>): R {
			if (active) {
				throw new Error(
					"nested transact sections are not supported: share the open TransactionContext",
				);
			}
			active = true;
			// Each section gets its own lifetime predicate: a context or
			// repository handle from a previous section stays permanently
			// dead even while a later section is open — `active` only guards
			// against nesting, it never revives a stale handle.
			let sectionOpen = true;
			function assertOpen() {
				if (!sectionOpen) {
					throw new Error("transaction context is closed");
				}
			}
			try {
				const staging = cloneState(state);
				const scope: TransactionScope = {
					wallets: walletRepository(staging),
					operations: operationRepository(staging),
					ledger: ledgerRepository(staging),
					identityBindings: identityBindingRepository(staging),
					idempotencyRecords: idempotencyRepository(staging),
					users: userRepository(staging),
					registrationIntents: registrationIntentRepository(staging),
				};
				const wrapped = options?.wrapScope?.(scope) ?? scope;
				// Per the temporal-authority specification: exactly one clock sample per section, taken before any
				// caller code runs.
				const nowMs = clock.nowMs();
				const ctx = guardContext(
					{
						nowMs,
						wallets: guardRepository(wrapped.wallets, assertOpen),
						operations: guardRepository(wrapped.operations, assertOpen),
						ledger: guardRepository(wrapped.ledger, assertOpen),
						identityBindings: guardRepository(
							wrapped.identityBindings,
							assertOpen,
						),
						idempotencyRecords: guardRepository(
							wrapped.idempotencyRecords,
							assertOpen,
						),
						users: guardRepository(wrapped.users, assertOpen),
						registrationIntents: guardRepository(
							wrapped.registrationIntents,
							assertOpen,
						),
					},
					assertOpen,
				);
				const result = work(ctx);
				if (isPromiseLike(result)) {
					throw new Error(
						"atomic section must be synchronous: work returned a PromiseLike",
					);
				}
				commitState(state, staging);
				return result;
			} finally {
				sectionOpen = false;
				active = false;
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
		state.users.set(owner, Object.freeze({ id: owner, createdAt: 0 }));
		const wallet: Wallet = {
			id: walletId(`wallet-${++state.nextId}`),
			kind: "user",
			ownerUserId: owner,
			balance: 0,
			createdAt: 0,
			updatedAt: 0,
		};
		state.wallets.set(wallet.id, Object.freeze(wallet));
		return wallet;
	}
	return { app, state, clock, uow, seedUser };
}
