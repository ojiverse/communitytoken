import { describe, expect, it } from "vitest";
import { ADMIN_API_CALLER, type ExternalIdentity } from "../src/types";
import { getTransactionHistory } from "../src/use-cases/get-transaction-history";
import { issueToIdentity } from "../src/use-cases/issue-to-identity";
import { executeTransfer } from "../src/use-cases/ledger";
import { transferBetweenIdentities } from "../src/use-cases/transfer-between-identities";
import { createInMemoryFixture, TEST_ISSUER } from "./in-memory";

type Fixture = ReturnType<typeof createInMemoryFixture>;

function fund(fx: Fixture, target: ExternalIdentity, amount: number): void {
	const r = fx.uow.transact((ctx) =>
		issueToIdentity(ctx, ADMIN_API_CALLER, { target, amount }),
	);
	if (!r.ok) throw new Error(`funding failed: ${r.error.detail}`);
}

function send(
	fx: Fixture,
	from: ExternalIdentity,
	to: ExternalIdentity,
	amount: number,
): void {
	const r = fx.uow.transact((ctx) =>
		transferBetweenIdentities(ctx, { from, to, amount }),
	);
	if (!r.ok) throw new Error(`transfer failed: ${r.error.detail}`);
}

function history(
	fx: Fixture,
	caller: ExternalIdentity,
	request: { cursor?: string | null; limit?: number } = {},
) {
	return fx.uow.transact((ctx) => getTransactionHistory(ctx, caller, request));
}

function entriesOf(r: ReturnType<typeof history>) {
	if (!r.ok) throw new Error(`history failed: ${r.error.detail}`);
	return r.value.entries;
}

/**
 * Self-history over the caller's default Account with the
 * actor-and-visibility counterparty projection: ISSUE has none; TRANSFER
 * exposes the other Principal's unique same-issuer ExternalIdentity; zero
 * or several bindings expose none; self-transfer exposes the caller.
 */
