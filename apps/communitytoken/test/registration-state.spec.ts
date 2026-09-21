import { env, runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import type { CommunityState } from "../src/index";

/**
 * Storage-level coverage of the `registration_intents` table (issue #4
 * PR-4, the registration specification): the column CHECKs, the
 * one-active-intent-per-identity partial unique index, and the lifecycle
 * triggers that make identity/proof columns immutable and admit only
 * `active -> consumed` / `active -> superseded`.
 *
 * Each test uses a freshly-named DO id so storage is fully isolated.
 */

function freshStub(): DurableObjectStub<CommunityState> {
	const id = env.COMMUNITY_STATE.idFromName(crypto.randomUUID());
	return env.COMMUNITY_STATE.get(id) as DurableObjectStub<CommunityState>;
}

const INSERT_INTENT = `INSERT INTO registration_intents
  (id, expected_issuer, expected_subject, state, nonce, pkce_verifier,
   status, created_at, expires_at, consumed_at)
  VALUES (?, 'iss', 'sub', ?, 'nonce', 'verifier', ?, ?, ?, ?)`;

function insertIntent(
	state: string,
	init: {
		status?: string;
		createdAt?: number;
		expiresAt?: number;
		consumedAt?: number | null;
	} = {},
): [sql: string, ...bindings: unknown[]] {
	const createdAt = init.createdAt ?? 1_000;
	return [
		INSERT_INTENT,
		crypto.randomUUID(),
		state,
		init.status ?? "active",
		createdAt,
		init.expiresAt ?? createdAt + 600_000,
		init.consumedAt === undefined ? null : init.consumedAt,
	];
}

describe("registration_intents schema", () => {
	it("rejects a TTL that is not exactly created_at + 600000", async () => {
		const s = freshStub();
		await expect(
			runInDurableObject(s, async (_i, storage) => {
				storage.storage.sql.exec(
					...insertIntent("s1", { createdAt: 1_000, expiresAt: 601_001 }),
				);
			}),
		).rejects.toThrow();
	});

	it("rejects a consumed row without consumed_at and vice versa", async () => {
		const s = freshStub();
		await expect(
			runInDurableObject(s, async (_i, storage) => {
				storage.storage.sql.exec(
					...insertIntent("s1", { status: "consumed", consumedAt: null }),
				);
			}),
		).rejects.toThrow();
		await expect(
			runInDurableObject(s, async (_i, storage) => {
				storage.storage.sql.exec(
					...insertIntent("s2", { status: "active", consumedAt: 5 }),
				);
			}),
		).rejects.toThrow();
	});

	it("admits only the three lifecycle statuses", async () => {
		const s = freshStub();
		await expect(
			runInDurableObject(s, async (_i, storage) => {
				storage.storage.sql.exec(...insertIntent("s1", { status: "bogus" }));
			}),
		).rejects.toThrow();
	});

	it("enforces at most one active intent per identity", async () => {
		const s = freshStub();
		await runInDurableObject(s, async (_i, storage) => {
			storage.storage.sql.exec(...insertIntent("s1"));
		});
		await expect(
			runInDurableObject(s, async (_i, storage) => {
				storage.storage.sql.exec(...insertIntent("s2"));
			}),
		).rejects.toThrow();
		// A superseded predecessor does not block the next insert.
		await runInDurableObject(s, async (_i, storage) => {
			storage.storage.sql.exec(
				"UPDATE registration_intents SET status = 'superseded' WHERE state = 's1'",
			);
			storage.storage.sql.exec(...insertIntent("s2"));
		});
	});
});

describe("registration_intents lifecycle triggers", () => {
	it("rejects updates of identity and proof columns", async () => {
		const s = freshStub();
		await runInDurableObject(s, async (_i, storage) => {
			storage.storage.sql.exec(...insertIntent("s1"));
		});
		for (const column of [
			"id",
			"expected_issuer",
			"expected_subject",
			"state",
			"nonce",
			"pkce_verifier",
			"created_at",
			"expires_at",
		]) {
			await expect(
				runInDurableObject(s, async (_i, storage) => {
					storage.storage.sql.exec(
						`UPDATE registration_intents SET ${column} = CASE WHEN typeof(${column}) = 'integer' THEN ${column} + 1 ELSE ${column} || 'x' END WHERE state = 's1'`,
					);
				}),
			).rejects.toThrow();
		}
	});

	it("permits active -> consumed with consumed_at and active -> superseded without it", async () => {
		const s = freshStub();
		await runInDurableObject(s, async (_i, storage) => {
			storage.storage.sql.exec(...insertIntent("c1"));
			storage.storage.sql.exec(
				"UPDATE registration_intents SET status = 'consumed', consumed_at = 2_000 WHERE state = 'c1'",
			);
			storage.storage.sql.exec(...insertIntent("c2"));
			storage.storage.sql.exec(
				"UPDATE registration_intents SET status = 'superseded' WHERE state = 'c2'",
			);
			const rows = storage.storage.sql
				.exec(
					"SELECT state, status, consumed_at FROM registration_intents ORDER BY rowid",
				)
				.toArray();
			expect(rows).toEqual([
				{ state: "c1", status: "consumed", consumed_at: 2_000 },
				{ state: "c2", status: "superseded", consumed_at: null },
			]);
		});
	});

	it("rejects every transition out of consumed or superseded", async () => {
		const s = freshStub();
		await runInDurableObject(s, async (_i, storage) => {
			storage.storage.sql.exec(...insertIntent("d1"));
			storage.storage.sql.exec(
				"UPDATE registration_intents SET status = 'consumed', consumed_at = 2_000 WHERE state = 'd1'",
			);
			storage.storage.sql.exec(...insertIntent("d2"));
			storage.storage.sql.exec(
				"UPDATE registration_intents SET status = 'superseded' WHERE state = 'd2'",
			);
		});
		for (const sql of [
			"UPDATE registration_intents SET status = 'active' WHERE state = 'd1'",
			"UPDATE registration_intents SET status = 'superseded', consumed_at = NULL WHERE state = 'd1'",
			"UPDATE registration_intents SET consumed_at = 9_999 WHERE state = 'd1'",
			"UPDATE registration_intents SET status = 'active' WHERE state = 'd2'",
			"UPDATE registration_intents SET status = 'consumed', consumed_at = 1 WHERE state = 'd2'",
		]) {
			await expect(
				runInDurableObject(s, async (_i, storage) => {
					storage.storage.sql.exec(sql);
				}),
			).rejects.toThrow();
		}
	});

	it("rejects an active -> active no-op transition and stray consumed_at writes", async () => {
		const s = freshStub();
		await runInDurableObject(s, async (_i, storage) => {
			storage.storage.sql.exec(...insertIntent("e1"));
		});
		await expect(
			runInDurableObject(s, async (_i, storage) => {
				storage.storage.sql.exec(
					"UPDATE registration_intents SET status = 'active' WHERE state = 'e1'",
				);
			}),
		).rejects.toThrow();
		await expect(
			runInDurableObject(s, async (_i, storage) => {
				storage.storage.sql.exec(
					"UPDATE registration_intents SET consumed_at = 5 WHERE state = 'e1'",
				);
			}),
		).rejects.toThrow();
	});

	it("allows deletion — the storage floor has no delete trigger", async () => {
		const s = freshStub();
		await runInDurableObject(s, async (_i, storage) => {
			storage.storage.sql.exec(
				...insertIntent("f1", {
					status: "consumed",
					consumedAt: 2_000,
				}),
			);
			storage.storage.sql.exec(
				"DELETE FROM registration_intents WHERE state = 'f1'",
			);
			const row = storage.storage.sql
				.exec("SELECT COUNT(*) AS n FROM registration_intents")
				.one();
			expect(row["n"]).toBe(0);
		});
	});
});
