import { env, runInDurableObject, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import type { CommunityStateApi } from "../src/http";
import { handleRequest } from "../src/http";
import type { CommunityState } from "../src/index";

/**
 * PR-3 end-to-end coverage of the trusted core API through the Worker
 * `fetch` pipeline (issue #4): routing, authentication/authorization,
 * wire validation, the fixed error taxonomy, and the idempotency
 * contract — including that the record commits atomically with the
 * protected mutation.
 *
 * The Worker routes every request to the DO instance named "community";
 * tests seed bindings on that same instance and use unique subjects per
 * test so shared state cannot collide. Bearer credentials come from the
 * test-pool bindings (`vitest.config.ts`), never from committed config.
 */

const ORIGIN = "https://token.ojiver.se";
const ISSUER = "https://discord.id.ojiver.se";

const DISCORD_TOKEN = (): string => env.DISCORD_ADAPTER_SERVICE_TOKEN ?? "";
const ADMIN_TOKEN = (): string => env.ADMIN_API_TOKEN ?? "";

function communityStub(): DurableObjectStub<CommunityState> {
	const id = env.COMMUNITY_STATE.idFromName("community");
	return env.COMMUNITY_STATE.get(id) as DurableObjectStub<CommunityState>;
}

function call(
	path: string,
	init: {
		method?: string;
		token?: string;
		body?: unknown;
		rawBody?: string;
		headers?: Record<string, string>;
	} = {},
): Promise<Response> {
	const headers = new Headers(init.headers);
	if (init.token !== undefined) {
		headers.set("Authorization", `Bearer ${init.token}`);
	}
	const body =
		init.rawBody ??
		(init.body === undefined ? undefined : JSON.stringify(init.body));
	if (body !== undefined && !headers.has("Content-Type")) {
		headers.set("Content-Type", "application/json");
	}
	return SELF.fetch(`${ORIGIN}${path}`, {
		method: init.method ?? "POST",
		headers,
		...(body === undefined ? {} : { body }),
	});
}

async function errorCode(response: Response): Promise<string> {
	const body = (await response.json()) as { error?: string };
	return body.error ?? "";
}

async function seedBound(
	user: string,
	subject: string,
	issuer: string = ISSUER,
): Promise<void> {
	const result = await communityStub().createBoundUser(user, issuer, subject);
	expect(result).toEqual({ ok: true });
}

function transferBody(
	fromSubject: string,
	toSubject: string,
	amount: number,
): { from: object; to: object; amount: number } {
	return {
		from: { issuer: ISSUER, subject: fromSubject },
		to: { issuer: ISSUER, subject: toSubject },
		amount,
	};
}

async function idempotencyRecordCount(key: string): Promise<number> {
	return runInDurableObject(communityStub(), async (_i, state) => {
		const row = state.storage.sql
			.exec(
				"SELECT COUNT(*) AS n FROM idempotency_records WHERE idempotency_key = ?",
				key,
			)
			.one();
		return Number(row["n"]);
	});
}

describe("routing", () => {
	it("returns 404 for unknown paths — route match precedes authentication", async () => {
		for (const path of ["/", "/health", "/internal/unknown", "/admin/x"]) {
			expect((await call(path)).status).toBe(404);
			expect(await errorCode(await call(path))).toBe("not_found");
		}
	});

	it("returns 404 for routes owned by later PRs, even authenticated", async () => {
		for (const path of [
			"/internal/registration-intents",
			"/internal/daily-reward",
		]) {
			expect((await call(path, { token: DISCORD_TOKEN() })).status).toBe(404);
		}
		const callback = await SELF.fetch(`${ORIGIN}/auth/oidc/callback?code=x`, {
			headers: { Authorization: `Bearer ${DISCORD_TOKEN()}` },
		});
		expect(callback.status).toBe(404);
	});

	it("returns 404 for the wrong method on a known path and for non-exact paths", async () => {
		expect((await call("/internal/balance", { method: "GET" })).status).toBe(
			404,
		);
		expect(
			(
				await call("/admin/treasury/balance", {
					method: "POST",
					token: ADMIN_TOKEN(),
				})
			).status,
		).toBe(404);
		// No trailing-slash or case normalization.
		for (const path of ["/internal/balance/", "/Internal/balance"]) {
			expect((await call(path, { token: DISCORD_TOKEN() })).status).toBe(404);
		}
	});
});

describe("authentication and route-group authorization", () => {
	it("401s missing, malformed, and non-matching credentials", async () => {
		expect((await call("/internal/balance")).status).toBe(401);
		expect(
			(
				await call("/internal/balance", {
					headers: { Authorization: "Basic abc" },
				})
			).status,
		).toBe(401);
		expect(
			(await call("/internal/balance", { token: "wrong-token" })).status,
		).toBe(401);
		expect(await errorCode(await call("/internal/balance"))).toBe(
			"unauthorized",
		);
	});

	it("403s an authenticated principal on the wrong route group", async () => {
		expect(
			(
				await call("/admin/treasury/balance", {
					method: "GET",
					token: DISCORD_TOKEN(),
				})
			).status,
		).toBe(403);
		expect(
			(
				await call("/admin/issuances", {
					token: DISCORD_TOKEN(),
					body: { amount: 1 },
				})
			).status,
		).toBe(403);
		expect(
			(
				await call("/internal/balance", {
					token: ADMIN_TOKEN(),
					body: { issuer: ISSUER, subject: "x" },
				})
			).status,
		).toBe(403);
		expect(
			await errorCode(
				await call("/internal/balance", {
					token: ADMIN_TOKEN(),
					body: { issuer: ISSUER, subject: "x" },
				}),
			),
		).toBe("forbidden");
	});
});

describe("wire validation", () => {
	it("415s non-JSON media types on JSON routes", async () => {
		const response = await SELF.fetch(`${ORIGIN}/internal/balance`, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${DISCORD_TOKEN()}`,
				"Content-Type": "text/plain",
			},
			body: "{}",
		});
		expect(response.status).toBe(415);
		expect(await errorCode(response)).toBe("unsupported_media_type");
		// application/json with a charset parameter is still JSON.
		const withCharset = await SELF.fetch(`${ORIGIN}/internal/balance`, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${DISCORD_TOKEN()}`,
				"Content-Type": "application/json; charset=utf-8",
			},
			body: "{}",
		});
		expect(withCharset.status).toBe(400);
	});

	it("400s malformed JSON, non-object bodies, and missing fields", async () => {
		for (const rawBody of ["{", "[]", '"x"', "null", "5"]) {
			const response = await call("/internal/balance", {
				token: DISCORD_TOKEN(),
				rawBody,
			});
			expect(response.status).toBe(400);
			expect(await errorCode(response)).toBe("invalid_request");
		}
		expect(
			(await call("/internal/balance", { token: DISCORD_TOKEN(), body: {} }))
				.status,
		).toBe(400);
	});

	it("rejects unknown fields, including nested objects", async () => {
		const top = await call("/internal/balance", {
			token: DISCORD_TOKEN(),
			body: { issuer: ISSUER, subject: "s", extra: 1 },
		});
		expect(top.status).toBe(400);
		expect(await errorCode(top)).toBe("invalid_request");

		const nested = await call("/internal/transfers", {
			token: DISCORD_TOKEN(),
			headers: { "Idempotency-Key": "k-nested" },
			body: {
				from: { issuer: ISSUER, subject: "s", unexpected: true },
				to: { issuer: ISSUER, subject: "t" },
				amount: 1,
			},
		});
		expect(nested.status).toBe(400);
		expect(await errorCode(nested)).toBe("invalid_request");
	});

	it("rejects empty issuers/subjects, non-number amounts, and non-string metadata", async () => {
		for (const body of [
			{ issuer: "", subject: "s" },
			{ issuer: ISSUER, subject: 3 },
			{ issuer: ISSUER, subject: "s", amount: "5" },
		]) {
			const response = await call("/internal/balance", {
				token: DISCORD_TOKEN(),
				body,
			});
			expect(response.status).toBe(400);
			expect(await errorCode(response)).toBe("invalid_request");
		}
		const metadata = await call("/admin/issuances", {
			token: ADMIN_TOKEN(),
			body: { amount: 5, metadata: 42 },
		});
		expect(metadata.status).toBe(400);
		expect(await errorCode(metadata)).toBe("invalid_request");
	});

	it("rejects invalid limits and cursors with their own codes", async () => {
		for (const limit of [0, 101, 1.5, "50"]) {
			const response = await call("/internal/history", {
				token: DISCORD_TOKEN(),
				body: { issuer: ISSUER, subject: "s", limit },
			});
			expect(response.status).toBe(400);
			expect(await errorCode(response)).toBe("invalid_limit");
		}
		for (const cursor of ["abc", "-1", "1.5", 7]) {
			const response = await call("/internal/history", {
				token: DISCORD_TOKEN(),
				body: { issuer: ISSUER, subject: "s", cursor },
			});
			expect(response.status).toBe(400);
			expect(await errorCode(response)).toBe("invalid_cursor");
		}
		// The GET route validates the same grammar from query parameters.
		expect(
			(
				await call("/admin/treasury/history?limit=abc", {
					method: "GET",
					token: ADMIN_TOKEN(),
				})
			).status,
		).toBe(400);
		expect(
			(
				await call("/admin/treasury/history?cursor=!!", {
					method: "GET",
					token: ADMIN_TOKEN(),
				})
			).status,
		).toBe(400);
	});

	it("ignores query parameters on POST routes", async () => {
		const subject = `q-${crypto.randomUUID()}`;
		await seedBound(`u-${subject}`, subject);
		const response = await call("/internal/balance?ignored=yes", {
			token: DISCORD_TOKEN(),
			body: { issuer: ISSUER, subject },
		});
		expect(response.status).toBe(200);
	});
});

