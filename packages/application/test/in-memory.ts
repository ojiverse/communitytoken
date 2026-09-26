/**
 * In-memory implementations of the application ports. Test-only support:
 * they make the contract executable without a runtime while keeping the
 * same boundary discipline the production adapters must honor —
 * repositories exist only inside `transact`, ids are allocated by the
 * repository, promise-returning work is rejected, a section commits
 * all-or-nothing, and the structural constraints the production schema
 * enforces (Account owner exists, default designation owned by its
 * Principal, append-only history) are enforced here too.
 */

import type {
	AccountRepository,
	AdministrativeIssuerRepository,
	Clock,
	DefaultAccountRepository,
	IdempotencyRepository,
	IdentityBindingRepository,
	PrincipalRepository,
	RegistrationIntentRepository,
	Synchronous,
	TransactionContext,
	TransactionRepository,
	TransactionScope,
	UnitOfWork,
} from "../src/ports";
import {
	type Account,
	type AccountId,
	type ExternalIdentity,
	type IdempotencyRecord,
	type Page,
	type PrincipalId,
	type PrincipalRecord,
	type RegistrationIntent,
	type RegistrationIntentId,
	rehydrate,
	type TransactionRecord,
} from "../src/types";

type StoredTransaction = {
	readonly rowid: number;
	readonly record: TransactionRecord;
};

/**
 * The mutable state behind an in-memory `UnitOfWork`. `identityBindings`
 * keys an exact `(issuer, subject)` pair and `idempotencyRecords` keys a
 * `(technicalCaller, idempotencyKey)` pair — both encoded as
 * `JSON.stringify([a, b])` so no separator can collide with content.
 */
export type InMemoryState = {
	principals: Map<PrincipalId, PrincipalRecord>;
	accounts: Map<AccountId, Account>;
	defaultAccounts: Map<PrincipalId, AccountId>;
	transactionRows: StoredTransaction[];
	identityBindings: Map<string, PrincipalId>;
	administrativeIssuer: PrincipalId | null;
	idempotencyRecords: Map<string, IdempotencyRecord>;
	registrationIntents: Map<RegistrationIntentId, RegistrationIntent>;
	nextId: number;
	nextRowid: number;
};

/** An empty community: no Principals, Accounts, or Transactions. */
export function createInMemoryState(): InMemoryState {
	return {
		principals: new Map(),
		accounts: new Map(),
		defaultAccounts: new Map(),
		transactionRows: [],
		identityBindings: new Map(),
		administrativeIssuer: null,
		idempotencyRecords: new Map(),
		registrationIntents: new Map(),
		nextId: 0,
		nextRowid: 0,
	};
}

function bindingKey(issuer: string, subject: string): string {
	return JSON.stringify([issuer, subject]);
}

function principalRepository(state: InMemoryState): PrincipalRepository {
	return {
		findById(id) {
			return state.principals.get(id);
		},
		insert(record) {
			const principal: PrincipalRecord = Object.freeze({
				id: rehydrate.principalId(`principal-${++state.nextId}`),
				createdAt: record.createdAt,
			});
			state.principals.set(principal.id, principal);
			return principal;
		},
	};
}

function accountRepository(state: InMemoryState): AccountRepository {
	return {
		findById(id) {
			return state.accounts.get(id);
		},
		insert(record) {
			if (!state.principals.has(record.ownerPrincipalId)) {
				throw new Error(
					`account owner principal not found: ${record.ownerPrincipalId}`,
				);
			}
			const account: Account = Object.freeze({
				id: rehydrate.accountId(`account-${++state.nextId}`),
				ownerPrincipalId: record.ownerPrincipalId,
				balance: 0,
				createdAt: record.createdAt,
				updatedAt: record.createdAt,
			});
			state.accounts.set(account.id, account);
			return account;
		},
		setBalance(id, balance, updatedAt) {
			const account = state.accounts.get(id);
			if (account === undefined) {
				throw new Error(`setBalance on missing account: ${id}`);
			}
			if (
				!Number.isSafeInteger(balance) ||
				balance < 0 ||
				balance > Number.MAX_SAFE_INTEGER
			) {
				throw new Error(`balance outside the monetary domain: ${balance}`);
			}
			state.accounts.set(id, Object.freeze({ ...account, balance, updatedAt }));
		},
		totalSupply() {
			let total = 0;
			for (const account of state.accounts.values()) total += account.balance;
			return total;
		},
	};
}

