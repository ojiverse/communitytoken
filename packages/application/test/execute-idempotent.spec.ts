import { describe, expect, it } from "vitest";
import type { IdempotencyRecord } from "../src/types";
import { rehydrate } from "../src/types";
import {
	executeIdempotent,
	type IdempotencyKeyInfo,
} from "../src/use-cases/execute-idempotent";
import {
	createInMemoryFixture,
	createInMemoryState,
	createInMemoryUnitOfWork,
	fixedClock,
} from "./in-memory";

const KEY_INFO: IdempotencyKeyInfo = {
	technicalCaller: "discord-adapter",
	idempotencyKey: "key-1",
	fingerprintVersion: "v1",
	requestFingerprint: "abc123",
};

function storedRecord(
	overrides?: Partial<IdempotencyRecord>,
): IdempotencyRecord {
	return {
		technicalCaller: KEY_INFO.technicalCaller,
		idempotencyKey: KEY_INFO.idempotencyKey,
		fingerprintVersion: KEY_INFO.fingerprintVersion,
		requestFingerprint: KEY_INFO.requestFingerprint,
		storedResult: JSON.stringify({ status: 200, body: { ok: true } }),
		createdAt: 1,
		...overrides,
	};
}

describe("executeIdempotent", () => {
	it("executes and persists the replay record for a recordable success", () => {
		const fx = createInMemoryFixture({ clock: fixedClock(4242) });

		const outcome = fx.uow.transact((ctx) =>
			executeIdempotent(ctx, KEY_INFO, () => ({
				record: true,
				result: "fresh-result",
				storedResult: '{"status":200,"body":{"transaction_id":"tx-1"}}',
			})),
		);

		expect(outcome).toEqual({ type: "executed", result: "fresh-result" });
		const stored = fx.state.idempotencyRecords.get(
			JSON.stringify([KEY_INFO.technicalCaller, KEY_INFO.idempotencyKey]),
		);
		expect(stored).toEqual({
			technicalCaller: KEY_INFO.technicalCaller,
			idempotencyKey: KEY_INFO.idempotencyKey,
			fingerprintVersion: "v1",
			requestFingerprint: "abc123",
			storedResult: '{"status":200,"body":{"transaction_id":"tx-1"}}',
			createdAt: 4242,
		});
	});

	it("executes without persisting a record for a non-recordable expected failure", () => {
		const fx = createInMemoryFixture();

		const outcome = fx.uow.transact((ctx) =>
			executeIdempotent(ctx, KEY_INFO, () => ({
				record: false,
				result: "expected-failure",
			})),
		);

		expect(outcome).toEqual({ type: "executed", result: "expected-failure" });
		expect(fx.state.idempotencyRecords.size).toBe(0);
	});

	it("replays the stored result for a matching key+version+fingerprint without executing", () => {
		const fx = createInMemoryFixture();
		fx.uow.transact((ctx) => ctx.idempotencyRecords.insert(storedRecord()));

		let executed = false;
		const outcome = fx.uow.transact((ctx) =>
			executeIdempotent(ctx, KEY_INFO, () => {
				executed = true;
				return { record: false, result: "should-not-run" };
			}),
		);

		expect(executed).toBe(false);
		expect(outcome).toEqual({
			type: "replayed",
			storedResult: JSON.stringify({ status: 200, body: { ok: true } }),
		});
	});

	it("conflicts when the same caller+key carries a different fingerprint", () => {
		const fx = createInMemoryFixture();
		fx.uow.transact((ctx) => ctx.idempotencyRecords.insert(storedRecord()));

		let executed = false;
		const outcome = fx.uow.transact((ctx) =>
			executeIdempotent(
				ctx,
				{ ...KEY_INFO, requestFingerprint: "different" },
				() => {
					executed = true;
					return { record: false, result: "should-not-run" };
				},
			),
		);

		expect(executed).toBe(false);
		expect(outcome).toEqual({ type: "conflict" });
		// The original record is untouched.
		expect(fx.state.idempotencyRecords.size).toBe(1);
	});

	it("conflicts when the fingerprint version differs", () => {
		const fx = createInMemoryFixture();
		fx.uow.transact((ctx) => ctx.idempotencyRecords.insert(storedRecord()));

		const outcome = fx.uow.transact((ctx) =>
			executeIdempotent(ctx, { ...KEY_INFO, fingerprintVersion: "v2" }, () => ({
				record: false,
				result: "should-not-run",
			})),
		);

		expect(outcome).toEqual({ type: "conflict" });
	});

	it("scopes records to the technical caller: a different caller executes fresh", () => {
		const fx = createInMemoryFixture();
		fx.uow.transact((ctx) => ctx.idempotencyRecords.insert(storedRecord()));

		const outcome = fx.uow.transact((ctx) =>
			executeIdempotent(
				ctx,
				{ ...KEY_INFO, technicalCaller: "admin-api" },
				() => ({ record: false, result: "fresh" }),
			),
		);

		expect(outcome).toEqual({ type: "executed", result: "fresh" });
	});

	it("scopes records to the idempotency key: a different key executes fresh", () => {
		const fx = createInMemoryFixture();
		fx.uow.transact((ctx) => ctx.idempotencyRecords.insert(storedRecord()));

		const outcome = fx.uow.transact((ctx) =>
			executeIdempotent(ctx, { ...KEY_INFO, idempotencyKey: "key-2" }, () => ({
				record: false,
				result: "fresh",
			})),
		);

		expect(outcome).toEqual({ type: "executed", result: "fresh" });
	});

	it("commits the record and the protected mutation atomically — a later throw rolls both back", () => {
		const fx = createInMemoryFixture();

		expect(() =>
			fx.uow.transact((ctx) => {
				ctx.principals.insert({ createdAt: ctx.nowMs });
				const outcome = executeIdempotent(ctx, KEY_INFO, () => ({
					record: true,
					result: "ok",
					storedResult: "{}",
				}));
				expect(outcome.type).toBe("executed");
				throw new Error("abort after idempotent execution");
			}),
		).toThrow(/abort/);

		expect(fx.state.idempotencyRecords.size).toBe(0);
		expect(fx.state.principals.size).toBe(1);
	});

	it("a throw inside execute persists no record", () => {
		const fx = createInMemoryFixture();

		expect(() =>
			fx.uow.transact((ctx) =>
				executeIdempotent(ctx, KEY_INFO, () => {
					throw new Error("unexpected failure");
				}),
			),
		).toThrow(/unexpected/);

		expect(fx.state.idempotencyRecords.size).toBe(0);
	});

	it("a retried key executes again after a previous non-recordable failure", () => {
		const fx = createInMemoryFixture();

		const first = fx.uow.transact((ctx) =>
			executeIdempotent(ctx, KEY_INFO, () => ({
				record: false,
				result: "failed",
			})),
		);
		expect(first).toEqual({ type: "executed", result: "failed" });

		const second = fx.uow.transact((ctx) =>
			executeIdempotent(ctx, KEY_INFO, () => ({
				record: true,
				result: "succeeded-on-retry",
				storedResult: "{}",
			})),
		);
		expect(second).toEqual({ type: "executed", result: "succeeded-on-retry" });
	});
});

describe("in-memory identity binding repository", () => {
	it("resolves an exact (issuer, subject) pair to its Principal and misses otherwise", () => {
		const state = createInMemoryState();
		state.identityBindings.set(
			JSON.stringify(["issuer-a", "subject-1"]),
			rehydrate.principalId("principal-1"),
		);
		const uow = createInMemoryUnitOfWork(state, fixedClock(1));

		const found = uow.transact((ctx) =>
			ctx.identityBindings.findPrincipalIdByExternal("issuer-a", "subject-1"),
		);
		const missed = uow.transact((ctx) =>
			ctx.identityBindings.findPrincipalIdByExternal("issuer-a", "subject-2"),
		);

		expect(found).toBe(rehydrate.principalId("principal-1"));
		expect(missed).toBeUndefined();
	});
});
