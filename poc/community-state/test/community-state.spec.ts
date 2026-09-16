import { env, evictDurableObject, runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import type { CommunityState } from "../src/index";

/**
 * Phase 1 §5 validation: proves that Worker -> CommunityState DO -> SQLite
 * preserves the CommunityToken economic invariants without PostgreSQL
 * FOR UPDATE / triggers.
 *
 * Each test uses a freshly-named DO id so tests are isolated without any
 * shared storage.
 */

function freshStub(): DurableObjectStub<CommunityState> {
	const id = env.COMMUNITY_STATE.idFromName(crypto.randomUUID());
	return env.COMMUNITY_STATE.get(id) as DurableObjectStub<CommunityState>;
}

async function sumBalances(
	s: DurableObjectStub<CommunityState>,
): Promise<number> {
	return runInDurableObject(s, async (_instance, state) => {
		const row = state.storage.sql
			.exec("SELECT COALESCE(SUM(balance), 0) AS total FROM wallets")
			.one();
		return Number(row["total"]);
	});
}

async function issuanceTotal(
	s: DurableObjectStub<CommunityState>,
): Promise<number> {
	return runInDurableObject(s, async (_instance, state) => {
		const row = state.storage.sql
			.exec(
				"SELECT COALESCE(SUM(l.amount), 0) AS total " +
					"FROM ledger_transactions l " +
					"JOIN economic_operations o ON o.id = l.operation_id " +
					"WHERE o.kind = 'TOKEN_ISSUANCE'",
			)
			.one();
		return Number(row["total"]);
	});
}

describe("CommunityState DO + SQLite persistence PoC", () => {
	it("creates wallets and reports balances", async () => {
		const s = freshStub();
		await s.createWallet("alice");
		expect(await s.getBalance("alice")).toBe(0);
		expect(await s.getBalance("treasury")).toBe(0);
	});

	it("issues tokens via treasury self-transfer; supply grows", async () => {
		const s = freshStub();
		await s.issue(100);
		expect(await s.getBalance("treasury")).toBe(100);
		expect(await issuanceTotal(s)).toBe(100);
		expect(await sumBalances(s)).toBe(100);

		const ops = await s.listOperations();
		const ledger = await s.listLedger();
		expect(ops).toHaveLength(1);
		expect(ops[0]?.kind).toBe("TOKEN_ISSUANCE");
		expect(ledger).toHaveLength(1);
		expect(ledger[0]?.from_wallet_id).toBe("treasury");
		expect(ledger[0]?.to_wallet_id).toBe("treasury");
	});

	it("distributes and transfers P2P preserving total supply", async () => {
		const s = freshStub();
		await s.createWallet("alice");
		await s.createWallet("bob");
		await s.issue(100);
		await s.distribute("alice", 100);
		await s.transferP2P("alice", "bob", 30);

		expect(await s.getBalance("alice")).toBe(70);
		expect(await s.getBalance("bob")).toBe(30);
		expect(await s.getBalance("treasury")).toBe(0);
		expect(await issuanceTotal(s)).toBe(100);
		expect(await sumBalances(s)).toBe(100);

		const kinds = (await s.listOperations()).map((o) => o.kind);
		expect(kinds).toEqual(["TOKEN_ISSUANCE", "DISTRIBUTION", "P2P_TRANSFER"]);
	});

	it("user -> treasury payment works and preserves supply", async () => {
		const s = freshStub();
		await s.createWallet("alice");
		await s.issue(50);
		await s.distribute("alice", 50);
		await s.payTreasury("alice", 20);

		expect(await s.getBalance("alice")).toBe(30);
		expect(await s.getBalance("treasury")).toBe(20);
		expect(await sumBalances(s)).toBe(50);
	});

	it("rolls back a failed transfer atomically: no balance change, no rows", async () => {
		const s = freshStub();
		await s.createWallet("alice");
		await s.createWallet("bob");
		await s.issue(10);
		await s.distribute("alice", 10);

		await expect(s.transferP2P("alice", "bob", 20)).rejects.toThrow(
			/insufficient balance/,
		);

		expect(await s.getBalance("alice")).toBe(10);
		expect(await s.getBalance("bob")).toBe(0);
		// 2 successful ops (issue+distribute) only; the failed op left nothing
		expect(await s.listOperations()).toHaveLength(2);
		expect(await s.listLedger()).toHaveLength(2);
	});

	it("rolls back when the recipient wallet does not exist mid-transaction", async () => {
		const s = freshStub();
		await s.createWallet("alice");
		await s.issue(10);
		await s.distribute("alice", 10);

		await expect(s.transferP2P("alice", "ghost", 5)).rejects.toThrow();
		expect(await s.getBalance("alice")).toBe(10);
		expect(await s.listOperations()).toHaveLength(2);
		expect(await s.listLedger()).toHaveLength(2);
	});

	it("rejects non-positive and non-integer amounts", async () => {
		const s = freshStub();
		await s.createWallet("alice");
		await s.issue(10);
		await s.distribute("alice", 10);
		await s.createWallet("bob");

		await expect(s.transferP2P("alice", "bob", 0)).rejects.toThrow();
		await expect(s.transferP2P("alice", "bob", -5)).rejects.toThrow();
		await expect(s.transferP2P("alice", "bob", 1.5)).rejects.toThrow();
	});

	it("rejects a credit that would overflow the wallet balance domain", async () => {
		const s = freshStub();
		await s.issue(Number.MAX_SAFE_INTEGER);

		await expect(s.issue(1)).rejects.toThrow(/overflow/);
		expect(await s.getBalance("treasury")).toBe(Number.MAX_SAFE_INTEGER);
		expect(await sumBalances(s)).toBe(Number.MAX_SAFE_INTEGER);
	});

	it("rejects issuance that would overflow total supply even when treasury has headroom", async () => {
		const s = freshStub();
		await s.createWallet("alice");
		await s.issue(Number.MAX_SAFE_INTEGER);
		await s.distribute("alice", 5);
		// treasury = MAX-5 has room for +3, but supply is already at MAX

		await expect(s.issue(3)).rejects.toThrow(/overflow/);
		expect(await s.getBalance("treasury")).toBe(Number.MAX_SAFE_INTEGER - 5);
		expect(await sumBalances(s)).toBe(Number.MAX_SAFE_INTEGER);
	});

	it("rejects operations with wrong wallet-kind direction", async () => {
		const s = freshStub();
		await s.createWallet("alice");
		await s.issue(10);
		await s.distribute("alice", 10);

		// a "distribution" whose target is the treasury is a direction violation
		await expect(s.distribute("treasury", 5)).rejects.toThrow();
		// treasury payment must come from a user wallet
		await expect(s.payTreasury("treasury", 5)).rejects.toThrow();
		expect(await sumBalances(s)).toBe(10);
	});

	it("serializes concurrent transfers; no double-spend, no lost update", async () => {
		const s = freshStub();
		await s.createWallet("alice");
		await s.createWallet("bob");
		await s.issue(100);
		await s.distribute("alice", 100);

		const attempts = await Promise.allSettled(
			Array.from({ length: 20 }, () => s.transferP2P("alice", "bob", 10)),
		);
		const succeeded = attempts.filter((a) => a.status === "fulfilled");

		expect(succeeded).toHaveLength(10);
		expect(await s.getBalance("alice")).toBe(0);
		expect(await s.getBalance("bob")).toBe(100);
		expect(await sumBalances(s)).toBe(100);
		// every successful op has exactly one ledger row
		expect(await s.listOperations()).toHaveLength(12);
		expect(await s.listLedger()).toHaveLength(12);
	});

	it("demonstrates the unsafe (no-transaction) path loses funds", async () => {
		const s = freshStub();
		await s.createWallet("alice");
		await s.issue(10);
		await s.distribute("alice", 10);

		// recipient does not exist: debit succeeds, credit is a silent no-op
		await s.transferP2PUnsafe("alice", "ghost", 10);

		expect(await s.getBalance("alice")).toBe(0);
		expect(await sumBalances(s)).toBe(0); // supply vanished: invariant broken
	});

	it("ledger is append-only at storage level", async () => {
		const s = freshStub();
		await s.issue(5);

		await expect(
			runInDurableObject(s, async (_i, state) => {
				state.storage.sql.exec("UPDATE ledger_transactions SET amount = 999");
			}),
		).rejects.toThrow();

		await expect(
			runInDurableObject(s, async (_i, state) => {
				state.storage.sql.exec("DELETE FROM ledger_transactions");
			}),
		).rejects.toThrow();
	});

	it("state physically lives in ctx.storage.sql, not JS memory", async () => {
		const s = freshStub();
		await s.issue(42);

		const rows = await runInDurableObject(s, async (_i, state) => {
			return state.storage.sql
				.exec("SELECT COUNT(*) AS n FROM ledger_transactions")
				.one()["n"];
		});
		expect(Number(rows)).toBe(1);
	});

	it("preserves committed state across Durable Object eviction", async () => {
		const s = freshStub();
		await s.createWallet("alice");
		await s.issue(100);
		await s.distribute("alice", 70);

		await evictDurableObject(s);

		// after eviction the DO reconstructs from durable SQLite storage only
		expect(await s.getBalance("alice")).toBe(70);
		expect(await s.getBalance("treasury")).toBe(30);
		expect(await s.listOperations()).toHaveLength(2);
		expect(await s.listLedger()).toHaveLength(2);
	});
});