function defaultAccountRepository(
	state: InMemoryState,
): DefaultAccountRepository {
	return {
		findAccountId(principalId) {
			return state.defaultAccounts.get(principalId);
		},
		designate({ principalId, accountId }) {
			if (state.defaultAccounts.has(principalId)) {
				throw new Error(`principal already has a default: ${principalId}`);
			}
			const account = state.accounts.get(accountId);
			if (account === undefined || account.ownerPrincipalId !== principalId) {
				throw new Error(
					`account ${accountId} is not owned by principal ${principalId}`,
				);
			}
			for (const designated of state.defaultAccounts.values()) {
				if (designated === accountId) {
					throw new Error(`account already designated: ${accountId}`);
				}
			}
			state.defaultAccounts.set(principalId, accountId);
		},
	};
}

function transactionRepository(state: InMemoryState): TransactionRepository {
	return {
		insert(record) {
			if (!state.accounts.has(record.destinationAccountId)) {
				throw new Error(
					`destination account not found: ${record.destinationAccountId}`,
				);
			}
			if (
				!Number.isSafeInteger(record.amount) ||
				record.amount < 1 ||
				record.amount > Number.MAX_SAFE_INTEGER
			) {
				throw new Error(`amount outside the monetary domain: ${record.amount}`);
			}
			const id = rehydrate.transactionId(`tx-${++state.nextId}`);
			let stored: TransactionRecord;
			if (record.kind === "ISSUE") {
				if (!state.principals.has(record.issuerPrincipalId)) {
					throw new Error(
						`issuer principal not found: ${record.issuerPrincipalId}`,
					);
				}
				stored = Object.freeze({
					id,
					kind: "ISSUE",
					issuerPrincipalId: record.issuerPrincipalId,
					sourceAccountId: null,
					destinationAccountId: record.destinationAccountId,
					amount: record.amount,
					committedAt: record.committedAt,
				});
			} else {
				if (!state.accounts.has(record.sourceAccountId)) {
					throw new Error(
						`source account not found: ${record.sourceAccountId}`,
					);
				}
				stored = Object.freeze({
					id,
					kind: "TRANSFER",
					issuerPrincipalId: null,
					sourceAccountId: record.sourceAccountId,
					destinationAccountId: record.destinationAccountId,
					amount: record.amount,
					committedAt: record.committedAt,
				});
			}
			state.transactionRows.push({ rowid: ++state.nextRowid, record: stored });
			return stored;
		},
		listForAccount(accountId, cursor, limit) {
			const matching = state.transactionRows
				.filter(
					({ record }) =>
						record.sourceAccountId === accountId ||
						record.destinationAccountId === accountId,
				)
				.sort((a, b) => b.rowid - a.rowid);
			const remaining =
				cursor === null
					? matching
					: matching.filter((row) => row.rowid < Number(cursor));
			const pageRows = remaining.slice(0, limit);
			const page: Page<TransactionRecord> = {
				entries: pageRows.map((row) => row.record),
				nextCursor:
					remaining.length > pageRows.length
						? String(pageRows.at(-1)?.rowid)
						: null,
			};
			return page;
		},
	};
}