describe("idempotency-key validation", () => {
	it("requires a 1..255 Idempotency-Key on POST /internal/transfers", async () => {
		const body = transferBody("a", "b", 1);
		const missing = await call("/internal/transfers", {
			token: DISCORD_TOKEN(),
			body,
		});
		expect(missing.status).toBe(400);
		expect(await errorCode(missing)).toBe("idempotency_key_required");

		const tooLong = await call("/internal/transfers", {
			token: DISCORD_TOKEN(),
			headers: { "Idempotency-Key": "x".repeat(256) },
			body,
		});
		expect(tooLong.status).toBe(400);
		expect(await errorCode(tooLong)).toBe("idempotency_key_required");
	});

	it("ignores the header on read and admin routes", async () => {
		const subject = `hdr-${crypto.randomUUID()}`;
		await seedBound(`u-${subject}`, subject);
		const response = await call("/internal/balance", {
			token: DISCORD_TOKEN(),
			headers: { "Idempotency-Key": "not-required" },
			body: { issuer: ISSUER, subject },
		});
		expect(response.status).toBe(200);
		const admin = await call("/admin/issuances", {
			token: ADMIN_TOKEN(),
			headers: { "Idempotency-Key": "ignored" },
			body: { amount: 1 },
		});
		expect(admin.status).toBe(200);
	});
});

