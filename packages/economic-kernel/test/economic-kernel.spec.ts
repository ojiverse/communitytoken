import { describe, expect, it } from "vitest";
import {
	type CommunityState,
	commitOperation,
	evaluateOperation,
	initializeCommunity,
	issuedAmount,
	type KernelPorts,
	MAX_MONETARY_VALUE,
	type OperationCommand,
	registerUser,
	TREASURY_WALLET_ID,
	totalSupply,
} from "../src/index";

/**
 * Storage-independent contract tests for the CommunityToken economic kernel.
 *
 * The first block reproduces the three migration-contract scenarios of issue
 * #3 §4. Every later block names the economic invariant of
 * docs/economic-model.md §4 it verifies. No Durable Object, SQLite,
 * PostgreSQL, or Cloudflare API appears here: the kernel is exercised through
 * its public functions only, so the suite is the compatibility contract for
 * any storage backend.
 */

function testPorts(): KernelPorts {
	let seq = 0;
	return {
		clock: { now: () => 1_700_000_000_000 },
		ids: { nextId: () => `test-id-${++seq}` },
	};
}

function community(...userIds: string[]) {
	const ports = testPorts();
	let state = initializeCommunity(ports);
	for (const userId of userIds) {
		state = registerUser(state, userId, ports);
	}
	return { ports, state };
}

function walletOf(state: CommunityState, userId: string) {
	const user = state.users.get(userId);
	if (!user) throw new Error(`fixture has no user: ${userId}`);
	const wallet = state.wallets.get(user.walletId);
	if (!wallet) throw new Error(`fixture has no wallet: ${user.walletId}`);
	return wallet;
}

function run(
	ports: KernelPorts,
	state: CommunityState,
	command: OperationCommand,
) {
	const decision = evaluateOperation(state, command, ports);
	return decision.accepted
		? { decision, state: commitOperation(state, decision) }
		: { decision, state };
}

function issue(ports: KernelPorts, state: CommunityState, amount: number) {
	return run(ports, state, {
		kind: "TOKEN_ISSUANCE",
		fromWalletId: TREASURY_WALLET_ID,
		toWalletId: TREASURY_WALLET_ID,
		amount,
	});
}

function distribute(
	ports: KernelPorts,
	state: CommunityState,
	toWalletId: string,
	amount: number,
	metadata?: string,
) {
	return run(ports, state, {
		kind: "DISTRIBUTION",
		fromWalletId: TREASURY_WALLET_ID,
		toWalletId,
		amount,
		...(metadata === undefined ? {} : { metadata }),
	});
}

function p2p(
	ports: KernelPorts,
	state: CommunityState,
	fromWalletId: string,
	toWalletId: string,
	amount: number,
) {
	return run(ports, state, {
		kind: "P2P_TRANSFER",
		fromWalletId,
		toWalletId,
		amount,
	});
}

function payTreasury(
	ports: KernelPorts,
	state: CommunityState,
	fromWalletId: string,
	amount: number,
) {
	return run(ports, state, {
		kind: "TREASURY_PAYMENT",
		fromWalletId,
		toWalletId: TREASURY_WALLET_ID,
		amount,
	});
}

describe("issue #3 §4 migration-contract scenarios", () => {
	it("Alice=100, Bob=0: Alice transfers 30 -> Alice=70, Bob=30, supply unchanged", () => {
		const { ports, state: s0 } = community("alice", "bob");
		const alice = walletOf(s0, "alice").id;
		const bob = walletOf(s0, "bob").id;

		let state = issue(ports, s0, 100).state;
		state = distribute(ports, state, alice, 100).state;
		const supplyBefore = totalSupply(state);
		state = p2p(ports, state, alice, bob, 30).state;

		expect(walletOf(state, "alice").balance).toBe(70);
		expect(walletOf(state, "bob").balance).toBe(30);
		expect(totalSupply(state)).toBe(supplyBefore);
	});

	it("treasury=0: issuing 100 raises treasury balance and total issuance by 100", () => {
		const { ports, state: s0 } = community();

		const state = issue(ports, s0, 100).state;

		expect(state.wallets.get(TREASURY_WALLET_ID)?.balance).toBe(100);
		expect(issuedAmount(state)).toBe(100);
		expect(totalSupply(state)).toBe(100);
	});

	it("Alice=10: transferring 20 fails atomically, no ledger entry or balance mutation", () => {
		const { ports, state: s0 } = community("alice", "bob");
		const alice = walletOf(s0, "alice").id;
		const bob = walletOf(s0, "bob").id;
		let state = issue(ports, s0, 10).state;
		state = distribute(ports, state, alice, 10).state;

		const r = p2p(ports, state, alice, bob, 20);

		expect(r.decision.accepted).toBe(false);
		expect(r.state).toBe(state);
		expect(walletOf(r.state, "alice").balance).toBe(10);
		expect(walletOf(r.state, "bob").balance).toBe(0);
		expect(r.state.operations).toHaveLength(2);
		expect(r.state.ledger).toHaveLength(2);
	});
});

