import { describe, expect, it } from "vitest";
import { ADMIN_API_CALLER, type ExternalIdentity } from "../src/types";
import { issueToIdentity } from "../src/use-cases/issue-to-identity";
import { transferBetweenIdentities } from "../src/use-cases/transfer-between-identities";
import { createInMemoryFixture, TEST_ISSUER } from "./in-memory";

type Fixture = ReturnType<typeof createInMemoryFixture>;

function fund(fx: Fixture, target: ExternalIdentity, amount: number): void {
	const r = fx.uow.transact((ctx) =>
		issueToIdentity(ctx, ADMIN_API_CALLER, { target, amount }),
	);
	if (!r.ok) throw new Error(`funding failed: ${r.error.detail}`);
}

function transfer(
	fx: Fixture,
	from: ExternalIdentity,
	to: ExternalIdentity,
	amount: number,
) {
	return fx.uow.transact((ctx) =>
		transferBetweenIdentities(ctx, { from, to, amount }),
	);
}

/**
 * User TRANSFER: sender and recipient ExternalIdentities resolve to their
 * Principals' default Accounts and exactly one TRANSFER is recorded — no
 * ISSUE, no actor, no product reason.
 */
describe("transferBetweenIdentities", () => {
	it("resolves both default Accounts and records one TRANSFER", () => {
		const fx = createInMemoryFixture();
		const alice = fx.seedIdentity("alice");
		const bob = fx.seedIdentity("bob");
		fund(fx, alice.identity, 100);

		const r = transfer(fx, alice.identity, bob.identity, 30);

		expect(r.ok).toBe(true);
		expect(fx.balanceOf(alice.accountId)).toBe(70);
		expect(fx.balanceOf(bob.accountId)).toBe(30);
		const last = fx.state.transactionRows.at(-1)?.record;
		expect(last).toMatchObject({
			kind: "TRANSFER",
			issuerPrincipalId: null,
			sourceAccountId: alice.accountId,
			destinationAccountId: bob.accountId,
			amount: 30,
		});
		if (r.ok) {
			expect(r.value).toEqual({ transactionId: last?.id, fromBalance: 70 });
		}
	});

	it("preserves total supply and creates no ISSUE", () => {
		const fx = createInMemoryFixture();
		const alice = fx.seedIdentity("alice");
		const bob = fx.seedIdentity("bob");
		fund(fx, alice.identity, 50);
		const issuesBefore = fx.state.transactionRows.filter(
			({ record }) => record.kind === "ISSUE",
		).length;

		transfer(fx, alice.identity, bob.identity, 20);
		transfer(fx, bob.identity, alice.identity, 5);

		expect(fx.uow.transact((ctx) => ctx.accounts.totalSupply())).toBe(50);
		expect(
			fx.state.transactionRows.filter(({ record }) => record.kind === "ISSUE"),
		).toHaveLength(issuesBefore);
	});

	it("uses the default Account, not another Account of the same Principal", () => {
		const fx = createInMemoryFixture();
		const alice = fx.seedIdentity("alice");
		const bob = fx.seedIdentity("bob");
		const bobSecondary = fx.seedAccount(bob.principalId);
		fund(fx, alice.identity, 10);

		transfer(fx, alice.identity, bob.identity, 10);

		expect(fx.balanceOf(bob.accountId)).toBe(10);
		expect(fx.balanceOf(bobSecondary)).toBe(0);
	});

	it("a self-transfer records one Transaction and changes no balance", () => {
		const fx = createInMemoryFixture();
		const alice = fx.seedIdentity("alice");
		fund(fx, alice.identity, 100);
		const before = fx.state.transactionRows.length;

		const r = transfer(fx, alice.identity, alice.identity, 30);

		expect(r).toMatchObject({ ok: true, value: { fromBalance: 100 } });
		expect(fx.balanceOf(alice.accountId)).toBe(100);
		expect(fx.state.transactionRows).toHaveLength(before + 1);
	});

	it("rejects insufficient funds without any write", () => {
		const fx = createInMemoryFixture();
		const alice = fx.seedIdentity("alice");
		const bob = fx.seedIdentity("bob");
		fund(fx, alice.identity, 10);
		const before = fx.state.transactionRows.length;

		const r = transfer(fx, alice.identity, bob.identity, 11);

		expect(r).toMatchObject({
			ok: false,
			error: { type: "rejected", code: "INSUFFICIENT_BALANCE" },
		});
		expect(fx.balanceOf(alice.accountId)).toBe(10);
		expect(fx.balanceOf(bob.accountId)).toBe(0);
		expect(fx.state.transactionRows).toHaveLength(before);
	});

	it("distinguishes unbound sender and unbound recipient", () => {
		const fx = createInMemoryFixture();
		const alice = fx.seedIdentity("alice");
		const ghost = { issuer: TEST_ISSUER, subject: "ghost" };

		expect(transfer(fx, ghost, alice.identity, 1)).toMatchObject({
			ok: false,
			error: { type: "unresolved", code: "IDENTITY_NOT_BOUND" },
		});
		expect(transfer(fx, alice.identity, ghost, 1)).toMatchObject({
			ok: false,
			error: { type: "unresolved", code: "RECIPIENT_NOT_BOUND" },
		});
	});

	it("distinguishes a sender or recipient without a default Account", () => {
		const fx = createInMemoryFixture();
		const alice = fx.seedIdentity("alice");
		const bare = fx.seedPrincipal();
		fx.seedAccount(bare);
		fx.bind(bare, "bare");
		const bareIdentity = { issuer: TEST_ISSUER, subject: "bare" };

		expect(transfer(fx, bareIdentity, alice.identity, 1)).toMatchObject({
			ok: false,
			error: { code: "DEFAULT_ACCOUNT_NOT_DESIGNATED" },
		});
		expect(transfer(fx, alice.identity, bareIdentity, 1)).toMatchObject({
			ok: false,
			error: { code: "RECIPIENT_DEFAULT_ACCOUNT_NOT_DESIGNATED" },
		});
		expect(fx.state.transactionRows).toHaveLength(0);
	});

	it.each([0, -1, 1.5, Number.NaN])(
		"passes an INVALID_AMOUNT rejection through for %s",
		(amount) => {
			const fx = createInMemoryFixture();
			const alice = fx.seedIdentity("alice");
			const bob = fx.seedIdentity("bob");

			expect(transfer(fx, alice.identity, bob.identity, amount)).toMatchObject({
				ok: false,
				error: { code: "INVALID_AMOUNT" },
			});
		},
	);
});
