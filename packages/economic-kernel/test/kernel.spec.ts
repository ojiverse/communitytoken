import { describe, expect, it } from "vitest";
import * as kernel from "../src/index";
import {
	type AccountFacts,
	evaluateIssue,
	evaluateTransfer,
	MAX_MONETARY_VALUE,
} from "../src/index";

/**
 * Unit tests for mechanics of the pure evaluator that the contract suite
 * cannot express: the delta map shape, the facts/command identity contract,
 * issuer provenance on the effect, role agnosticism, and the absence of
 * durable ids or timestamps on effects.
 */

const alice: AccountFacts = { id: "a-alice", balance: 100 };
const bob: AccountFacts = { id: "a-bob", balance: 0 };
const issuer = { id: "p-issuer" } as const;

describe("evaluateIssue mechanics", () => {
	it("produces a single credit delta and carries the issuer Principal", () => {
		const d = evaluateIssue(
			{ issuer, destination: bob, totalSupply: 100 },
			{
				issuerPrincipalId: issuer.id,
				destinationAccountId: bob.id,
				amount: 50,
			},
		);
		expect(d.accepted).toBe(true);
		if (d.accepted) {
			expect(d.effect).toMatchObject({
				kind: "ISSUE",
				issuerPrincipalId: issuer.id,
				destinationAccountId: bob.id,
				amount: 50,
			});
			expect([...d.effect.deltas]).toEqual([[bob.id, 50]]);
		}
	});

	it("validates in order: amount, issuer, destination", () => {
		expect(
			evaluateIssue(
				{ issuer: undefined, destination: undefined, totalSupply: 0 },
				{ issuerPrincipalId: "x", destinationAccountId: "y", amount: 0 },
			),
		).toMatchObject({ accepted: false, code: "INVALID_AMOUNT" });
		expect(
			evaluateIssue(
				{ issuer: undefined, destination: undefined, totalSupply: 0 },
				{ issuerPrincipalId: "x", destinationAccountId: "y", amount: 1 },
			),
		).toMatchObject({ accepted: false, code: "PRINCIPAL_NOT_FOUND" });
		expect(
			evaluateIssue(
				{ issuer, destination: undefined, totalSupply: 0 },
				{ issuerPrincipalId: issuer.id, destinationAccountId: "y", amount: 1 },
			),
		).toMatchObject({ accepted: false, code: "ACCOUNT_NOT_FOUND" });
	});

	it("rejects supply overflow independently of destination headroom", () => {
		expect(
			evaluateIssue(
				{ issuer, destination: bob, totalSupply: MAX_MONETARY_VALUE },
				{
					issuerPrincipalId: issuer.id,
					destinationAccountId: bob.id,
					amount: 1,
				},
			),
		).toMatchObject({ accepted: false, code: "OVERFLOW" });
	});

	it("throws when facts were resolved against different ids than the command names", () => {
		expect(() =>
			evaluateIssue(
				{ issuer, destination: bob, totalSupply: 0 },
				{
					issuerPrincipalId: "p-other",
					destinationAccountId: bob.id,
					amount: 1,
				},
			),
		).toThrow(/facts\/command mismatch/);
		expect(() =>
			evaluateIssue(
				{ issuer, destination: bob, totalSupply: 0 },
				{
					issuerPrincipalId: issuer.id,
					destinationAccountId: "a-other",
					amount: 1,
				},
			),
		).toThrow(/facts\/command mismatch/);
	});
});

describe("evaluateTransfer mechanics", () => {
	it("produces signed per-Account deltas and no issuer", () => {
		const d = evaluateTransfer(
			{ source: alice, destination: bob },
			{ sourceAccountId: alice.id, destinationAccountId: bob.id, amount: 30 },
		);
		expect(d.accepted).toBe(true);
		if (d.accepted) {
			expect(d.effect.kind).toBe("TRANSFER");
			expect("issuerPrincipalId" in d.effect).toBe(false);
			expect(d.effect.deltas.get(alice.id)).toBe(-30);
			expect(d.effect.deltas.get(bob.id)).toBe(30);
			expect(d.effect.deltas.size).toBe(2);
		}
	});

	it("a self-transfer cancels to no delta but is still an accepted effect", () => {
		const d = evaluateTransfer(
			{ source: alice, destination: alice },
			{ sourceAccountId: alice.id, destinationAccountId: alice.id, amount: 30 },
		);
		expect(d.accepted).toBe(true);
		if (d.accepted) expect(d.effect.deltas.size).toBe(0);
	});

	it("rejects a credit that would exceed the balance domain", () => {
		const rich: AccountFacts = { id: "a-rich", balance: MAX_MONETARY_VALUE };
		expect(
			evaluateTransfer(
				{ source: alice, destination: rich },
				{ sourceAccountId: alice.id, destinationAccountId: rich.id, amount: 1 },
			),
		).toMatchObject({ accepted: false, code: "OVERFLOW" });
	});

	it("throws when facts were resolved against different ids than the command names", () => {
		expect(() =>
			evaluateTransfer(
				{ source: alice, destination: bob },
				{
					sourceAccountId: alice.id,
					destinationAccountId: "a-carol",
					amount: 1,
				},
			),
		).toThrow(/facts\/command mismatch/);
	});
});

describe("primitive boundary", () => {
	it("effects carry no durable id or commit timestamp — those belong to persistence", () => {
		const d = evaluateTransfer(
			{ source: alice, destination: bob },
			{ sourceAccountId: alice.id, destinationAccountId: bob.id, amount: 1 },
		);
		expect(d.accepted).toBe(true);
		if (d.accepted) {
			expect("id" in d.effect).toBe(false);
			expect("committedAt" in d.effect).toBe(false);
		}
	});

	it("is role-agnostic: no Account kind, treasury, reserve, or direction rule is exported", () => {
		const exported = Object.keys(kernel).sort();
		expect(exported).toEqual([
			"MAX_MONETARY_VALUE",
			"evaluateIssue",
			"evaluateTransfer",
		]);
	});
});
