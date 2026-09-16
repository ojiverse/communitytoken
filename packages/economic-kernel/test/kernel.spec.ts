import { describe, expect, it } from "vitest";
import {
	type EconomicFacts,
	evaluateOperation,
	MAX_MONETARY_VALUE,
	TREASURY_WALLET_ID,
} from "../src/index";

/**
 * Unit tests for mechanics of the pure evaluator that the contract suite
 * cannot express: the delta map shape, the facts/command identity contract,
 * and the absence of durable ids or timestamps on effects.
 */

const treasury = {
	id: TREASURY_WALLET_ID,
	kind: "system",
	balance: 100,
} as const;
const alice = { id: "w-alice", kind: "user", balance: 100 } as const;
const bob = { id: "w-bob", kind: "user", balance: 0 } as const;

function facts(
	from: EconomicFacts["from"],
	to: EconomicFacts["to"],
	totalSupply = 100,
): EconomicFacts {
	return { from, to, totalSupply };
}

describe("evaluateOperation mechanics", () => {
	it("produces signed per-wallet deltas for non-issuance transfers", () => {
		const d = evaluateOperation(facts(alice, bob), {
			kind: "P2P_TRANSFER",
			fromWalletId: alice.id,
			toWalletId: bob.id,
			amount: 30,
		});
		expect(d.accepted).toBe(true);
		if (d.accepted) {
			expect(d.effect.deltas.get(alice.id)).toBe(-30);
			expect(d.effect.deltas.get(bob.id)).toBe(30);
			expect(d.effect.deltas.size).toBe(2);
		}
	});

	it("self-P2P cancels to an explicit zero delta", () => {
		const d = evaluateOperation(facts(alice, alice), {
			kind: "P2P_TRANSFER",
			fromWalletId: alice.id,
			toWalletId: alice.id,
			amount: 30,
		});
		expect(d.accepted).toBe(true);
		if (d.accepted) expect(d.effect.deltas.size).toBe(0);
	});

	it("issuance produces a single credit delta on the treasury", () => {
		const t0 = { ...treasury, balance: 0 };
		const d = evaluateOperation(facts(t0, t0, 0), {
			kind: "TOKEN_ISSUANCE",
			fromWalletId: TREASURY_WALLET_ID,
			toWalletId: TREASURY_WALLET_ID,
			amount: 50,
		});
		expect(d.accepted).toBe(true);
		if (d.accepted) {
			expect(d.effect.deltas.get(TREASURY_WALLET_ID)).toBe(50);
			expect(d.effect.deltas.size).toBe(1);
		}
	});

	it("carries no durable id or commit timestamp — those belong to the persistence boundary", () => {
		const d = evaluateOperation(facts(alice, bob), {
			kind: "P2P_TRANSFER",
			fromWalletId: alice.id,
			toWalletId: bob.id,
			amount: 1,
		});
		expect(d.accepted).toBe(true);
		if (d.accepted) {
			expect("id" in d.effect).toBe(false);
			expect("createdAt" in d.effect).toBe(false);
		}
	});

	it("rejects when facts were resolved against different wallet ids than the command names", () => {
		expect(() =>
			evaluateOperation(facts(alice, bob), {
				kind: "P2P_TRANSFER",
				fromWalletId: alice.id,
				toWalletId: "w-carol",
				amount: 1,
			}),
		).toThrow(/facts\/command mismatch/);
	});

	it("rejects amounts above the domain and supplies above the domain", () => {
		expect(
			evaluateOperation(facts(alice, bob), {
				kind: "P2P_TRANSFER",
				fromWalletId: alice.id,
				toWalletId: bob.id,
				amount: MAX_MONETARY_VALUE + 1,
			}),
		).toMatchObject({ accepted: false, code: "INVALID_AMOUNT" });

		expect(
			evaluateOperation(facts(treasury, treasury, MAX_MONETARY_VALUE), {
				kind: "TOKEN_ISSUANCE",
				fromWalletId: TREASURY_WALLET_ID,
				toWalletId: TREASURY_WALLET_ID,
				amount: 1,
			}),
		).toMatchObject({ accepted: false, code: "OVERFLOW" });
	});
});
