import { describe, expect, it } from "vitest";
import type { RegistrationIntentId } from "../src/types";
import { completeRegistration } from "../src/use-cases/complete-registration";
import { createInMemoryFixture, fixedClock, stepClock } from "./in-memory";

/**
 * `completeRegistration` coverage (registration specification): the
 * completion section re-checks intent validity and exact identity equality
 * at the same serialized boundary that creates or resolves the binding; a
 * first registration atomically creates Principal + zero-balance Account +
 * default designation + IdentityBinding + consumed intent; a proof
 * mismatch consumes nothing; and an already-bound identity resolves the
 * existing Principal without duplicating anything.
 */

const ISSUER = "https://issuer.test";
const SUBJECT = "subject-1";
const STATE = "a".repeat(43);

type Fixture = ReturnType<typeof createInMemoryFixture>;

/** Inserts an active intent for `SUBJECT` at `ISSUER` in its own section. */
function seedIntent(
	fx: Fixture,
	overrides?: { subject?: string; issuer?: string; state?: string },
): RegistrationIntentId {
	return fx.uow.transact(
		(ctx) =>
			ctx.registrationIntents.insert({
				expectedIssuer: overrides?.issuer ?? ISSUER,
				expectedSubject: overrides?.subject ?? SUBJECT,
				state: overrides?.state ?? STATE,
				nonce: "nonce-1",
				proofKeySecret: "proof-1",
				createdAt: ctx.nowMs,
				expiresAt: ctx.nowMs + 600_000,
			}).id,
	);
}

function intentOf(fx: Fixture, id: RegistrationIntentId) {
	return fx.state.registrationIntents.get(id);
}

function complete(fx: Fixture, verified?: { issuer: string; subject: string }) {
	return fx.uow.transact((ctx) =>
		completeRegistration(ctx, {
			state: STATE,
			verifiedIssuer: verified?.issuer ?? ISSUER,
			verifiedSubject: verified?.subject ?? SUBJECT,
		}),
	);
}

/**
 * Principals other than the pre-seeded administrative issuer — i.e. the
 * ones registration created.
 */
function registeredPrincipals(fx: Fixture): number {
	return fx.state.principals.size - 1;
}

