import { describe, expect, it } from "vitest";
import type {
	EconomicHarness,
	HarnessCommand,
	HarnessFactory,
	HarnessResult,
	TransactionView,
} from "./harness";

const M = Number.MAX_SAFE_INTEGER;

/** An id no conforming implementation allocates for a real Principal. */
const GHOST_PRINCIPAL = "ghost-principal";
/** An id no conforming implementation allocates for a real Account. */
const GHOST_ACCOUNT = "ghost-account";

function issue(
	h: EconomicHarness,
	issuerPrincipalId: string,
	destinationAccountId: string,
	amount: number,
): Promise<HarnessResult> {
	return h.apply({
		kind: "ISSUE",
		issuerPrincipalId,
		destinationAccountId,
		amount,
	});
}

function transfer(
	h: EconomicHarness,
	sourceAccountId: string,
	destinationAccountId: string,
	amount: number,
): Promise<HarnessResult> {
	return h.apply({
		kind: "TRANSFER",
		sourceAccountId,
		destinationAccountId,
		amount,
	});
}

/** A fresh Principal owning one Account — the common test subject. */
async function holder(
	h: EconomicHarness,
): Promise<{ readonly principal: string; readonly account: string }> {
	const principal = await h.createPrincipal();
	const account = await h.createAccount(principal);
	return { principal, account };
}

type Snapshot = {
	readonly balances: readonly number[];
	readonly supply: number;
	readonly issued: number;
	readonly transactions: readonly TransactionView[];
};

async function snapshot(
	h: EconomicHarness,
	accounts: readonly string[],
): Promise<Snapshot> {
	const balances: number[] = [];
	for (const account of accounts) balances.push(await h.balanceOf(account));
	return {
		balances,
		supply: await h.totalSupply(),
		issued: await h.issuedAmount(),
		transactions: await h.transactions(),
	};
}