describe("getTransactionHistory", () => {
	it("returns primitive facts newest-first with direction relative to the viewed Account", () => {
		const fx = createInMemoryFixture({ clock: { nowMs: () => 5 } });
		const alice = fx.seedIdentity("alice");
		const bob = fx.seedIdentity("bob");
		fund(fx, alice.identity, 100);
		send(fx, alice.identity, bob.identity, 30);
		send(fx, bob.identity, alice.identity, 10);

		const entries = entriesOf(history(fx, alice.identity));

		expect(entries.map((e) => [e.kind, e.direction, e.amount])).toEqual([
			["TRANSFER", "in", 10],
			["TRANSFER", "out", 30],
			["ISSUE", "in", 100],
		]);
		const ids = fx.state.transactionRows.map(({ record }) => record.id);
		expect(entries.map((e) => e.transactionId)).toEqual([...ids].reverse());
		expect(entries.every((e) => e.committedAt === 5)).toBe(true);
	});

	it("ISSUE has no counterparty; TRANSFER exposes the unique same-issuer identity", () => {
		const fx = createInMemoryFixture();
		const alice = fx.seedIdentity("alice");
		const bob = fx.seedIdentity("bob");
		fund(fx, alice.identity, 100);
		send(fx, alice.identity, bob.identity, 30);

		const [transfer, issue] = entriesOf(history(fx, alice.identity));

		expect(issue?.counterparty).toBeNull();
		expect(transfer?.counterparty).toEqual(bob.identity);
		const [incoming] = entriesOf(history(fx, bob.identity));
		expect(incoming?.counterparty).toEqual(alice.identity);
	});

	it("exposes no counterparty when the other Principal has several bindings under the caller's issuer", () => {
		const fx = createInMemoryFixture();
		const alice = fx.seedIdentity("alice");
		const bob = fx.seedIdentity("bob");
		fx.bind(bob.principalId, "bob-alt");
		fund(fx, alice.identity, 10);
		send(fx, alice.identity, bob.identity, 3);

		const [transfer] = entriesOf(history(fx, alice.identity));

		expect(transfer?.counterparty).toBeNull();
	});

	it("exposes no counterparty when the other Principal has no binding under the caller's issuer", () => {
		const fx = createInMemoryFixture();
		const alice = fx.seedIdentity("alice");
		const foreign = fx.seedIdentity("bob", "https://other-issuer.test");
		fund(fx, alice.identity, 10);
		send(fx, alice.identity, foreign.identity, 3);

		const [transfer] = entriesOf(history(fx, alice.identity));

		expect(transfer?.counterparty).toBeNull();
	});

	it("uses the one same-issuer binding even when the other Principal has bindings under other issuers", () => {
		const fx = createInMemoryFixture();
		const alice = fx.seedIdentity("alice");
		const bob = fx.seedIdentity("bob");
		fx.bind(bob.principalId, "bob-elsewhere", "https://other-issuer.test");
		fund(fx, alice.identity, 10);
		send(fx, alice.identity, bob.identity, 3);

		const [transfer] = entriesOf(history(fx, alice.identity));

		expect(transfer?.counterparty).toEqual(bob.identity);
	});

	it("a self-transfer appears once with direction self and the caller's exact identity", () => {
		const fx = createInMemoryFixture();
		const alice = fx.seedIdentity("alice");
		// A second same-issuer binding must not make the self counterparty ambiguous.
		fx.bind(alice.principalId, "alice-alt");
		fund(fx, alice.identity, 10);
		send(fx, alice.identity, alice.identity, 4);

		const entries = entriesOf(history(fx, alice.identity));

		expect(entries).toHaveLength(2);
		expect(entries[0]).toMatchObject({
			kind: "TRANSFER",
			direction: "self",
			amount: 4,
			counterparty: alice.identity,
		});
		const alt = { issuer: TEST_ISSUER, subject: "alice-alt" };
		expect(entriesOf(history(fx, alt))[0]?.counterparty).toEqual(alt);
	});

	it("never exposes internal Principal or Account identifiers", () => {
		const fx = createInMemoryFixture();
		const alice = fx.seedIdentity("alice");
		const bob = fx.seedIdentity("bob");
		fund(fx, alice.identity, 10);
		send(fx, alice.identity, bob.identity, 3);
		send(fx, alice.identity, alice.identity, 1);

		const entries = entriesOf(history(fx, alice.identity));
		const serialized = JSON.stringify(entries);

		for (const internal of [
			alice.principalId,
			alice.accountId,
			bob.principalId,
			bob.accountId,
			fx.adminIssuer,
		]) {
			expect(serialized).not.toContain(internal);
		}
		for (const entry of entries) {
			expect(Object.keys(entry).sort()).toEqual([
				"amount",
				"committedAt",
				"counterparty",
				"direction",
				"kind",
				"transactionId",
			]);
		}
	});

	it("shows only Transactions touching the caller's default Account", () => {
		const fx = createInMemoryFixture();
		const alice = fx.seedIdentity("alice");
		const bob = fx.seedIdentity("bob");
		const carol = fx.seedIdentity("carol");
		const aliceSecondary = fx.seedAccount(alice.principalId);
		fund(fx, bob.identity, 10);
		send(fx, bob.identity, carol.identity, 5);
		fx.uow.transact((ctx) =>
			executeTransfer(ctx, {
				sourceAccountId: bob.accountId,
				destinationAccountId: aliceSecondary,
				amount: 1,
			}),
		);

		expect(entriesOf(history(fx, alice.identity))).toEqual([]);
	});

	it("reports unbound callers and callers without a default Account", () => {
		const fx = createInMemoryFixture();
		const bare = fx.seedPrincipal();
		fx.bind(bare, "bare");

		expect(
			history(fx, { issuer: TEST_ISSUER, subject: "ghost" }),
		).toMatchObject({
			ok: false,
			error: { type: "unresolved", code: "IDENTITY_NOT_BOUND" },
		});
		expect(history(fx, { issuer: TEST_ISSUER, subject: "bare" })).toMatchObject(
			{ ok: false, error: { code: "DEFAULT_ACCOUNT_NOT_DESIGNATED" } },
		);
	});

	it("paginates newest-first: default page 50, opaque cursor walks the rest", () => {
		const fx = createInMemoryFixture();
		const alice = fx.seedIdentity("alice");
		for (let i = 0; i < 60; i++) fund(fx, alice.identity, 1);

		const first = history(fx, alice.identity);
		expect(first.ok).toBe(true);
		if (!first.ok) return;
		expect(first.value.entries).toHaveLength(50);
		expect(first.value.nextCursor).not.toBeNull();

		const second = history(fx, alice.identity, {
			cursor: first.value.nextCursor,
		});
		expect(second.ok).toBe(true);
		if (!second.ok) return;
		expect(second.value.entries).toHaveLength(10);
		expect(second.value.nextCursor).toBeNull();

		const all = [...first.value.entries, ...second.value.entries];
		expect(new Set(all.map((e) => e.transactionId)).size).toBe(60);
		const committed = all.map((e) => e.committedAt);
		expect([...committed].sort((a, b) => b - a)).toEqual(committed);
	});

	it.each([0, -1, 1.5, Number.NaN, 101, 200])(
		"rejects an out-of-contract page limit %s as invalid-input",
		(limit) => {
			const fx = createInMemoryFixture();
			const alice = fx.seedIdentity("alice");

			expect(history(fx, alice.identity, { limit })).toMatchObject({
				ok: false,
				error: { type: "invalid-input", code: "INVALID_LIMIT" },
			});
		},
	);

	it("honors the boundary page sizes 1 and 100", () => {
		const fx = createInMemoryFixture();
		const alice = fx.seedIdentity("alice");
		for (let i = 0; i < 101; i++) fund(fx, alice.identity, 1);

		const full = history(fx, alice.identity, { limit: 100 });
		expect(full.ok && full.value.entries.length).toBe(100);
		expect(full.ok && full.value.nextCursor).not.toBeNull();
		const single = history(fx, alice.identity, { limit: 1 });
		expect(single.ok && single.value.entries.length).toBe(1);
	});
});