describe("completeRegistration", () => {
	it("completes a fresh registration: Principal + zero Account + default designation + binding + consumed intent", () => {
		const fx = createInMemoryFixture({ clock: fixedClock(1_000) });
		const id = seedIntent(fx);

		const outcome = complete(fx);

		expect(outcome.type).toBe("completed");
		if (outcome.type !== "completed") return;
		expect(outcome.created).toBe(true);
		expect(registeredPrincipals(fx)).toBe(1);
		expect(fx.state.principals.get(outcome.principalId)).toBeDefined();
		const accounts = [...fx.state.accounts.values()];
		expect(accounts).toHaveLength(1);
		expect(accounts[0]).toMatchObject({
			ownerPrincipalId: outcome.principalId,
			balance: 0,
		});
		expect(fx.state.defaultAccounts.get(outcome.principalId)).toBe(
			accounts[0]?.id,
		);
		expect(fx.state.defaultAccounts.size).toBe(1);
		expect(
			fx.state.identityBindings.get(JSON.stringify([ISSUER, SUBJECT])),
		).toBe(outcome.principalId);
		expect(intentOf(fx, id)).toMatchObject({
			status: "consumed",
			consumedAt: 1_000,
		});
		// Registration creates no monetary value and no Transaction.
		expect(fx.state.transactionRows).toHaveLength(0);
	});

	it("resolves the existing Principal without duplicating Principal/Account/designation/binding when already bound", () => {
		const fx = createInMemoryFixture({ clock: fixedClock(1_000) });
		const id = seedIntent(fx);
		// The identity becomes bound between intent creation and completion.
		const existing = fx.seedIdentity(SUBJECT, ISSUER);
		const counts = {
			principals: fx.state.principals.size,
			accounts: fx.state.accounts.size,
			designations: fx.state.defaultAccounts.size,
			bindings: fx.state.identityBindings.size,
		};

		const outcome = complete(fx);

		expect(outcome).toEqual({
			type: "completed",
			principalId: existing.principalId,
			created: false,
		});
		expect(intentOf(fx, id)?.status).toBe("consumed");
		expect({
			principals: fx.state.principals.size,
			accounts: fx.state.accounts.size,
			designations: fx.state.defaultAccounts.size,
			bindings: fx.state.identityBindings.size,
		}).toEqual(counts);
	});

	it("creates the default designation exactly once across repeated registrations of one identity", () => {
		const fx = createInMemoryFixture();
		seedIntent(fx, { state: "state-first" });
		fx.uow.transact((ctx) =>
			completeRegistration(ctx, {
				state: "state-first",
				verifiedIssuer: ISSUER,
				verifiedSubject: SUBJECT,
			}),
		);
		seedIntent(fx, { state: "state-second" });
		const second = fx.uow.transact((ctx) =>
			completeRegistration(ctx, {
				state: "state-second",
				verifiedIssuer: ISSUER,
				verifiedSubject: SUBJECT,
			}),
		);

		expect(second).toMatchObject({ type: "completed", created: false });
		expect(registeredPrincipals(fx)).toBe(1);
		expect(fx.state.accounts.size).toBe(1);
		expect(fx.state.defaultAccounts.size).toBe(1);
	});

	it("rejects unknown state", () => {
		const fx = createInMemoryFixture();
		expect(complete(fx)).toEqual({
			type: "unavailable",
			reason: "not-found",
		});
	});

	it("rejects a consumed intent", () => {
		const fx = createInMemoryFixture();
		const id = seedIntent(fx);
		fx.uow.transact((ctx) =>
			ctx.registrationIntents.markConsumed(id, ctx.nowMs),
		);

		expect(complete(fx)).toEqual({
			type: "unavailable",
			reason: "consumed",
		});
		expect(registeredPrincipals(fx)).toBe(0);
	});

	it("rejects a superseded intent", () => {
		const fx = createInMemoryFixture();
		const id = seedIntent(fx);
		fx.uow.transact((ctx) =>
			ctx.registrationIntents.supersedeActive(ISSUER, SUBJECT),
		);

		expect(complete(fx)).toEqual({
			type: "unavailable",
			reason: "superseded",
		});
		expect(intentOf(fx, id)?.status).toBe("superseded");
		expect(registeredPrincipals(fx)).toBe(0);
	});

	it("rejects an expired intent at exactly expiresAt", () => {
		// First section at nowMs=1_000; completion section samples 601_000,
		// exactly the intent's expiresAt — `nowMs >= expiresAt` rejects.
		const fx = createInMemoryFixture({ clock: stepClock(1_000, 600_000) });
		seedIntent(fx);

		expect(complete(fx)).toEqual({
			type: "unavailable",
			reason: "expired",
		});
		expect(registeredPrincipals(fx)).toBe(0);
	});

	it("rejects a mismatched verified pair without consuming the intent", () => {
		const fx = createInMemoryFixture();
		const id = seedIntent(fx);

		for (const verified of [
			{ issuer: ISSUER, subject: "other-subject" },
			{ issuer: "https://other-issuer.test", subject: SUBJECT },
		]) {
			expect(complete(fx, verified)).toEqual({
				type: "unavailable",
				reason: "mismatch",
			});
			expect(intentOf(fx, id)?.status).toBe("active");
		}
		expect(registeredPrincipals(fx)).toBe(0);
	});

	it("commits nothing when a mid-section write fails", () => {
		const fx = createInMemoryFixture({
			clock: fixedClock(1_000),
			wrapScope: (scope) => ({
				...scope,
				defaultAccounts: {
					...scope.defaultAccounts,
					designate() {
						throw new Error("injected designation failure");
					},
				},
			}),
		});
		const id = seedIntent(fx);

		expect(() => complete(fx)).toThrow("injected designation failure");
		expect(registeredPrincipals(fx)).toBe(0);
		expect(fx.state.accounts.size).toBe(0);
		expect(fx.state.defaultAccounts.size).toBe(0);
		expect(fx.state.identityBindings.size).toBe(0);
		expect(intentOf(fx, id)?.status).toBe("active");
	});
});