function identityBindingRepository(
	state: InMemoryState,
): IdentityBindingRepository {
	return {
		findPrincipalIdByExternal(issuer, subject) {
			return state.identityBindings.get(bindingKey(issuer, subject));
		},
		listSubjects(principalId, issuer) {
			const subjects: string[] = [];
			for (const [key, bound] of state.identityBindings) {
				const [boundIssuer, subject] = JSON.parse(key) as [string, string];
				if (bound === principalId && boundIssuer === issuer) {
					subjects.push(subject);
				}
			}
			return subjects;
		},
		insert(binding) {
			const key = bindingKey(binding.issuer, binding.subject);
			if (state.identityBindings.has(key)) {
				throw new Error(
					`identity already bound: ${binding.issuer}:${binding.subject}`,
				);
			}
			if (!state.principals.has(binding.principalId)) {
				throw new Error(`binding principal not found: ${binding.principalId}`);
			}
			state.identityBindings.set(key, binding.principalId);
		},
	};
}

function administrativeIssuerRepository(
	state: InMemoryState,
): AdministrativeIssuerRepository {
	return {
		find() {
			return state.administrativeIssuer ?? undefined;
		},
		insert(principalId) {
			if (state.administrativeIssuer !== null) {
				throw new Error("administrative issuer already set");
			}
			if (!state.principals.has(principalId)) {
				throw new Error(`issuer principal not found: ${principalId}`);
			}
			state.administrativeIssuer = principalId;
		},
	};
}

/**
 * In-memory RegistrationIntent storage with the same lifecycle floor the
 * production triggers enforce.
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
				id: rehydrate.registrationIntentId(`intent-${++state.nextId}`),
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
	return {
		find(technicalCaller, idempotencyKey) {
			return state.idempotencyRecords.get(
				bindingKey(technicalCaller, idempotencyKey),
			);
		},
		insert(record) {
			const k = bindingKey(record.technicalCaller, record.idempotencyKey);
			if (state.idempotencyRecords.has(k)) {
				throw new Error(
					`duplicate idempotency record: ${record.technicalCaller}/${record.idempotencyKey}`,
				);
			}
			state.idempotencyRecords.set(k, Object.freeze({ ...record }));
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
 * write time, so copying the containers is a faithful snapshot.
 */
function cloneState(state: InMemoryState): InMemoryState {
	return {
		principals: new Map(state.principals),
		accounts: new Map(state.accounts),
		defaultAccounts: new Map(state.defaultAccounts),
		transactionRows: [...state.transactionRows],
		identityBindings: new Map(state.identityBindings),
		administrativeIssuer: state.administrativeIssuer,
		idempotencyRecords: new Map(state.idempotencyRecords),
		registrationIntents: new Map(state.registrationIntents),
		nextId: state.nextId,
		nextRowid: state.nextRowid,
	};
}

function commitState(target: InMemoryState, staging: InMemoryState): void {
	Object.assign(target, staging);
}

export type InMemoryUnitOfWorkOptions = {
	/**
	 * Fault-injection seam: transforms the section's repository scope before
	 * `work` runs — for example wrapping `transactions.insert` to throw
	 * mid-section. Applied to every section this `UnitOfWork` opens.
	 */
	readonly wrapScope?:
		| ((scope: TransactionScope) => TransactionScope)
		| undefined;
};

