import { TREASURY_WALLET_ID } from "@communitytoken/economic-kernel";
import { describe, expect, it } from "vitest";
import { ADMIN, SYSTEM, userActor } from "./fixtures";
import { createInMemoryFixture } from "./in-memory";

function walletOf(
	state: ReturnType<typeof createInMemoryFixture>["state"],
	userId: string,
) {
	for (const wallet of state.wallets.values()) {
		if (wallet.ownerUserId === userId) return wallet;
	}
	return undefined;
}

describe("distributeToken", () => {
	it("moves existing treasury reserve to a user", () => {
		const { app, state, seedUser } = createInMemoryFixture();
		seedUser("alice");
		app.issueToken(ADMIN, { amount: 200 });

		const r = app.distributeToken(ADMIN, { toUserId: "alice", amount: 80 });

		expect(r).toEqual({
			ok: true,
			value: { operationId: expect.any(String) },
		});
		expect(state.wallets.get(TREASURY_WALLET_ID)?.balance).toBe(120);
		expect(walletOf(state, "alice")?.balance).toBe(80);

		const op = state.operationRows.at(-1)?.record;
		expect(op?.kind).toBe("DISTRIBUTION");
		expect(op?.actorKind).toBe("service");
		expect(op?.actorId).toBe("admin-api");
		const entry = state.ledgerRows.at(-1)?.record;
		expect(entry?.fromWalletId).toBe(TREASURY_WALLET_ID);
		expect(entry?.toWalletId).toBe(walletOf(state, "alice")?.id);
		expect(entry?.amount).toBe(80);
	});

	it("insufficient treasury rejects without implicit issuance — exhaustion is a valid state", () => {
		const { app, state, seedUser } = createInMemoryFixture();
		seedUser("alice");
		app.issueToken(ADMIN, { amount: 50 });
		const before = state.operationRows.length;
		const ledgerBefore = state.ledgerRows.length;

		const r = app.distributeToken(ADMIN, { toUserId: "alice", amount: 51 });

		expect(r).toMatchObject({
			ok: false,
			error: { type: "rejected", code: "INSUFFICIENT_BALANCE" },
		});
		expect(state.wallets.get(TREASURY_WALLET_ID)?.balance).toBe(50);
		expect(walletOf(state, "alice")?.balance).toBe(0);
		expect(state.operationRows).toHaveLength(before);
		expect(state.ledgerRows).toHaveLength(ledgerBefore);
	});

	it("rejects distribution to a user that owns no wallet", () => {
		const { app, state } = createInMemoryFixture();
		app.issueToken(ADMIN, { amount: 50 });
		const before = state.operationRows.length;

		const r = app.distributeToken(ADMIN, { toUserId: "ghost", amount: 10 });

		expect(r).toMatchObject({
			ok: false,
			error: { type: "rejected", code: "WALLET_NOT_FOUND" },
		});
		expect(state.wallets.get(TREASURY_WALLET_ID)?.balance).toBe(50);
		expect(state.operationRows).toHaveLength(before);
	});

	it.each(["user", "system"] as const)(
		"rejects a %s actor as forbidden",
		(kind) => {
			const { app, seedUser } = createInMemoryFixture();
			seedUser("alice");
			app.issueToken(ADMIN, { amount: 50 });
			const actor = kind === "user" ? userActor("alice") : SYSTEM;

			const r = app.distributeToken(actor, { toUserId: "alice", amount: 10 });

			expect(r).toMatchObject({ ok: false, error: { type: "forbidden" } });
		},
	);
});