describe("internal routes", () => {
	it("returns the bound user's balance and 404s an unbound identity", async () => {
		const subject = `bal-${crypto.randomUUID()}`;
		await seedBound(`u-${subject}`, subject);
		const response = await call("/internal/balance", {
			token: DISCORD_TOKEN(),
			body: { issuer: ISSUER, subject },
		});
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ balance: 0 });

		const unbound = await call("/internal/balance", {
			token: DISCORD_TOKEN(),
			body: { issuer: ISSUER, subject: `nobody-${crypto.randomUUID()}` },
		});
		expect(unbound.status).toBe(404);
		expect(await errorCode(unbound)).toBe("identity_not_bound");
	});

	it("returns the bound user's history as snake_case operations, 404 unbound", async () => {
		const alice = `ha-${crypto.randomUUID()}`;
		const bob = `hb-${crypto.randomUUID()}`;
		await seedBound(`u-${alice}`, alice);
		await seedBound(`u-${bob}`, bob);
		await call("/admin/issuances", {
			token: ADMIN_TOKEN(),
			body: { amount: 50 },
		});
		await call("/admin/distributions", {
			token: ADMIN_TOKEN(),
			body: { issuer: ISSUER, subject: alice, amount: 20 },
		});
		await call("/internal/transfers", {
			token: DISCORD_TOKEN(),
			headers: { "Idempotency-Key": `h-${alice}` },
			body: transferBody(alice, bob, 5),
		});

		const history = await call("/internal/history", {
			token: DISCORD_TOKEN(),
			body: { issuer: ISSUER, subject: alice },
		});
		expect(history.status).toBe(200);
		const page = (await history.json()) as {
			operations: Array<Record<string, unknown>>;
			next_cursor: string | null;
		};
		expect(page.operations).toHaveLength(2);
		expect(page.operations[0]).toMatchObject({
			kind: "P2P_TRANSFER",
			amount: 5,
			direction: "out",
			counterparty: `u-${bob}`,
			actor_kind: "user",
			actor_id: `u-${alice}`,
		});
		expect(page.operations[1]).toMatchObject({
			kind: "DISTRIBUTION",
			direction: "in",
			counterparty: "treasury",
		});
		// TOKEN_ISSUANCE never appears in a user history.
		expect(page.operations.map((o) => o["kind"])).not.toContain(
			"TOKEN_ISSUANCE",
		);

		const unbound = await call("/internal/history", {
			token: DISCORD_TOKEN(),
			body: { issuer: ISSUER, subject: `none-${crypto.randomUUID()}` },
		});
		expect(unbound.status).toBe(404);
		expect(await errorCode(unbound)).toBe("identity_not_bound");
	});

	it("paginates history newest-first by decimal cursor", async () => {
		const subject = `pg-${crypto.randomUUID()}`;
		const other = `po-${crypto.randomUUID()}`;
		await seedBound(`u-${subject}`, subject);
		await seedBound(`u-${other}`, other);
		await call("/admin/issuances", {
			token: ADMIN_TOKEN(),
			body: { amount: 30 },
		});
		await call("/admin/distributions", {
			token: ADMIN_TOKEN(),
			body: { issuer: ISSUER, subject, amount: 30 },
		});
		for (const [i, amount] of [1, 2, 3].entries()) {
			await call("/internal/transfers", {
				token: DISCORD_TOKEN(),
				headers: { "Idempotency-Key": `pg-${subject}-${i}` },
				body: transferBody(subject, other, amount),
			});
		}

		const first = await call("/internal/history", {
			token: DISCORD_TOKEN(),
			body: { issuer: ISSUER, subject, limit: 2 },
		});
		const page1 = (await first.json()) as {
			operations: Array<{ amount: number }>;
			next_cursor: string | null;
		};
		expect(page1.operations.map((o) => o.amount)).toEqual([3, 2]);
		expect(page1.next_cursor).not.toBeNull();

		const rest = await call("/internal/history", {
			token: DISCORD_TOKEN(),
			body: {
				issuer: ISSUER,
				subject,
				limit: 100,
				cursor: page1.next_cursor,
			},
		});
		const page2 = (await rest.json()) as {
			operations: Array<{ amount: number }>;
			next_cursor: string | null;
		};
		expect(page2.operations.map((o) => o.amount)).toEqual([1, 30]);
		expect(page2.next_cursor).toBeNull();
	});
});

