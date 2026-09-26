import { describe, expect, it } from "vitest";
import { ADMIN_API_CALLER } from "../src/types";
import { getBalance } from "../src/use-cases/get-balance";
import { issueToIdentity } from "../src/use-cases/issue-to-identity";
import { createInMemoryFixture, TEST_ISSUER } from "./in-memory";

/** Self-only balance of the caller's default Account (actor-and-visibility specification). */
describe("getBalance", () => {
	it("reads the caller Principal's default Account balance", () => {
		const fx = createInMemoryFixture();
		const alice = fx.seedIdentity("alice");
		fx.uow.transact((ctx) =>
			issueToIdentity(ctx, ADMIN_API_CALLER, {
				target: alice.identity,
				amount: 25,
			}),
		);
		fx.seedAccount(alice.principalId, 7);

		const r = fx.uow.transact((ctx) => getBalance(ctx, alice.identity));

		expect(r).toEqual({ ok: true, value: { balance: 25 } });
	});

	it("reports an unbound caller identity", () => {
		const fx = createInMemoryFixture();

		const r = fx.uow.transact((ctx) =>
			getBalance(ctx, { issuer: TEST_ISSUER, subject: "ghost" }),
		);

		expect(r).toMatchObject({
			ok: false,
			error: { type: "unresolved", code: "IDENTITY_NOT_BOUND" },
		});
	});

	it("reports a bound Principal without a default Account", () => {
		const fx = createInMemoryFixture();
		const bare = fx.seedPrincipal();
		fx.bind(bare, "bare");

		const r = fx.uow.transact((ctx) =>
			getBalance(ctx, { issuer: TEST_ISSUER, subject: "bare" }),
		);

		expect(r).toMatchObject({
			ok: false,
			error: { code: "DEFAULT_ACCOUNT_NOT_DESIGNATED" },
		});
	});

	it("writes nothing", () => {
		const fx = createInMemoryFixture();
		const alice = fx.seedIdentity("alice");
		const snapshot = JSON.stringify([...fx.state.accounts]);

		fx.uow.transact((ctx) => getBalance(ctx, alice.identity));

		expect(JSON.stringify([...fx.state.accounts])).toBe(snapshot);
		expect(fx.state.transactionRows).toHaveLength(0);
	});
});
