import { describe, expect, it } from "vitest";
import {
	createRegistrationIntent,
	REGISTRATION_INTENT_TTL_MS,
} from "../src/use-cases/create-registration-intent";
import { createInMemoryFixture, fixedClock, stepClock } from "./in-memory";

/**
 * `createRegistrationIntent` coverage (issue #4 PR-4, the registration
 * specification): a new intent supersedes every status-active predecessor
 * of the same external identity — including an already-expired one — while
 * an already-bound identity commits no mutation at all.
 */

const ISSUER = "https://issuer.test";
const SUBJECT = "subject-1";

let intentCounter = 0;

function intentInput(subject: string = SUBJECT) {
	const n = intentCounter++;
	return {
		expectedIssuer: ISSUER,
		expectedSubject: subject,
		state: `state-${n}`,
		nonce: `nonce-${n}`,
		proofKeySecret: `proof-${n}`,
	};
}

/** Seeds a registered identity directly at the repository boundary. */
function seedBinding(
	fx: ReturnType<typeof createInMemoryFixture>,
	issuer: string,
	subject: string,
): void {
	fx.seedIdentity(subject, issuer);
}

describe("createRegistrationIntent", () => {
	it("creates an active 600-second intent stamped with the frozen now_ms", () => {
		const fx = createInMemoryFixture({ clock: fixedClock(1_000_000) });
		const input = intentInput();

		const outcome = fx.uow.transact((ctx) =>
			createRegistrationIntent(ctx, input),
		);

		expect(outcome).toEqual({
			type: "created",
			expiresAt: 1_000_000 + REGISTRATION_INTENT_TTL_MS,
		});
		expect(REGISTRATION_INTENT_TTL_MS).toBe(600_000);
		const intents = [...fx.state.registrationIntents.values()];
		expect(intents).toHaveLength(1);
		expect(intents[0]).toMatchObject({
			expectedIssuer: ISSUER,
			expectedSubject: SUBJECT,
			state: input.state,
			nonce: input.nonce,
			proofKeySecret: input.proofKeySecret,
			status: "active",
			createdAt: 1_000_000,
			expiresAt: 1_600_000,
			consumedAt: null,
		});
	});

	it("returns alreadyRegistered and mutates nothing when the identity is bound", () => {
		const fx = createInMemoryFixture({ clock: fixedClock(5_000) });
		seedBinding(fx, ISSUER, SUBJECT);

		const outcome = fx.uow.transact((ctx) =>
			createRegistrationIntent(ctx, intentInput()),
		);

		expect(outcome).toEqual({ type: "alreadyRegistered" });
		expect(fx.state.registrationIntents.size).toBe(0);
		expect(fx.state.principals.size).toBe(2);
	});

	it("does not consume the idempotency-scoped section for alreadyRegistered", () => {
		const fx = createInMemoryFixture();
		seedBinding(fx, ISSUER, SUBJECT);
		// An active intent that somehow coexists with the binding must not
		// be superseded: the bound check runs before any mutation.
		fx.uow.transact((ctx) => {
			ctx.registrationIntents.insert({
				expectedIssuer: ISSUER,
				expectedSubject: "other-subject",
				state: "other-state",
				nonce: "n",
				proofKeySecret: "p",
				createdAt: ctx.nowMs,
				expiresAt: ctx.nowMs + 600_000,
			});
		});

		fx.uow.transact((ctx) => createRegistrationIntent(ctx, intentInput()));

		const intents = [...fx.state.registrationIntents.values()];
		expect(intents).toHaveLength(1);
		expect(intents[0]?.status).toBe("active");
	});

	it("supersedes every status-active predecessor of the pair, including expired ones", () => {
		const fx = createInMemoryFixture({ clock: fixedClock(1_000) });
		fx.uow.transact((ctx) => createRegistrationIntent(ctx, intentInput()));
		// A second intent supersedes the first; a third supersedes the second.
		const second = fx.uow.transact((ctx) =>
			createRegistrationIntent(ctx, intentInput()),
		);
		expect(second.type).toBe("created");
		const third = fx.uow.transact((ctx) =>
			createRegistrationIntent(ctx, intentInput()),
		);
		expect(third.type).toBe("created");

		const intents = [...fx.state.registrationIntents.values()];
		expect(intents).toHaveLength(3);
		expect(intents.map((i) => i.status)).toEqual([
			"superseded",
			"superseded",
			"active",
		]);
	});

	it("supersedes an expired-but-active predecessor", () => {
		// The second section samples nowMs = 601_000 == first expiresAt:
		// expired, but still status-active, so supersede must cover it —
		// the partial unique index must never block the replacement.
		const fx = createInMemoryFixture({ clock: stepClock(1_000, 600_000) });
		fx.uow.transact((ctx) => createRegistrationIntent(ctx, intentInput()));
		const late = fx.uow.transact((ctx) =>
			createRegistrationIntent(ctx, intentInput()),
		);
		expect(late.type).toBe("created");
		const intents = [...fx.state.registrationIntents.values()];
		expect(intents.map((i) => i.status)).toEqual(["superseded", "active"]);
	});

	it("does not touch other identities' intents", () => {
		const fx = createInMemoryFixture();
		fx.uow.transact((ctx) =>
			createRegistrationIntent(ctx, intentInput("other-subject")),
		);
		fx.uow.transact((ctx) => createRegistrationIntent(ctx, intentInput()));

		const intents = [...fx.state.registrationIntents.values()];
		expect(intents).toHaveLength(2);
		expect(intents.every((i) => i.status === "active")).toBe(true);
	});
});