describe("admin routes", () => {
	it("issues into the treasury and reports the treasury balance", async () => {
		// The "community" DO is shared within this file, so the treasury
		// accumulates — assert the delta, not an absolute balance.
		const before = await call("/admin/treasury/balance", {
			method: "GET",
			token: ADMIN_TOKEN(),
		});
		const beforeBalance = ((await before.json()) as { balance: number })
			.balance;

		const issue = await call("/admin/issuances", {
			token: ADMIN_TOKEN(),
			body: { amount: 100, metadata: "seed" },
		});
		expect(issue.status).toBe(200);
		const issued = (await issue.json()) as { operation_id: string };
		expect(typeof issued.operation_id).toBe("string");

		const after = await call("/admin/treasury/balance", {
			method: "GET",
			token: ADMIN_TOKEN(),
		});
		expect(after.status).toBe(200);
		expect(((await after.json()) as { balance: number }).balance).toBe(
			beforeBalance + 100,
		);
	});

	it("422s a kernel rejection (invalid amount) as its lowercased code", async () => {
		const response = await call("/admin/issuances", {
			token: ADMIN_TOKEN(),
			body: { amount: 0 },
		});
		expect(response.status).toBe(422);
		expect(await errorCode(response)).toBe("invalid_amount");
	});

	it("distributes to a bound user and 404s an unbound one", async () => {
		const subject = `dist-${crypto.randomUUID()}`;
		await seedBound(`u-${subject}`, subject);
		await call("/admin/issuances", {
			token: ADMIN_TOKEN(),
			body: { amount: 10 },
		});
		const okResponse = await call("/admin/distributions", {
			token: ADMIN_TOKEN(),
			body: { issuer: ISSUER, subject, amount: 10, metadata: "grant" },
		});
		expect(okResponse.status).toBe(200);

		const unbound = await call("/admin/distributions", {
			token: ADMIN_TOKEN(),
			body: {
				issuer: ISSUER,
				subject: `none-${crypto.randomUUID()}`,
				amount: 1,
			},
		});
		expect(unbound.status).toBe(404);
		expect(await errorCode(unbound)).toBe("identity_not_bound");

		// Treasury history is newest-first and includes issuances; the
		// shared instance accumulates other tests' operations, so assert the
		// newest entry is this test's distribution.
		const history = await call("/admin/treasury/history", {
			method: "GET",
			token: ADMIN_TOKEN(),
		});
		const page = (await history.json()) as {
			operations: Array<{
				kind: string;
				metadata: string | null;
				to_wallet_id: string;
			}>;
		};
		expect(page.operations[0]).toMatchObject({
			kind: "DISTRIBUTION",
			metadata: "grant",
			to_wallet_id: expect.any(String),
		});
		expect(page.operations.some((o) => o.kind === "TOKEN_ISSUANCE")).toBe(true);
	});
});

