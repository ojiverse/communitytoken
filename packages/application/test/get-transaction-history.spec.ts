import { describe, expect, it } from "vitest";
import { TREASURY_SELECTOR, userSelector } from "../src/types";
import { ADMIN, SYSTEM, userActor } from "./fixtures";
import { createInMemoryFixture } from "./in-memory";

function fund(userId: string, amount: number) {
	const fx = createInMemoryFixture();
	fx.seedUser(userId);
	fx.app.issueToken(ADMIN, { amount });
	fx.app.distributeToken(ADMIN, { toUserId: userId, amount });
	return fx;
}

describe("getTransactionHistory", () => {
	it("returns a user's operations newest-first with direction and counterparty", () => {
		const fx = fund("alice", 100);
		fx.seedUser("bob");
		fx.app.transferToken(userActor("alice"), { toUserId: "bob", amount: 30 });
		fx.app.payTreasury(userActor("alice"), { amount: 10 });

		const r = fx.app.getTransactionHistory(
			userActor("alice"),
			userSelector("alice"),
			{},
		);

		expect(r.ok).toBe(true);
		if (!r.ok) return;
		expect(r.value.nextCursor).toBeNull();
		const kinds = r.value.entries.map((e) => e.kind);
		expect(kinds).toEqual(["TREASURY_PAYMENT", "P2P_TRANSFER", "DISTRIBUTION"]);

		const [payment, transfer, distribution] = r.value.entries;
		expect(distribution?.direction).toBe("in");
		expect(distribution?.counterparty).toBe("treasury");
		expect(transfer?.direction).toBe("out");
		expect(transfer?.counterparty).toBe("bob");
		expect(payment?.direction).toBe("out");
		expect(payment?.counterparty).toBe("treasury");
		expect(transfer?.actorKind).toBe("user");
		expect(transfer?.actorId).toBe("alice");
		expect(distribution?.actorKind).toBe("service");
		expect(distribution?.actorId).toBe("admin-api");
	});

	it("excludes TOKEN_ISSUANCE from a user's history by construction", () => {
		const fx = fund("alice", 100);

		const r = fx.app.getTransactionHistory(
			userActor("alice"),
			userSelector("alice"),
			{},
		);

		expect(r.ok).toBe(true);
		if (!r.ok) return;
		expect(r.value.entries).toHaveLength(1);
		expect(r.value.entries[0]?.kind).toBe("DISTRIBUTION");
	});

	it("the treasury view is service-only and includes issuances", () => {
		const fx = fund("alice", 100);
		fx.seedUser("bob");
		fx.app.transferToken(userActor("alice"), { toUserId: "bob", amount: 20 });

		const r = fx.app.getTransactionHistory(ADMIN, TREASURY_SELECTOR, {});

		expect(r.ok).toBe(true);
		if (!r.ok) return;
		const kinds = r.value.entries.map((e) => e.kind);
		expect(kinds).toEqual(["DISTRIBUTION", "TOKEN_ISSUANCE"]);
		const distribution = r.value.entries[0];
		expect(distribution?.direction).toBe("out");
		expect(distribution?.counterparty).toBe("alice");
		const issuance = r.value.entries[1];
		expect(issuance?.direction).toBe("in");
		expect(issuance?.counterparty).toBe("treasury");
	});

	it("a self-transfer reads direction 'in' with the user as own counterparty", () => {
		const fx = fund("alice", 50);
		fx.app.transferToken(userActor("alice"), { toUserId: "alice", amount: 5 });

		const r = fx.app.getTransactionHistory(
			userActor("alice"),
			userSelector("alice"),
			{},
		);

		expect(r.ok).toBe(true);
		if (!r.ok) return;
		const self = r.value.entries[0];
		expect(self?.kind).toBe("P2P_TRANSFER");
		expect(self?.direction).toBe("in");
		expect(self?.counterparty).toBe("alice");
	});

	it.each([
		["another user's history", userActor("alice"), () => userSelector("bob")],
		["the treasury history", userActor("alice"), () => TREASURY_SELECTOR],
		["a user history as service", ADMIN, () => userSelector("alice")],
		["any history as system", SYSTEM, () => userSelector("alice")],
	] as const)("forbids %s", (_name, actor, selector) => {
		const fx = fund("alice", 100);
		fx.seedUser("bob");

		const r = fx.app.getTransactionHistory(actor, selector(), {});

		expect(r).toMatchObject({ ok: false, error: { type: "forbidden" } });
	});

	it("reports WALLET_NOT_FOUND for a user that owns no wallet", () => {
		const { app } = createInMemoryFixture();

		const r = app.getTransactionHistory(
			userActor("ghost"),
			userSelector("ghost"),
			{},
		);

		expect(r).toMatchObject({
			ok: false,
			error: { type: "rejected", code: "WALLET_NOT_FOUND" },
		});
	});

	it("paginates newest-first: default page 50, opaque cursor walks the rest", () => {
		const fx = createInMemoryFixture();
		fx.seedUser("alice");
		fx.app.issueToken(ADMIN, { amount: 60 });
		for (let i = 0; i < 60; i++) {
			fx.app.distributeToken(ADMIN, { toUserId: "alice", amount: 1 });
		}

		const first = fx.app.getTransactionHistory(
			userActor("alice"),
			userSelector("alice"),
			{},
		);
		expect(first.ok).toBe(true);
		if (!first.ok) return;
		expect(first.value.entries).toHaveLength(50);
		expect(first.value.nextCursor).not.toBeNull();

		const second = fx.app.getTransactionHistory(
			userActor("alice"),
			userSelector("alice"),
			{ cursor: first.value.nextCursor },
		);
		expect(second.ok).toBe(true);
		if (!second.ok) return;
		expect(second.value.entries).toHaveLength(10);
		expect(second.value.nextCursor).toBeNull();

		const all = [...first.value.entries, ...second.value.entries];
		const ids = new Set(all.map((e) => e.id));
		expect(ids.size).toBe(60);
		const created = all.map((e) => e.createdAt);
		expect([...created].sort((a, b) => b - a)).toEqual(created);
	});

	it("clamps the page limit to the §17 maximum of 100", () => {
		const fx = createInMemoryFixture();
		fx.seedUser("alice");
		fx.app.issueToken(ADMIN, { amount: 120 });
		for (let i = 0; i < 120; i++) {
			fx.app.distributeToken(ADMIN, { toUserId: "alice", amount: 1 });
		}

		const r = fx.app.getTransactionHistory(
			userActor("alice"),
			userSelector("alice"),
			{ limit: 200 },
		);

		expect(r.ok).toBe(true);
		if (!r.ok) return;
		expect(r.value.entries).toHaveLength(100);
		expect(r.value.nextCursor).not.toBeNull();
	});

	it("honors an explicit limit", () => {
		const fx = fund("alice", 100);
		fx.seedUser("bob");
		fx.app.transferToken(userActor("alice"), { toUserId: "bob", amount: 10 });

		const r = fx.app.getTransactionHistory(
			userActor("alice"),
			userSelector("alice"),
			{ limit: 1 },
		);

		expect(r.ok).toBe(true);
		if (!r.ok) return;
		expect(r.value.entries).toHaveLength(1);
		expect(r.value.entries[0]?.kind).toBe("P2P_TRANSFER");
		expect(r.value.nextCursor).not.toBeNull();
	});
});