function mulberry32(seed: number): () => number {
	let a = seed >>> 0;
	return () => {
		a |= 0;
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

function pick<T>(rng: () => number, xs: readonly T[]): T {
	const selected = xs[Math.floor(rng() * xs.length)];
	return (selected ?? xs[0]) as T;
}

function pickAmount(rng: () => number): number {
	if (rng() < 0.85) return 1 + Math.floor(rng() * 50);
	return pick(rng, [0, -5, 1.5, M, M + 1]);
}

function genCommand(
	rng: () => number,
	principals: readonly string[],
	accounts: readonly string[],
): HarnessCommand {
	const accountRefs = [...accounts, GHOST_ACCOUNT];
	if (rng() < 0.3) {
		return {
			kind: "ISSUE",
			issuerPrincipalId: pick(rng, [...principals, GHOST_PRINCIPAL]),
			destinationAccountId: pick(rng, accountRefs),
			amount: pickAmount(rng),
		};
	}
	return {
		kind: "TRANSFER",
		sourceAccountId: pick(rng, accountRefs),
		destinationAccountId: pick(rng, accountRefs),
		amount: pickAmount(rng),
	};
}

/**
 * Registers the storage-independent primitive ledger contract suite against
 * one implementation. Every case is derived from the economic-state and
 * economic-transitions specifications; call this once per EconomicHarness
 * adapter.
 */
export function defineEconomicContract(
	name: string,
	factory: HarnessFactory,
): void {
	describe(`primitive ledger contract [${name}]`, () => {
		describe("initial state", () => {
			it("an empty ledger has zero supply and no Transactions", async () => {
				const h = factory();
				await h.reset();
				expect(await h.totalSupply()).toBe(0);
				expect(await h.issuedAmount()).toBe(0);
				expect(await h.transactions()).toHaveLength(0);
			});

			it("creating Principals and Accounts creates no value and no Transaction", async () => {
				const h = factory();
				await h.reset();
				const alice = await h.createPrincipal();
				const first = await h.createAccount(alice);
				const second = await h.createAccount(alice);
				await h.createPrincipal();

				expect(first).not.toBe(second);
				expect(await h.balanceOf(first)).toBe(0);
				expect(await h.balanceOf(second)).toBe(0);
				expect(await h.totalSupply()).toBe(0);
				expect(await h.transactions()).toHaveLength(0);
			});

			it("rejects an Account for an unknown owner Principal", async () => {
				const h = factory();
				await h.reset();
				await expect(h.createAccount(GHOST_PRINCIPAL)).rejects.toThrow();
			});
		});

		describe("ISSUE", () => {
			it("credits the destination, grows supply by exactly amount, and persists the issuer Principal", async () => {
				const h = factory();
				await h.reset();
				const issuer = await h.createPrincipal();
				const { account } = await holder(h);

				const r = await issue(h, issuer, account, 100);

				expect(r.accepted).toBe(true);
				expect(await h.balanceOf(account)).toBe(100);
				expect(await h.totalSupply()).toBe(100);
				expect(await h.issuedAmount()).toBe(100);
				const [tx] = await h.transactions();
				expect(tx).toMatchObject({
					kind: "ISSUE",
					issuerPrincipalId: issuer,
					sourceAccountId: null,
					destinationAccountId: account,
					amount: 100,
				});
				if (r.accepted) expect(tx?.id).toBe(r.transactionId);
			});

			it("can target any existing Account — including one owned by the issuer or a second Account of a Principal", async () => {
				const h = factory();
				await h.reset();
				const issuer = await h.createPrincipal();
				const issuerOwn = await h.createAccount(issuer);
				const other = await h.createPrincipal();
				await h.createAccount(other);
				const otherSecond = await h.createAccount(other);

				expect((await issue(h, issuer, issuerOwn, 5)).accepted).toBe(true);
				expect((await issue(h, other, otherSecond, 7)).accepted).toBe(true);
				expect(await h.balanceOf(issuerOwn)).toBe(5);
				expect(await h.balanceOf(otherSecond)).toBe(7);
				expect(await h.totalSupply()).toBe(12);
			});

			it("rejects a missing issuer Principal without any write", async () => {
				const h = factory();
				await h.reset();
				const { account } = await holder(h);
				const before = await snapshot(h, [account]);

				const r = await issue(h, GHOST_PRINCIPAL, account, 10);

				expect(r).toEqual({ accepted: false, code: "PRINCIPAL_NOT_FOUND" });
				expect(await snapshot(h, [account])).toEqual(before);
			});

			it("rejects a missing destination Account without any write", async () => {
				const h = factory();
				await h.reset();
				const issuer = await h.createPrincipal();
				const before = await snapshot(h, []);

				const r = await issue(h, issuer, GHOST_ACCOUNT, 10);

				expect(r).toEqual({ accepted: false, code: "ACCOUNT_NOT_FOUND" });
				expect(await snapshot(h, [])).toEqual(before);
			});

			it("rejects a credit that would push the destination balance above the domain", async () => {
				const h = factory();
				await h.reset();
				const issuer = await h.createPrincipal();
				const account = await h.createAccount(issuer);
				await issue(h, issuer, account, M);

				const r = await issue(h, issuer, account, 1);

				expect(r).toEqual({ accepted: false, code: "OVERFLOW" });
				expect(await h.balanceOf(account)).toBe(M);
			});

			it("rejects issuance that would push total supply above the domain even when the destination has headroom", async () => {
				const h = factory();
				await h.reset();
				const issuer = await h.createPrincipal();
				const a = await h.createAccount(issuer);
				const b = await h.createAccount(issuer);
				await issue(h, issuer, a, M - 5);

				const r = await issue(h, issuer, b, 6);

				expect(r).toEqual({ accepted: false, code: "OVERFLOW" });
				expect(await h.totalSupply()).toBe(M - 5);
				expect(await h.balanceOf(b)).toBe(0);
			});

			it("accepts the upper amount boundary 2^53 - 1", async () => {
				const h = factory();
				await h.reset();
				const issuer = await h.createPrincipal();
				const account = await h.createAccount(issuer);
				expect((await issue(h, issuer, account, M)).accepted).toBe(true);
				expect(await h.totalSupply()).toBe(M);
			});
		});

		describe("TRANSFER", () => {
			it("Alice=100, Bob=0: Alice transfers 30 -> Alice=70, Bob=30, supply unchanged", async () => {
				const h = factory();
				await h.reset();
				const issuer = await h.createPrincipal();
				const alice = await holder(h);
				const bob = await holder(h);
				await issue(h, issuer, alice.account, 100);

				const r = await transfer(h, alice.account, bob.account, 30);

				expect(r.accepted).toBe(true);
				expect(await h.balanceOf(alice.account)).toBe(70);
				expect(await h.balanceOf(bob.account)).toBe(30);
				expect(await h.totalSupply()).toBe(100);
				expect(await h.issuedAmount()).toBe(100);
				const tx = (await h.transactions()).at(-1);
				expect(tx).toMatchObject({
					kind: "TRANSFER",
					issuerPrincipalId: null,
					sourceAccountId: alice.account,
					destinationAccountId: bob.account,
					amount: 30,
				});
				if (r.accepted) expect(tx?.id).toBe(r.transactionId);
			});

			it("arbitrary Principal-owned Accounts participate: two Accounts of one Principal", async () => {
				const h = factory();
				await h.reset();
				const owner = await h.createPrincipal();
				const first = await h.createAccount(owner);
				const second = await h.createAccount(owner);
				await issue(h, owner, first, 40);

				const r = await transfer(h, first, second, 15);

				expect(r.accepted).toBe(true);
				expect(await h.balanceOf(first)).toBe(25);
				expect(await h.balanceOf(second)).toBe(15);
				expect(await h.totalSupply()).toBe(40);
			});

			it("Alice=10: transferring 20 fails atomically — no Transaction, no balance mutation", async () => {
				const h = factory();
				await h.reset();
				const issuer = await h.createPrincipal();
				const alice = await holder(h);
				const bob = await holder(h);
				await issue(h, issuer, alice.account, 10);
				const before = await snapshot(h, [alice.account, bob.account]);

				const r = await transfer(h, alice.account, bob.account, 20);

				expect(r).toEqual({ accepted: false, code: "INSUFFICIENT_BALANCE" });
				expect(await snapshot(h, [alice.account, bob.account])).toEqual(before);
			});

			it("self-transfer records exactly one Transaction and changes no balance", async () => {
				const h = factory();
				await h.reset();
				const issuer = await h.createPrincipal();
				const alice = await holder(h);
				await issue(h, issuer, alice.account, 100);
				const txBefore = (await h.transactions()).length;

				const r = await transfer(h, alice.account, alice.account, 30);

				expect(r.accepted).toBe(true);
				expect(await h.balanceOf(alice.account)).toBe(100);
				expect(await h.totalSupply()).toBe(100);
				const after = await h.transactions();
				expect(after).toHaveLength(txBefore + 1);
				expect(after.at(-1)).toMatchObject({
					kind: "TRANSFER",
					sourceAccountId: alice.account,
					destinationAccountId: alice.account,
					amount: 30,
				});
			});

			it("self-transfer still requires the source to hold the amount", async () => {
				const h = factory();
				await h.reset();
				const alice = await holder(h);

				const r = await transfer(h, alice.account, alice.account, 1);

				expect(r).toEqual({ accepted: false, code: "INSUFFICIENT_BALANCE" });
				expect(await h.transactions()).toHaveLength(0);
			});

			it("rejects missing source or destination Accounts without any write", async () => {
				const h = factory();
				await h.reset();
				const issuer = await h.createPrincipal();
				const alice = await holder(h);
				await issue(h, issuer, alice.account, 10);
				const before = await snapshot(h, [alice.account]);

				expect(await transfer(h, alice.account, GHOST_ACCOUNT, 1)).toEqual({
					accepted: false,
					code: "ACCOUNT_NOT_FOUND",
				});
				expect(await transfer(h, GHOST_ACCOUNT, alice.account, 1)).toEqual({
					accepted: false,
					code: "ACCOUNT_NOT_FOUND",
				});
				expect(await snapshot(h, [alice.account])).toEqual(before);
			});
		});

		describe("invariant: token amounts are in range", () => {
			it.each([0, -5, 1.5, Number.NaN, M + 1])(
				"rejects amount %s for both kinds",
				async (amount) => {
					const h = factory();
					await h.reset();
					const issuer = await h.createPrincipal();
					const alice = await holder(h);
					const bob = await holder(h);

					expect(await issue(h, issuer, alice.account, amount)).toEqual({
						accepted: false,
						code: "INVALID_AMOUNT",
					});
					expect(await transfer(h, alice.account, bob.account, amount)).toEqual(
						{ accepted: false, code: "INVALID_AMOUNT" },
					);
					expect(await h.transactions()).toHaveLength(0);
				},
			);
		});

		describe("invariant: append-only Transaction history", () => {
			it("commits append entries without altering the existing prefix", async () => {
				const h = factory();
				await h.reset();
				const issuer = await h.createPrincipal();
				const alice = await holder(h);
				const bob = await holder(h);
				await issue(h, issuer, alice.account, 50);
				const before = await h.transactions();

				await transfer(h, alice.account, bob.account, 20);

				const after = await h.transactions();
				expect(after).toHaveLength(before.length + 1);
				expect(after.slice(0, before.length)).toEqual(before);
			});
		});

		describe("invariant: issued(S) = supply(S)", () => {
			it("holds after every accepted transition in a mixed sequence", async () => {
				const h = factory();
				await h.reset();
				const issuer = await h.createPrincipal();
				const alice = await holder(h);
				const bob = await holder(h);

				await issue(h, issuer, alice.account, 200);
				await transfer(h, alice.account, bob.account, 45);
				await issue(h, issuer, bob.account, 30);
				await transfer(h, bob.account, alice.account, 15);
				await transfer(h, alice.account, alice.account, 10);

				expect(await h.issuedAmount()).toBe(230);
				expect(await h.totalSupply()).toBe(230);
				expect(
					(await h.balanceOf(alice.account)) + (await h.balanceOf(bob.account)),
				).toBe(230);
			});
		});

		describe("generated sequences preserve every invariant", () => {
			it.each([1, 7, 42])(
				"I(S) holds at every step of seed %s's command sequence",
				async (seed) => {
					const h = factory();
					await h.reset();
					const principals = [
						await h.createPrincipal(),
						await h.createPrincipal(),
					];
					const accounts: string[] = [];
					for (const p of principals) {
						accounts.push(await h.createAccount(p));
						accounts.push(await h.createAccount(p));
					}
					const rng = mulberry32(seed);

					for (let step = 0; step < 120; step++) {
						const command = genCommand(rng, principals, accounts);
						const before = await snapshot(h, accounts);

						const r = await h.apply(command);

						const after = await snapshot(h, accounts);
						if (!r.accepted) {
							expect(after, `step ${step} rejected command`).toEqual(before);
							continue;
						}
						expect(after.issued, `step ${step}: issued == supply`).toBe(
							after.supply,
						);
						expect(after.supply).toBeLessThanOrEqual(M);
						let sum = 0;
						for (const b of after.balances) {
							expect(b).toBeGreaterThanOrEqual(0);
							expect(b).toBeLessThanOrEqual(M);
							sum += b;
						}
						expect(sum, `step ${step}: supply accounting`).toBe(after.supply);
						if (command.kind === "TRANSFER") {
							expect(after.supply, `step ${step}: TRANSFER keeps supply`).toBe(
								before.supply,
							);
						} else {
							expect(after.supply).toBe(before.supply + command.amount);
						}
						expect(after.transactions).toHaveLength(
							before.transactions.length + 1,
						);
						expect(
							after.transactions.slice(0, before.transactions.length),
							`step ${step}: history prefix preserved`,
						).toEqual(before.transactions);
					}
				},
			);
		});
	});
}