describe("internalTransfer idempotency", () => {
	async function seedPair(): Promise<{ a: string; b: string }> {
		const a = `ta-${crypto.randomUUID()}`;
		const b = `tb-${crypto.randomUUID()}`;
		await seedBound(`u-${a}`, a);
		await seedBound(`u-${b}`, b);
		await call("/admin/issuances", {
			token: ADMIN_TOKEN(),
			body: { amount: 100 },
		});
		await call("/admin/distributions", {
			token: ADMIN_TOKEN(),
			body: { issuer: ISSUER, subject: a, amount: 100 },
		});
		return { a, b };
	}

	it("commits the mutation and its replay record atomically, then replays verbatim", async () => {
		const { a, b } = await seedPair();
		const key = `idem-${crypto.randomUUID()}`;
		const body = transferBody(a, b, 25);

		const first = await call("/internal/transfers", {
			token: DISCORD_TOKEN(),
			headers: { "Idempotency-Key": key },
			body,
		});
		expect(first.status).toBe(200);
		const firstBody = (await first.json()) as {
			operation_id: string;
			from_balance: number;
		};
		expect(firstBody.from_balance).toBe(75);

		// Mutation + record committed together.
		expect(await idempotencyRecordCount(key)).toBe(1);

		// A byte-identical replay returns the stored descriptor without
		// executing the mutation a second time.
		const replay = await call("/internal/transfers", {
			token: DISCORD_TOKEN(),
			headers: { "Idempotency-Key": key },
			body,
		});
		expect(replay.status).toBe(200);
		expect(await replay.json()).toEqual(firstBody);
		const balance = await call("/internal/balance", {
			token: DISCORD_TOKEN(),
			body: { issuer: ISSUER, subject: a },
		});
		expect(await balance.json()).toEqual({ balance: 75 });
	});

	it("409s a reused key with a different fingerprint", async () => {
		const { a, b } = await seedPair();
		const key = `conflict-${crypto.randomUUID()}`;
		await call("/internal/transfers", {
			token: DISCORD_TOKEN(),
			headers: { "Idempotency-Key": key },
			body: transferBody(a, b, 10),
		});
		const conflict = await call("/internal/transfers", {
			token: DISCORD_TOKEN(),
			headers: { "Idempotency-Key": key },
			body: transferBody(a, b, 11),
		});
		expect(conflict.status).toBe(409);
		expect(await errorCode(conflict)).toBe("idempotency_key_reuse");
	});

	it("does not record expected non-mutating failures; the key stays retryable", async () => {
		const { a, b } = await seedPair();
		const key = `retry-${crypto.randomUUID()}`;

		// Unbound recipient — an expected failure that consumes nothing.
		const failed = await call("/internal/transfers", {
			token: DISCORD_TOKEN(),
			headers: { "Idempotency-Key": key },
			body: transferBody(a, `ghost-${crypto.randomUUID()}`, 5),
		});
		expect(failed.status).toBe(404);
		expect(await errorCode(failed)).toBe("recipient_not_bound");
		expect(await idempotencyRecordCount(key)).toBe(0);

		// A kernel rejection leaves no record either.
		const rejected = await call("/internal/transfers", {
			token: DISCORD_TOKEN(),
			headers: { "Idempotency-Key": key },
			body: transferBody(a, b, 9_999_999),
		});
		expect(rejected.status).toBe(422);
		expect(await errorCode(rejected)).toBe("insufficient_balance");
		expect(await idempotencyRecordCount(key)).toBe(0);

		// The same key now executes normally.
		const retried = await call("/internal/transfers", {
			token: DISCORD_TOKEN(),
			headers: { "Idempotency-Key": key },
			body: transferBody(a, b, 5),
		});
		expect(retried.status).toBe(200);
		expect(await idempotencyRecordCount(key)).toBe(1);
	});

	it("404s an unbound sender and rejects a canonicalization failure", async () => {
		const { a } = await seedPair();
		const unboundSender = await call("/internal/transfers", {
			token: DISCORD_TOKEN(),
			headers: { "Idempotency-Key": `s-${crypto.randomUUID()}` },
			body: transferBody(`ghost-${crypto.randomUUID()}`, a, 5),
		});
		expect(unboundSender.status).toBe(404);
		expect(await errorCode(unboundSender)).toBe("identity_not_bound");

		const loneSurrogate = await call("/internal/transfers", {
			token: DISCORD_TOKEN(),
			headers: { "Idempotency-Key": `ls-${crypto.randomUUID()}` },
			rawBody: `{"from":{"issuer":"i","subject":"\\ud800"},"to":{"issuer":"i","subject":"t"},"amount":1}`,
		});
		expect(loneSurrogate.status).toBe(400);
		expect(await errorCode(loneSurrogate)).toBe("invalid_request");
	});
});

