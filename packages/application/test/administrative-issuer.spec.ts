import { describe, expect, it } from "vitest";
import { ensureAdministrativeIssuer } from "../src/use-cases/ensure-administrative-issuer";
import {
	createInMemoryState,
	createInMemoryUnitOfWork,
	fixedClock,
} from "./in-memory";

/**
 * The administrative technical authority maps to one stable internal
 * Principal (authentication/delegation specification). Initialization is
 * idempotent and creates no Account, binding, default designation, or
 * Transaction.
 */
describe("ensureAdministrativeIssuer", () => {
	it("creates the issuer Principal once and returns the same id thereafter", () => {
		const state = createInMemoryState();
		const uow = createInMemoryUnitOfWork(state, fixedClock(10));

		const first = uow.transact((ctx) => ensureAdministrativeIssuer(ctx));
		const second = uow.transact((ctx) => ensureAdministrativeIssuer(ctx));

		expect(second).toBe(first);
		expect(state.administrativeIssuer).toBe(first);
		expect(state.principals.size).toBe(1);
		expect(state.principals.get(first)).toEqual({ id: first, createdAt: 10 });
	});

	it("creates no Account, binding, designation, or Transaction", () => {
		const state = createInMemoryState();
		const uow = createInMemoryUnitOfWork(state, fixedClock(10));

		uow.transact((ctx) => ensureAdministrativeIssuer(ctx));

		expect(state.accounts.size).toBe(0);
		expect(state.identityBindings.size).toBe(0);
		expect(state.defaultAccounts.size).toBe(0);
		expect(state.transactionRows).toHaveLength(0);
	});

	it("rolls back the Principal when the mapping insert fails", () => {
		const state = createInMemoryState();
		const uow = createInMemoryUnitOfWork(state, fixedClock(10), {
			wrapScope: (scope) => ({
				...scope,
				administrativeIssuer: {
					...scope.administrativeIssuer,
					insert() {
						throw new Error("injected mapping failure");
					},
				},
			}),
		});

		expect(() =>
			uow.transact((ctx) => ensureAdministrativeIssuer(ctx)),
		).toThrow(/injected/);
		expect(state.principals.size).toBe(0);
		expect(state.administrativeIssuer).toBeNull();
	});
});
