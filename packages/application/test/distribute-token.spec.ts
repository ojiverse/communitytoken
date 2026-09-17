import { describe, expect, it } from "vitest";
import { userId } from "../src/types";
import { TREASURY_ID } from "../src/use-cases/shared";
import { ADMIN, asAdmin, OTHER_SERVICE, SYSTEM, userActor } from "./fixtures";
import { createInMemoryFixture } from "./in-memory";

function walletOf(
	state: ReturnType<typeof createInMemoryFixture>["state"],
	rawUserId: string,
) {
	const owner = userId(rawUserId);
	for (const wallet of state.wallets.values()) {
		if (wallet.ownerUserId === owner) return wallet;
	}
	return undefined;
}

describe("distributeToken", () => {
	it("moves existing treasury reserve to a user", () => {
		const { app, state, seedUser } = createInMemoryFixture();
		seedUser("alice");
		app.issueToken(ADMIN, { amount: 200 });

		const r = app.distributeToken(ADMIN, {
			toUserId: userId("alice"),
			amount: 80,
		});

		expect(r).toEqual({
			ok: true,
			value: { operationId: expect.any(String) },
		});
		expect(state.wallets.get(TREASURY_ID)?.balance).toBe(120);
		expect(walletOf(state, "alice")?.balance).toBe(80);

		const op = state.operationRows.at(-1)?.record;
		expect(op?.kind).toBe("DISTRIBUTION");
		expect(op?.actorKind).toBe("service");
		expect(op?.actorId).toBe("admin-api");
		const entry = state.ledgerRows.at(-1)?.record;
		expect(entry?.fromWalletId).toBe(TREASURY_ID);
		expect(entry?.toWalletId).toBe(walletOf(state, "alice")?.id);
		expect(entry?.amount).toBe(80);
	});

	it("insufficient treasury rejects without implicit issuance — exhaustion is a valid state", () => {
		const { app, state, seedUser } = createInMemoryFixture();
		seedUser("alice");
		app.issueToken(ADMIN, { amount: 50 });
		const before = state.operationRows.length;
		const ledgerBefore = state.ledgerRows.length;

		const r = app.distributeToken(ADMIN, {
			toUserId: userId("alice"),
			amount: 51,
		});

		expect(r).toMatchObject({
			ok: false,
			error: { type: "rejected", code: "INSUFFICIENT_BALANCE" },
		});
		expect(state.wallets.get(TREASURY_ID)?.balance).toBe(50);
		expect(walletOf(state, "alice")?.balance).toBe(0);
		expect(state.operationRows).toHaveLength(before);
		expect(state.ledgerRows).toHaveLength(ledgerBefore);
	});

	it("rejects distribution to a user that owns no wallet", () => {
		const { app, state } = createInMemoryFixture();
		app.issueToken(ADMIN, { amount: 50 });
		const before = state.operationRows.length;

		const r = app.distributeToken(ADMIN, {
			toUserId: userId("ghost"),
			amount: 10,
		});

		expect(r).toMatchObject({
			ok: false,
			error: { type: "rejected", code: "WALLET_NOT_FOUND" },
		});
		expect(state.wallets.get(TREASURY_ID)?.balance).toBe(50);
		expect(state.operationRows).toHaveLength(before);
	});

	it.each([
		["a non-admin service principal", OTHER_SERVICE],
		["a user", userActor("alice")],
		["system", SYSTEM],
	] as const)("rejects %s as forbidden", (_label, actor) => {
		const { app, seedUser } = createInMemoryFixture();
		seedUser("alice");
		app.issueToken(ADMIN, { amount: 50 });

		const r = app.distributeToken(asAdmin(actor), {
			toUserId: userId("alice"),
			amount: 10,
		});

		expect(r).toMatchObject({ ok: false, error: { type: "forbidden" } });
	});
});
