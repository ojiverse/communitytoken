import { describe, expect, it } from "vitest";
import { ADMIN_API_CALLER, type AdministrativeCaller } from "../src/types";
import { issueToIdentity } from "../src/use-cases/issue-to-identity";
import { createInMemoryFixture, TEST_ISSUER } from "./in-memory";

const M = Number.MAX_SAFE_INTEGER;

/**
 * Administrative ISSUE (authentication/delegation specification): the
 * authenticated admin caller maps to the stable administrative issuer
 * Principal, the target ExternalIdentity resolves to its Principal's
 * default Account, and exactly one ISSUE is recorded with that issuer.
 */
describe("issueToIdentity", () => {
	it("issues into the target Principal's default Account with the admin issuer Principal", () => {
		const fx = createInMemoryFixture();
		const alice = fx.seedIdentity("alice");
		// A second Account of the same Principal must not receive the ISSUE.
		const secondary = fx.seedAccount(alice.principalId);

		const r = fx.uow.transact((ctx) =>
			issueToIdentity(ctx, ADMIN_API_CALLER, {
				target: alice.identity,
				amount: 40,
			}),
		);

		expect(r.ok).toBe(true);
		expect(fx.balanceOf(alice.accountId)).toBe(40);
		expect(fx.balanceOf(secondary)).toBe(0);
		expect(fx.state.transactionRows).toHaveLength(1);
		const [row] = fx.state.transactionRows;
		expect(row?.record).toMatchObject({
			kind: "ISSUE",
			issuerPrincipalId: fx.adminIssuer,
			sourceAccountId: null,
			destinationAccountId: alice.accountId,
			amount: 40,
		});
		if (r.ok) expect(r.value.transactionId).toBe(row?.record.id);
	});

	it("always records the mapped admin issuer, never the target or another Principal", () => {
		const fx = createInMemoryFixture();
		const alice = fx.seedIdentity("alice");
		const bob = fx.seedIdentity("bob");

		for (const target of [alice, bob, alice]) {
			fx.uow.transact((ctx) =>
				issueToIdentity(ctx, ADMIN_API_CALLER, {
					target: target.identity,
					amount: 1,
				}),
			);
		}

		expect(
			fx.state.transactionRows.map(({ record }) => record.issuerPrincipalId),
		).toEqual([fx.adminIssuer, fx.adminIssuer, fx.adminIssuer]);
	});

	it("reports an unbound target without writing", () => {
		const fx = createInMemoryFixture();

		const r = fx.uow.transact((ctx) =>
			issueToIdentity(ctx, ADMIN_API_CALLER, {
				target: { issuer: TEST_ISSUER, subject: "nobody" },
				amount: 1,
			}),
		);

		expect(r).toMatchObject({
			ok: false,
			error: { type: "unresolved", code: "IDENTITY_NOT_BOUND" },
		});
		expect(fx.state.transactionRows).toHaveLength(0);
	});

	it("does not fall back to the exact subject under a different issuer", () => {
		const fx = createInMemoryFixture();
		fx.seedIdentity("alice", "https://other-issuer.test");

		const r = fx.uow.transact((ctx) =>
			issueToIdentity(ctx, ADMIN_API_CALLER, {
				target: { issuer: TEST_ISSUER, subject: "alice" },
				amount: 1,
			}),
		);

		expect(r).toMatchObject({
			ok: false,
			error: { code: "IDENTITY_NOT_BOUND" },
		});
	});

	it("reports a bound Principal without a default Account designation", () => {
		const fx = createInMemoryFixture();
		const principal = fx.seedPrincipal();
		fx.seedAccount(principal);
		fx.bind(principal, "carol");

		const r = fx.uow.transact((ctx) =>
			issueToIdentity(ctx, ADMIN_API_CALLER, {
				target: { issuer: TEST_ISSUER, subject: "carol" },
				amount: 1,
			}),
		);

		expect(r).toMatchObject({
			ok: false,
			error: { type: "unresolved", code: "DEFAULT_ACCOUNT_NOT_DESIGNATED" },
		});
		expect(fx.state.transactionRows).toHaveLength(0);
	});

	it.each(["discord-adapter", "user", ""])(
		"forbids a non-admin technical caller %j at runtime without writing",
		(caller) => {
			const fx = createInMemoryFixture();
			const alice = fx.seedIdentity("alice");

			const r = fx.uow.transact((ctx) =>
				issueToIdentity(ctx, caller as AdministrativeCaller, {
					target: alice.identity,
					amount: 1,
				}),
			);

			expect(r).toMatchObject({ ok: false, error: { type: "forbidden" } });
			expect(fx.state.transactionRows).toHaveLength(0);
			expect(fx.balanceOf(alice.accountId)).toBe(0);
		},
	);

	it("fails loudly when the administrative issuer Principal was never initialized", () => {
		const fx = createInMemoryFixture();
		fx.state.administrativeIssuer = null;
		const alice = fx.seedIdentity("alice");

		expect(() =>
			fx.uow.transact((ctx) =>
				issueToIdentity(ctx, ADMIN_API_CALLER, {
					target: alice.identity,
					amount: 1,
				}),
			),
		).toThrow(/administrative issuer/);
		expect(fx.state.transactionRows).toHaveLength(0);
	});

	it.each([0, -5, 1.5, Number.NaN, M + 1])(
		"passes a kernel INVALID_AMOUNT rejection through for %s",
		(amount) => {
			const fx = createInMemoryFixture();
			const alice = fx.seedIdentity("alice");

			const r = fx.uow.transact((ctx) =>
				issueToIdentity(ctx, ADMIN_API_CALLER, {
					target: alice.identity,
					amount,
				}),
			);

			expect(r).toMatchObject({
				ok: false,
				error: { type: "rejected", code: "INVALID_AMOUNT" },
			});
			expect(fx.state.transactionRows).toHaveLength(0);
		},
	);

	it("rejects issuance that would overflow total supply", () => {
		const fx = createInMemoryFixture();
		const alice = fx.seedIdentity("alice");
		fx.uow.transact((ctx) =>
			issueToIdentity(ctx, ADMIN_API_CALLER, {
				target: alice.identity,
				amount: M,
			}),
		);

		const r = fx.uow.transact((ctx) =>
			issueToIdentity(ctx, ADMIN_API_CALLER, {
				target: alice.identity,
				amount: 1,
			}),
		);

		expect(r).toMatchObject({ ok: false, error: { code: "OVERFLOW" } });
		expect(fx.state.transactionRows).toHaveLength(1);
	});
});
