import { describe, expect, it } from "vitest";
import { userId } from "../src/types";
import { ADMIN, asUser, SYSTEM, userActor } from "./fixtures";
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

function funded(
	rawUserId: string,
	amount: number,
): ReturnType<typeof createInMemoryFixture> {
	const fx = createInMemoryFixture();
	fx.seedUser(rawUserId);
	fx.app.issueToken(ADMIN, { amount });
	fx.app.distributeToken(ADMIN, { toUserId: userId(rawUserId), amount });
	return fx;
}

describe("transferToken", () => {
	it("moves funds between user wallets and records the user actor", () => {
		const fx = funded("alice", 100);
		fx.seedUser("bob");
		const before = fx.state.operationRows.length;

		const r = fx.app.transferToken(userActor("alice"), {
			toUserId: userId("bob"),
			amount: 30,
		});

		expect(r).toEqual({
			ok: true,
			value: { operationId: expect.any(String), fromBalance: 70 },
		});
		expect(walletOf(fx.state, "alice")?.balance).toBe(70);
		expect(walletOf(fx.state, "bob")?.balance).toBe(30);

		const op = fx.state.operationRows.at(-1)?.record;
		expect(op?.kind).toBe("P2P_TRANSFER");
		expect(op?.actorKind).toBe("user");
		expect(op?.actorId).toBe("alice");
		const entry = fx.state.ledgerRows.at(-1)?.record;
		expect(entry?.fromWalletId).toBe(walletOf(fx.state, "alice")?.id);
		expect(entry?.toWalletId).toBe(walletOf(fx.state, "bob")?.id);
		expect(entry?.amount).toBe(30);
		expect(fx.state.operationRows.length).toBe(before + 1);
	});

	it("preserves total supply", () => {
		const fx = funded("alice", 100);
		fx.seedUser("bob");
		const supply = fx.state.wallets.values().reduce((s, w) => s + w.balance, 0);

		fx.app.transferToken(userActor("alice"), {
			toUserId: userId("bob"),
			amount: 30,
		});

		expect(fx.state.wallets.values().reduce((s, w) => s + w.balance, 0)).toBe(
			supply,
		);
	});

	it("a self-transfer is a valid net-zero movement that is still recorded", () => {
		const fx = funded("alice", 100);
		const opsBefore = fx.state.operationRows.length;
		const ledgerBefore = fx.state.ledgerRows.length;

		const r = fx.app.transferToken(userActor("alice"), {
			toUserId: userId("alice"),
			amount: 30,
		});

		expect(r.ok).toBe(true);
		expect(walletOf(fx.state, "alice")?.balance).toBe(100);
		expect(fx.state.operationRows.length).toBe(opsBefore + 1);
		expect(fx.state.ledgerRows.length).toBe(ledgerBefore + 1);
		const entry = fx.state.ledgerRows.at(-1)?.record;
		expect(entry?.fromWalletId).toBe(entry?.toWalletId);
		expect(entry?.amount).toBe(30);
	});

	it("rejects a transfer exceeding balance atomically: no writes at all", () => {
		const fx = funded("alice", 10);
		fx.seedUser("bob");
		const opsBefore = fx.state.operationRows.length;
		const ledgerBefore = fx.state.ledgerRows.length;

		const r = fx.app.transferToken(userActor("alice"), {
			toUserId: userId("bob"),
			amount: 20,
		});

		expect(r).toMatchObject({
			ok: false,
			error: { type: "rejected", code: "INSUFFICIENT_BALANCE" },
		});
		expect(walletOf(fx.state, "alice")?.balance).toBe(10);
		expect(walletOf(fx.state, "bob")?.balance).toBe(0);
		expect(fx.state.operationRows.length).toBe(opsBefore);
		expect(fx.state.ledgerRows.length).toBe(ledgerBefore);
	});

	it("rejects a transfer to a user that owns no wallet", () => {
		const fx = funded("alice", 10);

		const r = fx.app.transferToken(userActor("alice"), {
			toUserId: userId("ghost"),
			amount: 1,
		});

		expect(r).toMatchObject({
			ok: false,
			error: { type: "rejected", code: "WALLET_NOT_FOUND" },
		});
	});

	it("rejects a sender that owns no wallet", () => {
		const { app } = createInMemoryFixture();

		const r = app.transferToken(userActor("ghost"), {
			toUserId: userId("anyone"),
			amount: 1,
		});

		expect(r).toMatchObject({
			ok: false,
			error: { type: "rejected", code: "WALLET_NOT_FOUND" },
		});
	});

	it.each([
		["service", ADMIN],
		["system", SYSTEM],
	] as const)("rejects a %s actor as forbidden", (_label, actor) => {
		const fx = funded("alice", 10);
		fx.seedUser("bob");
		const opsBefore = fx.state.operationRows.length;

		const r = fx.app.transferToken(asUser(actor), {
			toUserId: userId("bob"),
			amount: 1,
		});

		expect(r).toMatchObject({ ok: false, error: { type: "forbidden" } });
		expect(fx.state.operationRows.length).toBe(opsBefore);
	});
});
