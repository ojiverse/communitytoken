import { describe, expect, it } from "vitest";
import { TREASURY_SELECTOR, userId, userSelector } from "../src/types";
import {
	ADMIN,
	asAdmin,
	asUser,
	OTHER_SERVICE,
	SYSTEM,
	userActor,
} from "./fixtures";
import { createInMemoryFixture } from "./in-memory";

function fund(rawUserId: string, amount: number) {
	const fx = createInMemoryFixture();
	fx.seedUser(rawUserId);
	fx.app.issueToken(ADMIN, { amount });
	fx.app.distributeToken(ADMIN, { toUserId: userId(rawUserId), amount });
	return fx;
}

describe("getTransactionHistory", () => {
	it("returns a user's operations newest-first with direction and counterparty", () => {
		const fx = fund("alice", 100);
		fx.seedUser("bob");
		fx.app.transferToken(userActor("alice"), {
			toUserId: userId("bob"),
			amount: 30,
		});
		fx.app.payTreasury(userActor("alice"), { amount: 10 });

		const r = fx.app.getTransactionHistory(
			userActor("alice"),
			userSelector(userId("alice")),
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
		expect(transfer?.counterparty).toBe(userId("bob"));
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
			userSelector(userId("alice")),
			{},
		);

		expect(r.ok).toBe(true);
		if (!r.ok) return;
		expect(r.value.entries).toHaveLength(1);
		expect(r.value.entries[0]?.kind).toBe("DISTRIBUTION");
	});

	it("the treasury view is admin-only and includes issuances", () => {
		const fx = fund("alice", 100);
		fx.seedUser("bob");
		fx.app.transferToken(userActor("alice"), {
			toUserId: userId("bob"),
			amount: 20,
		});

		const r = fx.app.getTransactionHistory(ADMIN, TREASURY_SELECTOR, {});

		expect(r.ok).toBe(true);
		if (!r.ok) return;
		const kinds = r.value.entries.map((e) => e.kind);
		expect(kinds).toEqual(["DISTRIBUTION", "TOKEN_ISSUANCE"]);
		const distribution = r.value.entries[0];
		expect(distribution?.direction).toBe("out");
		expect(distribution?.counterparty).toBe(userId("alice"));
		const issuance = r.value.entries[1];
		expect(issuance?.direction).toBe("in");
		expect(issuance?.counterparty).toBe("treasury");
	});

	it("a self-transfer reads direction 'self' with the user as own counterparty", () => {
		const fx = fund("alice", 50);
		fx.app.transferToken(userActor("alice"), {
			toUserId: userId("alice"),
			amount: 5,
		});

		const r = fx.app.getTransactionHistory(
			userActor("alice"),
			userSelector(userId("alice")),
			{},
		);

		expect(r.ok).toBe(true);
		if (!r.ok) return;
		const self = r.value.entries[0];
		expect(self?.kind).toBe("P2P_TRANSFER");
		expect(self?.direction).toBe("self");
		expect(self?.counterparty).toBe(userId("alice"));
	});

	it.each([
		[
			"another user's history",
			() => userActor("alice"),
			() => userSelector(userId("bob")),
		],
		[
			"a user history as service",
			() => asUser(ADMIN),
			() => userSelector(userId("alice")),
		],
		[
			"a user history as system",
			() => asUser(SYSTEM),
			() => userSelector(userId("alice")),
		],
	] as const)("forbids %s", (_name, actor, selector) => {
		const fx = fund("alice", 100);
		fx.seedUser("bob");

		const r = fx.app.getTransactionHistory(actor(), selector(), {});

		expect(r).toMatchObject({ ok: false, error: { type: "forbidden" } });
	});

	it.each([
		["a user", () => userActor("alice")],
		["a non-admin service principal", () => OTHER_SERVICE],
		["system", () => SYSTEM],
	] as const)("forbids %s from the treasury history", (_name, actor) => {
		const fx = fund("alice", 100);

		const r = fx.app.getTransactionHistory(
			asAdmin(actor()),
			TREASURY_SELECTOR,
			{},
		);

		expect(r).toMatchObject({ ok: false, error: { type: "forbidden" } });
	});

	it("reports WALLET_NOT_FOUND for a user that owns no wallet", () => {
		const { app } = createInMemoryFixture();

		const r = app.getTransactionHistory(
			userActor("ghost"),
			userSelector(userId("ghost")),
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
			fx.app.distributeToken(ADMIN, { toUserId: userId("alice"), amount: 1 });
		}

		const first = fx.app.getTransactionHistory(
			userActor("alice"),
			userSelector(userId("alice")),
			{},
		);
		expect(first.ok).toBe(true);
		if (!first.ok) return;
		expect(first.value.entries).toHaveLength(50);
		expect(first.value.nextCursor).not.toBeNull();

		const second = fx.app.getTransactionHistory(
			userActor("alice"),
			userSelector(userId("alice")),
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

	it.each([0, -1, 1.5, Number.NaN, 101, 200])(
		"rejects an out-of-contract page limit %s as invalid-input",
		(limit) => {
			const fx = fund("alice", 10);

			const r = fx.app.getTransactionHistory(
				userActor("alice"),
				userSelector(userId("alice")),
				{ limit },
			);

			expect(r).toMatchObject({
				ok: false,
				error: { type: "invalid-input", code: "INVALID_LIMIT" },
			});
		},
	);

	it("honors the boundary page sizes 1 and 100", () => {
		const fx = createInMemoryFixture();
		fx.seedUser("alice");
		fx.app.issueToken(ADMIN, { amount: 120 });
		for (let i = 0; i < 120; i++) {
			fx.app.distributeToken(ADMIN, { toUserId: userId("alice"), amount: 1 });
		}

		const full = fx.app.getTransactionHistory(
			userActor("alice"),
			userSelector(userId("alice")),
			{ limit: 100 },
		);
		expect(full.ok).toBe(true);
		if (!full.ok) return;
		expect(full.value.entries).toHaveLength(100);
		expect(full.value.nextCursor).not.toBeNull();

		const single = fx.app.getTransactionHistory(
			userActor("alice"),
			userSelector(userId("alice")),
			{ limit: 1 },
		);
		expect(single.ok).toBe(true);
		if (!single.ok) return;
		expect(single.value.entries).toHaveLength(1);
		expect(single.value.entries[0]?.kind).toBe("DISTRIBUTION");
		expect(single.value.nextCursor).not.toBeNull();
	});
});