/**
 * Binds a repository to the section's open/closed lifetime: every method
 * asserts the section is still open before delegating.
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
 * same semantics the production adapter enforces.
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
 * entering a section samples the `Clock` exactly once; `work` runs against
 * a staging copy that replaces the committed state only when `work` returns
 * a non-Promise result; the context and its repositories are revoked when
 * the section closes; sections do not nest.
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
			let sectionOpen = true;
			function assertOpen() {
				if (!sectionOpen) {
					throw new Error("transaction context is closed");
				}
			}
			try {
				const staging = cloneState(state);
				const scope: TransactionScope = {
					principals: principalRepository(staging),
					accounts: accountRepository(staging),
					defaultAccounts: defaultAccountRepository(staging),
					transactions: transactionRepository(staging),
					identityBindings: identityBindingRepository(staging),
					administrativeIssuer: administrativeIssuerRepository(staging),
					idempotencyRecords: idempotencyRepository(staging),
					registrationIntents: registrationIntentRepository(staging),
				};
				const wrapped = options?.wrapScope?.(scope) ?? scope;
				const nowMs = clock.nowMs();
				const ctx = guardContext(
					{
						nowMs,
						principals: guardRepository(wrapped.principals, assertOpen),
						accounts: guardRepository(wrapped.accounts, assertOpen),
						defaultAccounts: guardRepository(
							wrapped.defaultAccounts,
							assertOpen,
						),
						transactions: guardRepository(wrapped.transactions, assertOpen),
						identityBindings: guardRepository(
							wrapped.identityBindings,
							assertOpen,
						),
						administrativeIssuer: guardRepository(
							wrapped.administrativeIssuer,
							assertOpen,
						),
						idempotencyRecords: guardRepository(
							wrapped.idempotencyRecords,
							assertOpen,
						),
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

/** A registered identity seeded directly into state. */
export type SeededIdentity = {
	readonly identity: ExternalIdentity;
	readonly principalId: PrincipalId;
	readonly accountId: AccountId;
};

/** The default test issuer of seeded identities. */
export const TEST_ISSUER = "https://issuer.test";

/**
 * A ready-to-use in-memory environment plus the fixture handles tests need.
 * The administrative issuer Principal is pre-seeded (initialization is
 * covered separately), and `seedIdentity` writes the state registration
 * produces — Principal, zero-balance Account, default designation, and
 * binding — directly, without sampling the clock.
 */
export function createInMemoryFixture(options?: {
	readonly clock?: Clock;
	readonly wrapScope?: (scope: TransactionScope) => TransactionScope;
}): {
	readonly state: InMemoryState;
	readonly clock: Clock;
	readonly uow: UnitOfWork;
	readonly adminIssuer: PrincipalId;
	seedPrincipal(): PrincipalId;
	seedAccount(owner: PrincipalId, balance?: number): AccountId;
	seedIdentity(subject: string, issuer?: string): SeededIdentity;
	bind(principal: PrincipalId, subject: string, issuer?: string): void;
	balanceOf(account: AccountId): number | undefined;
} {
	const state = createInMemoryState();
	const clock = options?.clock ?? stepClock();
	const uow = createInMemoryUnitOfWork(state, clock, {
		wrapScope: options?.wrapScope,
	});
	function seedPrincipal(): PrincipalId {
		const id = rehydrate.principalId(`principal-${++state.nextId}`);
		state.principals.set(id, Object.freeze({ id, createdAt: 0 }));
		return id;
	}
	function seedAccount(owner: PrincipalId, balance = 0): AccountId {
		const id = rehydrate.accountId(`account-${++state.nextId}`);
		state.accounts.set(
			id,
			Object.freeze({
				id,
				ownerPrincipalId: owner,
				balance,
				createdAt: 0,
				updatedAt: 0,
			}),
		);
		return id;
	}
	function bind(
		principal: PrincipalId,
		subject: string,
		issuer = TEST_ISSUER,
	): void {
		const key = bindingKey(issuer, subject);
		if (state.identityBindings.has(key)) {
			throw new Error(`identity already seeded: ${issuer}:${subject}`);
		}
		state.identityBindings.set(key, principal);
	}
	function seedIdentity(subject: string, issuer = TEST_ISSUER): SeededIdentity {
		const principalId = seedPrincipal();
		const accountId = seedAccount(principalId);
		state.defaultAccounts.set(principalId, accountId);
		bind(principalId, subject, issuer);
		return { identity: { issuer, subject }, principalId, accountId };
	}
	const adminIssuer = seedPrincipal();
	state.administrativeIssuer = adminIssuer;
	return {
		state,
		clock,
		uow,
		adminIssuer,
		seedPrincipal,
		seedAccount,
		seedIdentity,
		bind,
		balanceOf(account) {
			return state.accounts.get(account)?.balance;
		},
	};
}