describe("non-finite amounts", () => {
	it("400s a parsed-JSON number that is not finite, on every amount-bearing route", async () => {
		const transfer = await call("/internal/transfers", {
			token: DISCORD_TOKEN(),
			headers: { "Idempotency-Key": `nf-${crypto.randomUUID()}` },
			rawBody:
				'{"from":{"issuer":"i","subject":"a"},"to":{"issuer":"i","subject":"b"},"amount":1e400}',
		});
		expect(transfer.status).toBe(400);
		expect(await errorCode(transfer)).toBe("invalid_request");

		const issuance = await call("/admin/issuances", {
			token: ADMIN_TOKEN(),
			rawBody: '{"amount":1e400}',
		});
		expect(issuance.status).toBe(400);
		expect(await errorCode(issuance)).toBe("invalid_request");

		const distribution = await call("/admin/distributions", {
			token: ADMIN_TOKEN(),
			rawBody: '{"issuer":"i","subject":"s","amount":-1e400}',
		});
		expect(distribution.status).toBe(400);
		expect(await errorCode(distribution)).toBe("invalid_request");
	});

	it("still passes finite but domain-invalid amounts to the kernel as 422", async () => {
		// 0 and 1.5 violate the kernel's amount domain; 9007199254740992 is
		// a finite JSON number outside the safe-integer range. All stay 422.
		for (const rawBody of [
			'{"amount":0}',
			'{"amount":1.5}',
			'{"amount":9007199254740992}',
		]) {
			const response = await call("/admin/issuances", {
				token: ADMIN_TOKEN(),
				rawBody,
			});
			expect(response.status).toBe(422);
			expect(await errorCode(response)).toBe("invalid_amount");
		}

		const { a, b } = await seedTransferPair();
		for (const amount of [0, 1.5]) {
			const response = await call("/internal/transfers", {
				token: DISCORD_TOKEN(),
				headers: { "Idempotency-Key": `nf-${crypto.randomUUID()}` },
				body: transferBody(a, b, amount),
			});
			expect(response.status).toBe(422);
			expect(await errorCode(response)).toBe("invalid_amount");
		}
	});
});