describe("invariant: token amounts are in range", () => {
	it.each([0, -5, 1.5, Number.NaN, MAX_MONETARY_VALUE + 1])(
		"rejects amount %s",
		(amount) => {
			const { ports, state } = community("alice", "bob");
			const r = p2p(
				ports,
				state,
				walletOf(state, "alice").id,
				walletOf(state, "bob").id,
				amount,
			);
			expect(r.decision).toMatchObject({
				accepted: false,
				code: "INVALID_AMOUNT",
			});
		},
	);

	it("accepts the upper domain boundary 2^53 - 1", () => {
		const { ports, state } = community();
		const r = issue(ports, state, MAX_MONETARY_VALUE);
		expect(r.decision.accepted).toBe(true);
		expect(totalSupply(r.state)).toBe(MAX_MONETARY_VALUE);
	});
});

describe("invariant: balances stay in range", () => {
	it("rejects a credit that would push the destination balance above the domain", () => {
		const { ports, state: s0 } = community();
		const state = issue(ports, s0, MAX_MONETARY_VALUE).state;

		const r = issue(ports, state, 1);

		expect(r.decision).toMatchObject({ accepted: false, code: "OVERFLOW" });
		expect(r.state.wallets.get(TREASURY_WALLET_ID)?.balance).toBe(
			MAX_MONETARY_VALUE,
		);
	});

	it("rejects issuance that would push total supply above the domain even when the treasury has headroom", () => {
		const { ports, state: s0 } = community("alice");
		const alice = walletOf(s0, "alice").id;
		let state = issue(ports, s0, MAX_MONETARY_VALUE).state;
		state = distribute(ports, state, alice, 5).state;

		const r = issue(ports, state, 1);

		expect(r.decision).toMatchObject({ accepted: false, code: "OVERFLOW" });
		expect(totalSupply(r.state)).toBe(MAX_MONETARY_VALUE);
	});
});

describe("invariant: direction discipline", () => {
	it("rejects every kind used with a wallet-kind direction other than its own", () => {
		const { ports, state } = community("alice", "bob");
		const alice = walletOf(state, "alice").id;
		const bob = walletOf(state, "bob").id;

		const cases: readonly [string, OperationCommand][] = [
			[
				"issuance must be a self-transfer on a system wallet",
				{
					kind: "TOKEN_ISSUANCE",
					fromWalletId: TREASURY_WALLET_ID,
					toWalletId: alice,
					amount: 1,
				},
			],
			[
				"issuance cannot self-transfer a user wallet",
				{
					kind: "TOKEN_ISSUANCE",
					fromWalletId: alice,
					toWalletId: alice,
					amount: 1,
				},
			],
			[
				"distribution must be system -> user",
				{
					kind: "DISTRIBUTION",
					fromWalletId: alice,
					toWalletId: bob,
					amount: 1,
				},
			],
			[
				"distribution cannot target a system wallet",
				{
					kind: "DISTRIBUTION",
					fromWalletId: TREASURY_WALLET_ID,
					toWalletId: TREASURY_WALLET_ID,
					amount: 1,
				},
			],
			[
				"p2p must be user -> user",
				{
					kind: "P2P_TRANSFER",
					fromWalletId: TREASURY_WALLET_ID,
					toWalletId: alice,
					amount: 1,
				},
			],
			[
				"treasury payment must be user -> system",
				{
					kind: "TREASURY_PAYMENT",
					fromWalletId: TREASURY_WALLET_ID,
					toWalletId: TREASURY_WALLET_ID,
					amount: 1,
				},
			],
		];

		for (const [name, command] of cases) {
			expect(run(ports, state, command).decision, name).toMatchObject({
				accepted: false,
				code: "DIRECTION_VIOLATION",
			});
		}
	});
});

