import { describe, expect, it } from "vitest";
import { TREASURY_SELECTOR, userId, userSelector } from "../src/types";
import { applyEconomicCommand } from "../src/use-cases/apply-economic-command";
import { ADMIN, SYSTEM, userActor } from "./fixtures";
import { createInMemoryFixture } from "./in-memory";

function walletOf(
	state: ReturnType<typeof createInMemoryFixture>["state"],
	rawUserId: string,
) {
	const owner = userId(rawUserId);
	for (const wallet of state.wallets.values()) {
		if (wallet.ownerUserId === owner) return wallet;
	}
	return undefined;
}

describe("applyEconomicCommand", () => {
	it("resolves selectors and persists the caller-supplied actor", () => {
		const fx = createInMemoryFixture();
		fx.seedUser("alice");

		const r = fx.uow.transact((ctx) =>
			applyEconomicCommand(ctx, ADMIN, {
				kind: "TOKEN_ISSUANCE",
				from: TREASURY_SELECTOR,
				to: TREASURY_SELECTOR,
				amount: 50,
			}),
		);
		expect(r).toEqual({
			ok: true,
			value: { operationId: expect.any(String) },
		});

		const op = fx.state.operationRows.at(-1)?.record;
		expect(op?.kind).toBe("TOKEN_ISSUANCE");
		expect(op?.actorKind).toBe("service");
		expect(op?.actorId).toBe("admin-api");
	});

	it("resolves a user selector to the owned wallet for the movement", () => {
		const fx = createInMemoryFixture();
		fx.seedUser("alice");
		fx.app.issueToken(ADMIN, { amount: 50 });

		const r = fx.uow.transact((ctx) =>
			applyEconomicCommand(ctx, ADMIN, {
				kind: "DISTRIBUTION",
				from: TREASURY_SELECTOR,
				to: userSelector(userId("alice")),
				amount: 30,
			}),
		);
		expect(r.ok).toBe(true);
		expect(walletOf(fx.state, "alice")?.balance).toBe(30);

		const entry = fx.state.ledgerRows.at(-1)?.record;
		expect(entry?.toWalletId).toBe(walletOf(fx.state, "alice")?.id);
	});

	it("rejects WALLET_NOT_FOUND when a user selector owns no wallet", () => {
		const fx = createInMemoryFixture();
		fx.app.issueToken(ADMIN, { amount: 10 });
		const ops = fx.state.operationRows.length;

		const r = fx.uow.transact((ctx) =>
			applyEconomicCommand(ctx, ADMIN, {
				kind: "DISTRIBUTION",
				from: TREASURY_SELECTOR,
				to: userSelector(userId("ghost")),
				amount: 5,
			}),
		);
		expect(r).toMatchObject({
			ok: false,
			error: { type: "rejected", code: "WALLET_NOT_FOUND" },
		});
		expect(fx.state.operationRows.length).toBe(ops);
	});

	it("performs no actor guard — the kernel decides acceptance", () => {
		const fx = createInMemoryFixture();
		fx.seedUser("alice");

		// A non-admin actor on an administrative kind still reaches the
		// evaluator: the command is valid, so it is accepted and the actor
		// is persisted verbatim — authorization is the caller's concern.
		const accepted = fx.uow.transact((ctx) =>
			applyEconomicCommand(ctx, userActor("alice"), {
				kind: "TOKEN_ISSUANCE",
				from: TREASURY_SELECTOR,
				to: TREASURY_SELECTOR,
				amount: 5,
			}),
		);
		expect(accepted.ok).toBe(true);
		const op = fx.state.operationRows.at(-1)?.record;
		expect(op?.actorKind).toBe("user");
		expect(op?.actorId).toBe("alice");

		// A deliberately invalid direction with no user source — the
		// harness's (system, null) fallback — is rejected by the kernel,
		// not by an actor check.
		const rejected = fx.uow.transact((ctx) =>
			applyEconomicCommand(ctx, SYSTEM, {
				kind: "P2P_TRANSFER",
				from: TREASURY_SELECTOR,
				to: userSelector(userId("alice")),
				amount: 1,
			}),
		);
		expect(rejected).toMatchObject({
			ok: false,
			error: { type: "rejected", code: "DIRECTION_VIOLATION" },
		});
	});
});
