import { TREASURY_WALLET_ID } from "@communitytoken/economic-kernel";
import { describe, expect, it } from "vitest";
import { ADMIN, OTHER_SERVICE, SYSTEM, userActor } from "./fixtures";
import { createInMemoryFixture, fixedClock } from "./in-memory";

const M = Number.MAX_SAFE_INTEGER;

describe("issueToken", () => {
	it("a service actor issues supply into the treasury, stamping the actor on the operation", () => {
		const { app, state } = createInMemoryFixture({ clock: fixedClock(1234) });

		const r = app.issueToken(ADMIN, {
			amount: 100,
			metadata: "initial treasury funding",
		});

		expect(r).toEqual({
			ok: true,
			value: { operationId: expect.any(String) },
		});
		const treasury = state.wallets.get(TREASURY_WALLET_ID);
		expect(treasury?.balance).toBe(100);
		expect(treasury?.updatedAt).toBe(1234);

		expect(state.operationRows).toHaveLength(1);
		const op = state.operationRows[0]?.record;
		expect(op?.kind).toBe("TOKEN_ISSUANCE");
		expect(op?.actorKind).toBe("service");
		expect(op?.actorId).toBe("admin-api");
		expect(op?.metadata).toBe("initial treasury funding");
		expect(op?.createdAt).toBe(1234);

		expect(state.ledgerRows).toHaveLength(1);
		const entry = state.ledgerRows[0]?.record;
		expect(entry?.operationId).toBe(op?.id);
		expect(entry?.fromWalletId).toBe(TREASURY_WALLET_ID);
		expect(entry?.toWalletId).toBe(TREASURY_WALLET_ID);
		expect(entry?.amount).toBe(100);
		expect(entry?.createdAt).toBe(1234);
	});

	it("any service principal may issue — the route boundary, not the domain, binds the principal", () => {
		const { app } = createInMemoryFixture();
		const r = app.issueToken(OTHER_SERVICE, { amount: 5 });
		expect(r.ok).toBe(true);
	});

	it.each(["user", "system"] as const)(
		"rejects a %s actor as forbidden and persists nothing",
		(kind) => {
			const { app, state } = createInMemoryFixture();
			const actor = kind === "user" ? userActor("alice") : SYSTEM;

			const r = app.issueToken(actor, { amount: 100 });

			expect(r).toMatchObject({ ok: false, error: { type: "forbidden" } });
			expect(state.operationRows).toHaveLength(0);
			expect(state.ledgerRows).toHaveLength(0);
			expect(state.wallets.get(TREASURY_WALLET_ID)?.balance).toBe(0);
		},
	);

	it.each([0, -5, 1.5, Number.NaN, M + 1])(
		"rejects amount %s through the kernel and persists nothing",
		(amount) => {
			const { app, state } = createInMemoryFixture();

			const r = app.issueToken(ADMIN, { amount });

			expect(r).toMatchObject({
				ok: false,
				error: { type: "rejected", code: "INVALID_AMOUNT" },
			});
			expect(state.operationRows).toHaveLength(0);
			expect(state.ledgerRows).toHaveLength(0);
		},
	);

	it("rejects issuance that would push total supply above the domain", () => {
		const { app } = createInMemoryFixture();
		expect(app.issueToken(ADMIN, { amount: M }).ok).toBe(true);

		const r = app.issueToken(ADMIN, { amount: 1 });

		expect(r).toMatchObject({
			ok: false,
			error: { type: "rejected", code: "OVERFLOW" },
		});
	});

	it("stores absent metadata as null", () => {
		const { app, state } = createInMemoryFixture();
		app.issueToken(ADMIN, { amount: 10 });
		expect(state.operationRows[0]?.record.metadata).toBeNull();
	});
});
