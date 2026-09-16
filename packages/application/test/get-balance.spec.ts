import { describe, expect, it } from "vitest";
import { TREASURY_SELECTOR, userSelector } from "../src/types";
import { ADMIN, SYSTEM, userActor } from "./fixtures";
import { createInMemoryFixture } from "./in-memory";

describe("getBalance", () => {
	it("a user reads their own balance", () => {
		const { app, seedUser } = createInMemoryFixture();
		seedUser("alice");
		app.issueToken(ADMIN, { amount: 100 });
		app.distributeToken(ADMIN, { toUserId: "alice", amount: 40 });

		const r = app.getBalance(userActor("alice"), userSelector("alice"));

		expect(r).toEqual({ ok: true, value: { balance: 40 } });
	});

	it("a user cannot read another user's balance", () => {
		const { app, seedUser } = createInMemoryFixture();
		seedUser("alice");
		seedUser("bob");

		const r = app.getBalance(userActor("alice"), userSelector("bob"));

		expect(r).toMatchObject({ ok: false, error: { type: "forbidden" } });
	});

	it.each([
		["service", ADMIN],
		["system", SYSTEM],
	] as const)("a %s actor cannot read a user wallet", (_label, actor) => {
		const { app, seedUser } = createInMemoryFixture();
		seedUser("alice");

		const r = app.getBalance(actor, userSelector("alice"));

		expect(r).toMatchObject({ ok: false, error: { type: "forbidden" } });
	});

	it("a service actor reads the treasury balance", () => {
		const { app } = createInMemoryFixture();
		app.issueToken(ADMIN, { amount: 250 });

		const r = app.getBalance(ADMIN, TREASURY_SELECTOR);

		expect(r).toEqual({ ok: true, value: { balance: 250 } });
	});

	it.each([
		["user", () => userActor("alice")],
		["system", () => SYSTEM],
	] as const)(
		"a %s actor cannot read the treasury balance",
		(_label, actor) => {
			const { app } = createInMemoryFixture();
			app.issueToken(ADMIN, { amount: 250 });

			const r = app.getBalance(actor(), TREASURY_SELECTOR);

			expect(r).toMatchObject({ ok: false, error: { type: "forbidden" } });
		},
	);

	it("reports WALLET_NOT_FOUND for a user that owns no wallet", () => {
		const { app } = createInMemoryFixture();

		const r = app.getBalance(userActor("ghost"), userSelector("ghost"));

		expect(r).toMatchObject({
			ok: false,
			error: { type: "rejected", code: "WALLET_NOT_FOUND" },
		});
	});
});
