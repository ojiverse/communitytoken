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

describe("payTreasury", () => {
	it("returns value from a user to the treasury", () => {
		const fx = createInMemoryFixture();
		fx.seedUser("alice");
		fx.app.issueToken(ADMIN, { amount: 100 });
		fx.app.distributeToken(ADMIN, { toUserId: "alice", amount: 50 });

		const r = fx.app.payTreasury(userActor("alice"), { amount: 15 });

		expect(r).toEqual({
			ok: true,
			value: { operationId: expect.any(String), fromBalance: 35 },
		});
		expect(walletOf(fx.state, "alice")?.balance).toBe(35);
		expect(fx.state.wallets.get(TREASURY_WALLET_ID)?.balance).toBe(65);

		const op = fx.state.operationRows.at(-1)?.record;
		expect(op?.kind).toBe("TREASURY_PAYMENT");
		expect(op?.actorKind).toBe("user");
		expect(op?.actorId).toBe("alice");
		const entry = fx.state.ledgerRows.at(-1)?.record;
		expect(entry?.fromWalletId).toBe(walletOf(fx.state, "alice")?.id);
		expect(entry?.toWalletId).toBe(TREASURY_WALLET_ID);
		expect(entry?.amount).toBe(15);
	});

	it("rejects a payment exceeding balance with no writes", () => {
		const fx = createInMemoryFixture();
		fx.seedUser("alice");
		const opsBefore = fx.state.operationRows.length;

		const r = fx.app.payTreasury(userActor("alice"), { amount: 1 });

		expect(r).toMatchObject({
			ok: false,
			error: { type: "rejected", code: "INSUFFICIENT_BALANCE" },
		});
		expect(fx.state.operationRows.length).toBe(opsBefore);
	});

	it.each([
		["service", ADMIN],
		["system", SYSTEM],
	] as const)("rejects a %s actor as forbidden", (_label, actor) => {
		const fx = createInMemoryFixture();
		fx.seedUser("alice");

		const r = fx.app.payTreasury(actor, { amount: 1 });

		expect(r).toMatchObject({ ok: false, error: { type: "forbidden" } });
	});
});
