import { describe, expect, it } from "vitest";
import {
	type EconomicHarness,
	type HarnessCommand,
	type HarnessFactory,
	type LedgerView,
	type OperationView,
	TREASURY_REF,
	userRef,
} from "./harness";

const M = Number.MAX_SAFE_INTEGER;

async function issue(h: EconomicHarness, amount: number, metadata?: string) {
	return h.apply({
		kind: "TOKEN_ISSUANCE",
		from: TREASURY_REF,
		to: TREASURY_REF,
		amount,
		...(metadata === undefined ? {} : { metadata }),
	});
}

async function distribute(
	h: EconomicHarness,
	to: string,
	amount: number,
	metadata?: string,
) {
	return h.apply({
		kind: "DISTRIBUTION",
		from: TREASURY_REF,
		to: userRef(to),
		amount,
		...(metadata === undefined ? {} : { metadata }),
	});
}

async function transfer(
	h: EconomicHarness,
	from: string,
	to: string,
	amount: number,
) {
	return h.apply({
		kind: "P2P_TRANSFER",
		from: userRef(from),
		to: userRef(to),
		amount,
	});
}

async function payTreasury(h: EconomicHarness, from: string, amount: number) {
	return h.apply({
		kind: "TREASURY_PAYMENT",
		from: userRef(from),
		to: TREASURY_REF,
		amount,
	});
}

type Snapshot = {
	readonly treasury: number;
	readonly supply: number;
	readonly issued: number;
	readonly operations: readonly OperationView[];
	readonly ledger: readonly LedgerView[];
};

