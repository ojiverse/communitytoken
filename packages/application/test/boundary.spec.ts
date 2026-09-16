import { TREASURY_WALLET_ID } from "@communitytoken/economic-kernel";
import { describe, expect, it } from "vitest";
import { ADMIN, userActor } from "./fixtures";
import {
	createInMemoryFixture,
	createInMemoryState,
	createInMemoryUnitOfWork,
} from "./in-memory";

describe("atomic boundary invariant", () => {
	it("rejects promise-returning work inside a section", () => {
		const uow = createInMemoryUnitOfWork(createInMemoryState());

		expect(() =>
			uow.transact((() => Promise.resolve(1) as unknown) as () => number),
		).toThrow(/synchronous/);
	});

	it("samples the clock exactly once per mutation and reuses it for every timestamp", () => {
		let calls = 0;
		const { app, state, seedUser } = createInMemoryFixture({
			clock: {
				nowMs() {
					calls += 1;
					return 4242;
				},
			},
		});
		seedUser("alice");

		app.issueToken(ADMIN, { amount: 10 });

		expect(calls).toBe(1);
		expect(state.operationRows[0]?.record.createdAt).toBe(4242);
		expect(state.ledgerRows[0]?.record.createdAt).toBe(4242);
		expect(state.wallets.get(TREASURY_WALLET_ID)?.updatedAt).toBe(4242);

		app.distributeToken(ADMIN, { toUserId: "alice", amount: 5 });
		expect(calls).toBe(2);
	});

	it("a forbidden call opens no section and writes nothing", () => {
		const { app, state } = createInMemoryFixture();

		const r = app.issueToken(userActor("alice"), { amount: 10 });

		expect(r).toMatchObject({ ok: false, error: { type: "forbidden" } });
		expect(state.operationRows).toHaveLength(0);
		expect(state.ledgerRows).toHaveLength(0);
	});
});