describe("invariant: rejection leaves no trace", () => {
	it("a rejected decision carries no operation, ledger entry, or balance change", () => {
		const { ports, state } = community("alice", "bob");
		const r = p2p(
			ports,
			state,
			walletOf(state, "alice").id,
			walletOf(state, "bob").id,
			10,
		);

		expect(r.decision).toMatchObject({
			accepted: false,
			code: "INSUFFICIENT_BALANCE",
		});
		expect("operation" in r.decision).toBe(false);
		expect("ledgerEntry" in r.decision).toBe(false);
		expect("balanceChanges" in r.decision).toBe(false);
		expect(r.state).toBe(state);
	});

	it("references to wallets that do not exist are rejected", () => {
		const { ports, state } = community("alice");
		const r = p2p(ports, state, walletOf(state, "alice").id, "ghost", 1);
		expect(r.decision).toMatchObject({
			accepted: false,
			code: "WALLET_NOT_FOUND",
		});
		expect(r.state).toBe(state);
	});
});

describe("invariant: append-only ledger semantics", () => {
	it("commits append new entries without altering prior history", () => {
		const { ports, state: s0 } = community("alice");
		const alice = walletOf(s0, "alice").id;
		let state = issue(ports, s0, 50).state;
		const firstEntry = state.ledger[0];
		const firstOperation = state.operations[0];

		state = distribute(ports, state, alice, 20).state;

		expect(state.ledger).toHaveLength(2);
		expect(state.ledger[0]).toBe(firstEntry);
		expect(state.operations[0]).toBe(firstOperation);
		expect(new Set(state.ledger.map((e) => e.id)).size).toBe(2);
		expect(new Set(state.operations.map((o) => o.id)).size).toBe(2);
	});
});

describe("invariant: issuance-only supply growth", () => {
	it("distribution, p2p, and treasury payment preserve total supply exactly", () => {
		const { ports, state: s0 } = community("alice", "bob");
		const alice = walletOf(s0, "alice").id;
		const bob = walletOf(s0, "bob").id;
		let state = issue(ports, s0, 100).state;
		expect(totalSupply(state)).toBe(100);

		state = distribute(ports, state, alice, 60).state;
		state = p2p(ports, state, alice, bob, 10).state;
		state = payTreasury(ports, state, bob, 5).state;

		expect(totalSupply(state)).toBe(100);
		expect(issuedAmount(state)).toBe(100);
	});
});

describe("invariant: supply accounting", () => {
	it("total issuance equals the sum of all wallet balances after every operation", () => {
		const { ports, state: s0 } = community("alice", "bob");
		const alice = walletOf(s0, "alice").id;
		const bob = walletOf(s0, "bob").id;

		let state = issue(ports, s0, 200).state;
		state = distribute(ports, state, alice, 120).state;
		state = p2p(ports, state, alice, bob, 45).state;
		state = payTreasury(ports, state, bob, 15).state;
		state = issue(ports, state, 30).state;

		const balanceSum = [...state.wallets.values()].reduce(
			(sum, w) => sum + w.balance,
			0,
		);
		expect(issuedAmount(state)).toBe(230);
		expect(totalSupply(state)).toBe(230);
		expect(balanceSum).toBe(230);
	});
});

describe("invariant: one wallet per user", () => {
	it("registerUser creates exactly one wallet per user and rejects duplicates", () => {
		const { ports, state: s0 } = community();
		const s1 = registerUser(s0, "alice", ports);

		const user = s1.users.get("alice");
		expect(user?.walletId).toBeDefined();
		expect(s1.wallets.get(user?.walletId ?? "")?.kind).toBe("user");
		expect(
			[...s1.wallets.values()].filter((w) => w.kind === "user"),
		).toHaveLength(1);
		expect(() => registerUser(s1, "alice", ports)).toThrow(
			/already registered/,
		);
	});
});

describe("invariant: single community scope", () => {
	it("a fresh community holds exactly one system wallet and nothing else", () => {
		const { state } = community();
		expect(state.users.size).toBe(0);
		expect(state.wallets.size).toBe(1);
		expect(state.wallets.get(TREASURY_WALLET_ID)?.kind).toBe("system");
		expect(state.operations).toHaveLength(0);
		expect(state.ledger).toHaveLength(0);
	});
});

describe("semantic operation record", () => {
	it("persists the operation kind and opaque metadata, linked from the ledger entry", () => {
		const { ports, state: s0 } = community("alice");
		const alice = walletOf(s0, "alice").id;
		let state = issue(ports, s0, 10).state;
		state = distribute(ports, state, alice, 10, "welcome bonus").state;

		const operation = state.operations[1];
		const entry = state.ledger[1];
		expect(operation?.kind).toBe("DISTRIBUTION");
		expect(operation?.metadata).toBe("welcome bonus");
		expect(entry?.operationId).toBe(operation?.id);
		expect(entry?.fromWalletId).toBe(TREASURY_WALLET_ID);
		expect(entry?.toWalletId).toBe(alice);
	});
});
