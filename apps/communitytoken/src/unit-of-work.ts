/**
 * The production `UnitOfWork`: maps the application layer's serialized
 * atomic boundary onto the Durable Object's synchronous storage
 * transaction (`ctx.storage.transactionSync`).
 *
 * Contract honored per section (the transaction-consistency and
 * temporal-authority specifications):
 *
 *   - the injected `Clock` is sampled exactly once, after transaction
 *     entry and before `work` runs — every timestamped write in the
 *     section shares that frozen `nowMs`;
 *   - sections never nest or re-enter — composing work shares the open
 *     `TransactionContext`;
 *   - the `TransactionContext` itself and the repository handles bound to
 *     it are capabilities of the open section: both are permanently revoked
 *     when it closes — a stale context property read or handle call throws
 *     forever, and never becomes usable again while a later section is
 *     open;
 *   - `work` must be synchronous: a PromiseLike result (object- or
 *     function-valued) is rejected at runtime and rolls the section back;
 *   - a throw inside the section discards every write it made.
 *
 * The lifetime/thenable helpers live here rather than in
 * `@communitytoken/application`: with only two `UnitOfWork`
 * implementations, widening the package API for shared helpers is not
 * justified (issue #4 PR-2).
 */

import type {
	Clock,
	Synchronous,
	TransactionContext,
	TransactionScope,
	UnitOfWork,
} from "@communitytoken/application";
import {
	createIdempotencyRepository,
	createIdentityBindingRepository,
	createLedgerRepository,
	createOperationRepository,
	createWalletRepository,
} from "./repositories";

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
 * Binds the `TransactionContext` itself to the section's lifetime: every
 * property trap asserts the section is still open, so a context captured
 * outside `transact` is permanently unusable — reading `nowMs` or a
 * repository slot throws exactly like calling a revoked repository
 * method, whether the section committed or rolled back.
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
 * Binds `storage`'s synchronous transaction to the `UnitOfWork` contract.
 * `transactionSync` runs the section body exactly once and commits only
 * when the callback returns — a throw (including the runtime PromiseLike
 * rejection) discards every write made inside it.
 */
export function createStorageUnitOfWork(
	storage: DurableObjectStorage,
	clock: Clock,
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
			// repository handle from a previous section stays permanently dead
			// even while a later section is open — `active` only guards
			// against nesting, it never revives a stale handle.
			let sectionOpen = true;
			function assertOpen() {
				if (!sectionOpen) {
					throw new Error("transaction context is closed");
				}
			}
			try {
				return storage.transactionSync(() => {
					const scope: TransactionScope = {
						wallets: createWalletRepository(storage.sql),
						operations: createOperationRepository(storage.sql),
						ledger: createLedgerRepository(storage.sql),
						identityBindings: createIdentityBindingRepository(storage.sql),
						idempotencyRecords: createIdempotencyRepository(storage.sql),
					};
					// The section's single authoritative clock sample, taken after
					// transaction entry and before any caller code runs.
					const nowMs = clock.nowMs();
					const ctx = guardContext(
						{
							nowMs,
							wallets: guardRepository(scope.wallets, assertOpen),
							operations: guardRepository(scope.operations, assertOpen),
							ledger: guardRepository(scope.ledger, assertOpen),
							identityBindings: guardRepository(
								scope.identityBindings,
								assertOpen,
							),
							idempotencyRecords: guardRepository(
								scope.idempotencyRecords,
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
					return result;
				});
			} finally {
				sectionOpen = false;
				active = false;
			}
		},
	};
}
