import { describe, expect, it } from "vitest";
import type { RegistrationIntentId } from "../src/types";
import { completeRegistration } from "../src/use-cases/complete-registration";
import { createInMemoryFixture, fixedClock, stepClock } from "./in-memory";

/**
 * `completeRegistration` coverage (issue #4 PR-4, the registration
 * specification): the completion section re-checks intent validity and
 * exact identity equality at the same serialized boundary that creates or
 * resolves the identity binding; a proof mismatch consumes nothing; and a
 * valid completion against an already-bound identity resolves the existing
 * User while still consuming the intent.
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

describe("completeRegistration", () => {
	it("completes a fresh registration: User + zero wallet + binding + consumed intent", () => {
		const fx = createInMemoryFixture({ clock: fixedClock(1_000) });
		const id = seedIntent(fx);

		const outcome = complete(fx);

		expect(outcome.type).toBe("completed");
		if (outcome.type !== "completed") return;
		expect(outcome.created).toBe(true);
		// One stable User with one zero-balance user wallet and one binding.
		expect(fx.state.users.size).toBe(1);
		const user = fx.state.users.get(outcome.userId);
		expect(user).toBeDefined();
		const wallet = [...fx.state.wallets.values()].find(
			(w) => w.kind === "user",
		);
		expect(wallet).toMatchObject({
			kind: "user",
			ownerUserId: outcome.userId,
			balance: 0,
		});
		expect(
			fx.state.identityBindings.get(JSON.stringify([ISSUER, SUBJECT])),
		).toBe(outcome.userId);
		expect(intentOf(fx, id)).toMatchObject({
			status: "consumed",
			consumedAt: 1_000,
		});
		// Registration creates no economic movement.
		expect(fx.state.operationRows).toHaveLength(0);
		expect(fx.state.ledgerRows).toHaveLength(0);
	});

	it("resolves the existing User without duplicating wallet/binding when already bound", () => {
		const fx = createInMemoryFixture({ clock: fixedClock(1_000) });
		const id = seedIntent(fx);
		// The identity becomes bound between intent creation and completion.
		const existingUserId = fx.uow.transact((ctx) => {
			const user = ctx.users.insert({ createdAt: ctx.nowMs });
			ctx.identityBindings.insert({
				issuer: ISSUER,
				subject: SUBJECT,
				userId: user.id,
				createdAt: ctx.nowMs,
			});
			ctx.wallets.insertUserWallet({
				ownerUserId: user.id,
				createdAt: ctx.nowMs,
			});
			return user.id;
		});

		const outcome = complete(fx);

		expect(outcome).toEqual({
			type: "completed",
			userId: existingUserId,
			created: false,
		});
		expect(intentOf(fx, id)?.status).toBe("consumed");
		// No additional binding or wallet was created.
		expect(fx.state.identityBindings.size).toBe(1);
		expect(
			[...fx.state.wallets.values()].filter((w) => w.kind === "user"),
		).toHaveLength(1);
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
		expect(fx.state.users.size).toBe(0);
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
		expect(fx.state.users.size).toBe(0);
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
		expect(fx.state.users.size).toBe(0);
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
		expect(fx.state.users.size).toBe(0);
	});

	it("commits nothing when a mid-section write fails", () => {
		const fx = createInMemoryFixture({
			clock: fixedClock(1_000),
			wrapScope: (scope) => ({
				...scope,
				wallets: {
					...scope.wallets,
					insertUserWallet() {
						throw new Error("injected wallet failure");
					},
				},
			}),
		});
		const id = seedIntent(fx);

		expect(() => complete(fx)).toThrow("injected wallet failure");
		expect(fx.state.users.size).toBe(0);
		expect(fx.state.identityBindings.size).toBe(0);
		expect(
			[...fx.state.wallets.values()].filter((w) => w.kind === "user"),
		).toHaveLength(0);
		expect(intentOf(fx, id)?.status).toBe("active");
	});
});