async function snapshot(h: EconomicHarness): Promise<Snapshot> {
	return {
		treasury: await h.balanceOf(TREASURY_REF),
		supply: await h.totalSupply(),
		issued: await h.issuedAmount(),
		operations: await h.operations(),
		ledger: await h.ledger(),
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
	users: readonly string[],
): HarnessCommand {
	const refs = [...users.map(userRef), TREASURY_REF, userRef("ghost")];
	const r = rng();
	if (r < 0.18) {
		return {
			kind: "TOKEN_ISSUANCE",
			from: TREASURY_REF,
			to: pick(rng, [TREASURY_REF, TREASURY_REF, TREASURY_REF, ...refs]),
			amount: pickAmount(rng),
		};
	}
	if (r < 0.4) {
		return {
			kind: "DISTRIBUTION",
			from: TREASURY_REF,
			to: pick(rng, refs),
			amount: pickAmount(rng),
		};
	}
	if (r < 0.72) {
		return {
			kind: "P2P_TRANSFER",
			from: pick(rng, refs),
			to: pick(rng, refs),
			amount: pickAmount(rng),
		};
	}
	return {
		kind: "TREASURY_PAYMENT",
		from: pick(rng, refs),
		to: TREASURY_REF,
		amount: pickAmount(rng),
	};
}

/**
 * Registers the storage-independent economic contract suite against one
 * implementation. Every case is derived from the formal model of
 * docs/economic-model.md §4; call this once per EconomicHarness adapter.
 */
export function defineEconomicContract(
	name: string,
	factory: HarnessFactory,
): void {
	describe(`economic contract [${name}]`, () => {
		describe("issue #3 §4 migration-contract scenarios", () => {
			it("Alice=100, Bob=0: Alice transfers 30 -> Alice=70, Bob=30, supply unchanged", async () => {
				const h = factory();
				await h.reset();
				await h.createUser("alice");
				await h.createUser("bob");
				await issue(h, 100);
				await distribute(h, "alice", 100);
				const supplyBefore = await h.totalSupply();

				const r = await transfer(h, "alice", "bob", 30);

				expect(r.accepted).toBe(true);
				expect(await h.balanceOf(userRef("alice"))).toBe(70);
				expect(await h.balanceOf(userRef("bob"))).toBe(30);
				expect(await h.totalSupply()).toBe(supplyBefore);
			});

			it("treasury=0: issuing 100 raises treasury balance and total issuance by 100", async () => {
				const h = factory();
				await h.reset();
				expect(await h.balanceOf(TREASURY_REF)).toBe(0);

				const r = await issue(h, 100);

				expect(r.accepted).toBe(true);
				expect(await h.balanceOf(TREASURY_REF)).toBe(100);
				expect(await h.issuedAmount()).toBe(100);
				expect(await h.totalSupply()).toBe(100);
			});

			it("Alice=10: transferring 20 fails atomically, no ledger entry or balance mutation", async () => {
				const h = factory();
				await h.reset();
				await h.createUser("alice");
				await h.createUser("bob");
				await issue(h, 10);
				await distribute(h, "alice", 10);
				const before = await snapshot(h);

				const r = await transfer(h, "alice", "bob", 20);

				expect(r).toMatchObject({
					accepted: false,
					code: "INSUFFICIENT_BALANCE",
				});
				expect(await snapshot(h)).toEqual(before);
			});
		});

		describe("initial-state invariants", () => {
			it("a fresh community holds the treasury, no users, empty history", async () => {
				const h = factory();
				await h.reset();
				expect(await h.balanceOf(TREASURY_REF)).toBe(0);
				expect(await h.totalSupply()).toBe(0);
				expect(await h.issuedAmount()).toBe(0);
				expect(await h.operations()).toHaveLength(0);
				expect(await h.ledger()).toHaveLength(0);
			});
		});

		describe("invariant: unique treasury and one wallet per user", () => {
			it("registers one wallet per user and rejects duplicate users", async () => {
				const h = factory();
				await h.reset();
				await h.createUser("alice");
				expect(await h.balanceOf(userRef("alice"))).toBe(0);
				await expect(h.createUser("alice")).rejects.toThrow();
			});

			it("an opaque user id spelled like the treasury sentinel does not collide", async () => {
				const h = factory();
				await h.reset();
				await h.createUser("treasury");
				await issue(h, 100);
				await distribute(h, "treasury", 40);

				expect(await h.balanceOf(userRef("treasury"))).toBe(40);
				expect(await h.balanceOf(TREASURY_REF)).toBe(60);
				expect(await h.totalSupply()).toBe(100);
			});
		});

		describe("invariant: token amounts are in range (TokenAmount)", () => {
			it.each([0, -5, 1.5, Number.NaN, M + 1])(
				"rejects amount %s",
				async (amount) => {
					const h = factory();
					await h.reset();
					await h.createUser("alice");
					await h.createUser("bob");
					const r = await transfer(h, "alice", "bob", amount);
					expect(r).toMatchObject({
						accepted: false,
						code: "INVALID_AMOUNT",
					});
				},
			);

			it("accepts the upper boundary 2^53 - 1", async () => {
				const h = factory();
				await h.reset();
				const r = await issue(h, M);
				expect(r.accepted).toBe(true);
				expect(await h.totalSupply()).toBe(M);
			});
		});

		describe("invariant: balances and supply stay in range (WalletBalance / TotalSupply)", () => {
			it("rejects a credit that would push the destination balance above the domain", async () => {
				const h = factory();
				await h.reset();
				await issue(h, M);
				const r = await issue(h, 1);
				expect(r).toMatchObject({ accepted: false, code: "OVERFLOW" });
				expect(await h.balanceOf(TREASURY_REF)).toBe(M);
			});

			it("rejects issuance that would push total supply above the domain even when the treasury has headroom", async () => {
				const h = factory();
				await h.reset();
				await h.createUser("alice");
				await issue(h, M);
				await distribute(h, "alice", 5);

				const r = await issue(h, 1);

				expect(r).toMatchObject({ accepted: false, code: "OVERFLOW" });
				expect(await h.totalSupply()).toBe(M);
			});
		});

		describe("invariant: direction discipline", () => {
			it("rejects every kind used with a wallet-kind direction other than its own", async () => {
				const h = factory();
				await h.reset();
				await h.createUser("alice");
				await h.createUser("bob");

				const cases: readonly [string, HarnessCommand][] = [
					[
						"issuance must be a self-transfer on the treasury",
						{
							kind: "TOKEN_ISSUANCE",
							from: TREASURY_REF,
							to: userRef("alice"),
							amount: 1,
						},
					],
					[
						"issuance cannot self-transfer a user wallet",
						{
							kind: "TOKEN_ISSUANCE",
							from: userRef("alice"),
							to: userRef("alice"),
							amount: 1,
						},
					],
					[
						"distribution must be system -> user",
						{
							kind: "DISTRIBUTION",
							from: userRef("alice"),
							to: userRef("bob"),
							amount: 1,
						},
					],
					[
						"distribution cannot target the treasury",
						{
							kind: "DISTRIBUTION",
							from: TREASURY_REF,
							to: TREASURY_REF,
							amount: 1,
						},
					],
					[
						"p2p must be user -> user",
						{
							kind: "P2P_TRANSFER",
							from: TREASURY_REF,
							to: userRef("alice"),
							amount: 1,
						},
					],
					[
						"treasury payment must be user -> system",
						{
							kind: "TREASURY_PAYMENT",
							from: TREASURY_REF,
							to: TREASURY_REF,
							amount: 1,
						},
					],
				];

				for (const [name, command] of cases) {
					expect(await h.apply(command), name).toMatchObject({
						accepted: false,
						code: "DIRECTION_VIOLATION",
					});
				}
			});
		});

		describe("invariant: rejection is the identity transition", () => {
			it("a rejected operation leaves all observable state untouched", async () => {
				const h = factory();
				await h.reset();
				await h.createUser("alice");
				await h.createUser("bob");
				const before = await snapshot(h);

				const r = await transfer(h, "alice", "bob", 10);

				expect(r).toMatchObject({
					accepted: false,
					code: "INSUFFICIENT_BALANCE",
				});
				expect(await snapshot(h)).toEqual(before);
			});

			it("references to wallets that do not exist are rejected", async () => {
				const h = factory();
				await h.reset();
				await h.createUser("alice");
				const before = await snapshot(h);

				const r = await transfer(h, "alice", "ghost", 1);

				expect(r).toMatchObject({
					accepted: false,
					code: "WALLET_NOT_FOUND",
				});
				expect(await snapshot(h)).toEqual(before);
			});
		});

		describe("invariant: supply delta per kind", () => {
			it("TOKEN_ISSUANCE grows supply by exactly amount", async () => {
				const h = factory();
				await h.reset();
				await issue(h, 40);
				const r = await issue(h, 60);
				expect(r.accepted).toBe(true);
				expect(await h.totalSupply()).toBe(100);
				expect(await h.issuedAmount()).toBe(100);
			});

			it("DISTRIBUTION preserves total supply exactly", async () => {
				const h = factory();
				await h.reset();
				await h.createUser("alice");
				await issue(h, 80);
				const r = await distribute(h, "alice", 30);
				expect(r.accepted).toBe(true);
				expect(await h.totalSupply()).toBe(80);
			});

			it("P2P_TRANSFER preserves total supply exactly", async () => {
				const h = factory();
				await h.reset();
				await h.createUser("alice");
				await h.createUser("bob");
				await issue(h, 50);
				await distribute(h, "alice", 50);
				const r = await transfer(h, "alice", "bob", 20);
				expect(r.accepted).toBe(true);
				expect(await h.totalSupply()).toBe(50);
			});

			it("TREASURY_PAYMENT preserves total supply exactly", async () => {
				const h = factory();
				await h.reset();
				await h.createUser("alice");
				await issue(h, 50);
				await distribute(h, "alice", 50);
				const r = await payTreasury(h, "alice", 15);
				expect(r.accepted).toBe(true);
				expect(await h.totalSupply()).toBe(50);
				expect(await h.balanceOf(TREASURY_REF)).toBe(15);
			});

			it("self-P2P is a valid net-zero transfer: balances and supply unchanged, movement recorded", async () => {
				const h = factory();
				await h.reset();
				await h.createUser("alice");
				await issue(h, 100);
				await distribute(h, "alice", 100);
				const opsBefore = (await h.operations()).length;
				const ledgerBefore = (await h.ledger()).length;

				const r = await transfer(h, "alice", "alice", 30);

				expect(r.accepted).toBe(true);
				expect(await h.balanceOf(userRef("alice"))).toBe(100);
				expect(await h.totalSupply()).toBe(100);
				expect((await h.operations()).length).toBe(opsBefore + 1);
				expect((await h.ledger()).length).toBe(ledgerBefore + 1);
				const entry = (await h.ledger()).at(-1);
				expect(entry?.fromWalletId).toBe(entry?.toWalletId);
				expect(entry?.amount).toBe(30);
			});
		});

		describe("invariant: append-only operation and ledger history", () => {
			it("commits append entries without altering the existing prefix", async () => {
				const h = factory();
				await h.reset();
				await h.createUser("alice");
				await issue(h, 50);
				const opsBefore = await h.operations();
				const ledgerBefore = await h.ledger();

				await distribute(h, "alice", 20, "welcome bonus");

				const opsAfter = await h.operations();
				const ledgerAfter = await h.ledger();
				expect(opsAfter).toHaveLength(opsBefore.length + 1);
				expect(ledgerAfter).toHaveLength(ledgerBefore.length + 1);
				expect(opsAfter.slice(0, opsBefore.length)).toEqual(opsBefore);
				expect(ledgerAfter.slice(0, ledgerBefore.length)).toEqual(ledgerBefore);
				const operation = opsAfter.at(-1);
				const entry = ledgerAfter.at(-1);
				expect(operation?.kind).toBe("DISTRIBUTION");
				expect(operation?.metadata).toBe("welcome bonus");
				expect(entry?.operationId).toBe(operation?.id);
				expect(entry?.fromWalletId).not.toBe(entry?.toWalletId);
			});
		});

		describe("invariant: issued(S) = supply(S)", () => {
			it("holds after every accepted transition in a mixed sequence", async () => {
				const h = factory();
				await h.reset();
				await h.createUser("alice");
				await h.createUser("bob");

				await issue(h, 200);
				await distribute(h, "alice", 120);
				await transfer(h, "alice", "bob", 45);
				await payTreasury(h, "bob", 15);
				await issue(h, 30);
				await transfer(h, "alice", "alice", 10);

				expect(await h.issuedAmount()).toBe(230);
				expect(await h.totalSupply()).toBe(230);
				const sum =
					(await h.balanceOf(TREASURY_REF)) +
					(await h.balanceOf(userRef("alice"))) +
					(await h.balanceOf(userRef("bob")));
				expect(sum).toBe(230);
			});
		});

		describe("generated sequences preserve every invariant", () => {
			it.each([1, 7, 42])(
				"I(S) holds at every step of seed %s's operation sequence",
				async (seed) => {
					const h = factory();
					await h.reset();
					const users = ["alice", "bob", "carol"];
					for (const u of users) await h.createUser(u);
					const rng = mulberry32(seed);

					for (let step = 0; step < 120; step++) {
						const command = genCommand(rng, users);
						const before = await snapshot(h);

						const r = await h.apply(command);

						if (!r.accepted) {
							expect(await snapshot(h), `step ${step} rejected op`).toEqual(
								before,
							);
							continue;
						}

						const after = await snapshot(h);
						expect(after.issued, `step ${step}: issued == supply`).toBe(
							after.supply,
						);
						expect(
							after.supply,
							`step ${step}: supply <= M`,
						).toBeLessThanOrEqual(M);
						let balanceSum = after.treasury;
						expect(after.treasury).toBeGreaterThanOrEqual(0);
						for (const u of users) {
							const b = await h.balanceOf(userRef(u));
							expect(
								b,
								`step ${step}: ${u} balance in domain`,
							).toBeGreaterThanOrEqual(0);
							expect(b).toBeLessThanOrEqual(M);
							balanceSum += b;
						}
						expect(balanceSum, `step ${step}: supply accounting`).toBe(
							after.supply,
						);
						expect(after.ledger.length).toBe(before.ledger.length + 1);
						expect(after.operations.length).toBe(before.operations.length + 1);
						expect(
							after.ledger.slice(0, before.ledger.length),
							`step ${step}: ledger prefix preserved`,
						).toEqual(before.ledger);
						expect(
							after.operations.slice(0, before.operations.length),
							`step ${step}: operations prefix preserved`,
						).toEqual(before.operations);
					}
				},
			);
		});
	});
}