async function seedTransferPair(): Promise<{ a: string; b: string }> {
	const a = `ta-${crypto.randomUUID()}`;
	const b = `tb-${crypto.randomUUID()}`;
	await seedBound(`u-${a}`, a);
	await seedBound(`u-${b}`, b);
	await call("/admin/issuances", {
		token: ADMIN_TOKEN(),
		body: { amount: 100 },
	});
	await call("/admin/distributions", {
		token: ADMIN_TOKEN(),
		body: { issuer: ISSUER, subject: a, amount: 100 },
	});
	return { a, b };
}

describe("unexpected failure boundary", () => {
	/**
	 * An `Env` whose `COMMUNITY_STATE` binding explodes on acquisition —
	 * token secrets stay valid so authentication succeeds and the request
	 * reaches binding acquisition inside the guarded pipeline.
	 */
	function brokenEnv(): Env {
		return {
			ADMIN_API_TOKEN: env.ADMIN_API_TOKEN,
			DISCORD_ADAPTER_SERVICE_TOKEN: env.DISCORD_ADAPTER_SERVICE_TOKEN,
			COMMUNITY_STATE: {
				idFromName() {
					throw new Error("binding exploded — internal detail");
				},
				get() {
					throw new Error("binding exploded — internal detail");
				},
			},
		} as unknown as Env;
	}

	function adminRequest(path: string): Request {
		return new Request(`${ORIGIN}${path}`, {
			method: "GET",
			headers: { Authorization: `Bearer ${ADMIN_TOKEN()}` },
		});
	}

	it("still 404s unknown routes with a broken Env — matching precedes binding evaluation", async () => {
		const response = await handleRequest(
			new Request(`${ORIGIN}/no/such/route`, { method: "POST" }),
			brokenEnv(),
		);
		expect(response.status).toBe(404);
		expect(await errorCode(response)).toBe("not_found");
	});

	it("normalizes a COMMUNITY_STATE acquisition throw to 500 internal_error without detail", async () => {
		const response = await handleRequest(
			adminRequest("/admin/treasury/balance"),
			brokenEnv(),
		);
		expect(response.status).toBe(500);
		const text = await response.text();
		expect((JSON.parse(text) as { error: string }).error).toBe(
			"internal_error",
		);
		expect(text).not.toContain("binding exploded");
	});

	it("normalizes a route-facing stub rejection to 500 internal_error without detail", async () => {
		const rejectingStub = {
			adminTreasuryBalance() {
				return Promise.reject(new Error("storage exploded — internal detail"));
			},
		} as unknown as CommunityStateApi;
		const envWithRejectingStub = {
			ADMIN_API_TOKEN: env.ADMIN_API_TOKEN,
			DISCORD_ADAPTER_SERVICE_TOKEN: env.DISCORD_ADAPTER_SERVICE_TOKEN,
			COMMUNITY_STATE: {
				idFromName() {
					return {};
				},
				get() {
					return rejectingStub;
				},
			},
		} as unknown as Env;
		const response = await handleRequest(
			adminRequest("/admin/treasury/balance"),
			envWithRejectingStub,
		);
		expect(response.status).toBe(500);
		const text = await response.text();
		expect((JSON.parse(text) as { error: string }).error).toBe(
			"internal_error",
		);
		expect(text).not.toContain("storage exploded");
	});
});
