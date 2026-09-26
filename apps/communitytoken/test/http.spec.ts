import { env, runInDurableObject, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import type { ExternalIdentity } from "../src/community-state";
import type { CommunityStateApi } from "../src/http";
import { handleRequest } from "../src/http";
import type { CommunityState } from "../src/index";
import {
	administrativeIssuer,
	bindIdentity,
	query,
	type SeededIdentity,
	seedIdentity,
} from "./support/seed";

/**
 * End-to-end coverage of the trusted core API through the Worker `fetch`
 * pipeline: routing (including the removed distribution/treasury routes),
 * authentication/authorization, wire validation, the fixed error taxonomy,
 * administrative ISSUE, user TRANSFER, the self-history projection, and the
 * idempotency contract — including that the replay record commits
 * atomically with the protected mutation.
 *
 * The Worker routes every request to the DO instance named "community";
 * tests seed identities on that same instance and use unique subjects per
 * test so shared state cannot collide. Bearer credentials come from the
 * test-pool bindings (`vitest.config.ts`), never from committed config.
 */

const ORIGIN = "https://token.ojiver.se";
const ISSUER = "https://discord.id.ojiver.se";
const OTHER_ISSUER = "https://other.id.example";

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

function seedBound(
	subject: string,
	issuer: string = ISSUER,
): Promise<SeededIdentity> {
	return seedIdentity(communityStub(), { issuer, subject });
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

function issueBody(
	subject: string,
	amount: number,
): { target: ExternalIdentity; amount: number } {
	return { target: { issuer: ISSUER, subject }, amount };
}

/** Administrative ISSUE through the real route; returns `transaction_id`. */
async function issue(subject: string, amount: number): Promise<string> {
	const response = await call("/api/v1/admin/issuances", {
		token: ADMIN_TOKEN(),
		headers: { "Idempotency-Key": `issue-${crypto.randomUUID()}` },
		body: issueBody(subject, amount),
	});
	expect(response.status).toBe(200);
	return ((await response.json()) as { transaction_id: string }).transaction_id;
}

/** User TRANSFER between two identities under `ISSUER`; returns `transaction_id`. */
function transfer(from: string, to: string, amount: number): Promise<string> {
	return transferAcross(from, { issuer: ISSUER, subject: to }, amount);
}

async function transferAcross(
	from: string,
	to: ExternalIdentity,
	amount: number,
): Promise<string> {
	const response = await call("/api/v1/transfers", {
		token: DISCORD_TOKEN(),
		headers: { "Idempotency-Key": `transfer-${crypto.randomUUID()}` },
		body: { from: { issuer: ISSUER, subject: from }, to, amount },
	});
	expect(response.status).toBe(200);
	return ((await response.json()) as { transaction_id: string }).transaction_id;
}

async function historyPage(
	subject: string,
	options: { limit?: number; cursor?: string | null } = {},
): Promise<{
	transactions: Array<Record<string, unknown>>;
	next_cursor: string | null;
}> {
	const response = await call("/api/v1/history", {
		token: DISCORD_TOKEN(),
		body: {
			issuer: ISSUER,
			subject,
			...(options.limit === undefined ? {} : { limit: options.limit }),
			...(options.cursor === undefined || options.cursor === null
				? {}
				: { cursor: options.cursor }),
		},
	});
	expect(response.status).toBe(200);
	return (await response.json()) as {
		transactions: Array<Record<string, unknown>>;
		next_cursor: string | null;
	};
}

async function issueCount(): Promise<number> {
	const [row] = await query<{ n: number }>(
		communityStub(),
		"SELECT COUNT(*) AS n FROM transactions WHERE kind = 'ISSUE'",
	);
	return row?.n ?? 0;
}

async function balanceOf(accountId: string): Promise<number> {
	const [row] = await query<{ balance: number }>(
		communityStub(),
		"SELECT balance FROM accounts WHERE id = ?",
		accountId,
	);
	if (row === undefined) throw new Error(`no account: ${accountId}`);
	return row.balance;
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
		for (const path of ["/", "/health", "/api/v1/unknown", "/api/v1/admin/x"]) {
			expect((await call(path)).status).toBe(404);
			expect(await errorCode(await call(path))).toBe("not_found");
		}
	});

	it("returns 404 for unknown paths even when authenticated", async () => {
		for (const path of ["/api/v1/nonexistent", "/unknown-surface"]) {
			expect((await call(path, { token: DISCORD_TOKEN() })).status).toBe(404);
		}
	});

	it("returns 404 for every former /internal/* and /admin/* route — no aliases", async () => {
		for (const [method, path] of [
			["POST", "/internal/balance"],
			["POST", "/internal/history"],
			["POST", "/internal/transfers"],
			["POST", "/admin/issuances"],
			["POST", "/admin/distributions"],
			["GET", "/admin/treasury/balance"],
			["GET", "/admin/treasury/history"],
		] as const) {
			const response = await call(path, { method, token: DISCORD_TOKEN() });
			expect(response.status).toBe(404);
			expect(await errorCode(response)).toBe("not_found");
		}
	});

	it("returns 404 not_found for the removed distribution and treasury routes, even for the admin caller", async () => {
		for (const [method, path] of [
			["POST", "/api/v1/admin/distributions"],
			["GET", "/api/v1/admin/treasury/balance"],
			["GET", "/api/v1/admin/treasury/history"],
			["POST", "/api/v1/admin/treasury/balance"],
		] as const) {
			const response = await call(path, {
				method,
				token: ADMIN_TOKEN(),
				...(method === "POST"
					? {
							body: { issuer: ISSUER, subject: "s", amount: 1 },
							headers: { "Idempotency-Key": crypto.randomUUID() },
						}
					: {}),
			});
			expect(response.status, `${method} ${path}`).toBe(404);
			expect(await errorCode(response)).toBe("not_found");
		}
	});

	it("returns 404 for the wrong method on a known path and for non-exact paths", async () => {
		expect((await call("/api/v1/balance", { method: "GET" })).status).toBe(404);
		expect(
			(
				await call("/api/v1/admin/issuances", {
					method: "GET",
					token: ADMIN_TOKEN(),
				})
			).status,
		).toBe(404);
		// No trailing-slash or case normalization.
		for (const path of ["/api/v1/balance/", "/Api/v1/balance"]) {
			expect((await call(path, { token: DISCORD_TOKEN() })).status).toBe(404);
		}
	});
});

describe("authentication and route-group authorization", () => {
	it("401s missing, malformed, and non-matching credentials", async () => {
		expect((await call("/api/v1/balance")).status).toBe(401);
		expect(
			(
				await call("/api/v1/balance", {
					headers: { Authorization: "Basic abc" },
				})
			).status,
		).toBe(401);
		expect(
			(await call("/api/v1/balance", { token: "wrong-token" })).status,
		).toBe(401);
		expect(await errorCode(await call("/api/v1/balance"))).toBe("unauthorized");
	});

	it("403s the adapter credential on administrative issuance — it cannot reach ISSUE", async () => {
		const subject = `adapter-${crypto.randomUUID()}`;
		const seeded = await seedBound(subject);
		const before = await issueCount();

		const response = await call("/api/v1/admin/issuances", {
			token: DISCORD_TOKEN(),
			headers: { "Idempotency-Key": crypto.randomUUID() },
			body: issueBody(subject, 1),
		});

		expect(response.status).toBe(403);
		expect(await errorCode(response)).toBe("forbidden");
		expect(await issueCount()).toBe(before);
		expect(await balanceOf(seeded.accountId)).toBe(0);
	});

	it("403s the admin credential on the adapter route group", async () => {
		const response = await call("/api/v1/balance", {
			token: ADMIN_TOKEN(),
			body: { issuer: ISSUER, subject: "x" },
		});
		expect(response.status).toBe(403);
		expect(await errorCode(response)).toBe("forbidden");
	});
});

describe("wire validation", () => {
	it("415s non-JSON media types on JSON routes", async () => {
		const response = await SELF.fetch(`${ORIGIN}/api/v1/balance`, {
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
		const withCharset = await SELF.fetch(`${ORIGIN}/api/v1/balance`, {
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
			const response = await call("/api/v1/balance", {
				token: DISCORD_TOKEN(),
				rawBody,
			});
			expect(response.status).toBe(400);
			expect(await errorCode(response)).toBe("invalid_request");
		}
		expect(
			(await call("/api/v1/balance", { token: DISCORD_TOKEN(), body: {} }))
				.status,
		).toBe(400);
	});

	it("rejects unknown fields, including nested objects", async () => {
		const top = await call("/api/v1/balance", {
			token: DISCORD_TOKEN(),
			body: { issuer: ISSUER, subject: "s", extra: 1 },
		});
		expect(top.status).toBe(400);
		expect(await errorCode(top)).toBe("invalid_request");

		const nested = await call("/api/v1/transfers", {
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

	it("rejects empty issuers/subjects and non-number amounts", async () => {
		for (const body of [
			{ issuer: "", subject: "s" },
			{ issuer: ISSUER, subject: 3 },
			{ issuer: ISSUER, subject: "s", amount: "5" },
		]) {
			const response = await call("/api/v1/balance", {
				token: DISCORD_TOKEN(),
				body,
			});
			expect(response.status).toBe(400);
			expect(await errorCode(response)).toBe("invalid_request");
		}
	});

	it("accepts only {target, amount} on administrative issuance — no legacy metadata or flat identity", async () => {
		for (const body of [
			{ amount: 5 },
			{ target: { issuer: ISSUER, subject: "s" }, amount: 5, metadata: "x" },
			{ issuer: ISSUER, subject: "s", amount: 5 },
			{ target: { issuer: ISSUER, subject: "" }, amount: 5 },
			{ target: { issuer: ISSUER, subject: "s", extra: 1 }, amount: 5 },
			{ target: "s", amount: 5 },
			{ target: { issuer: ISSUER, subject: "s" }, amount: "5" },
		]) {
			const response = await call("/api/v1/admin/issuances", {
				token: ADMIN_TOKEN(),
				headers: { "Idempotency-Key": crypto.randomUUID() },
				body,
			});
			expect(response.status, JSON.stringify(body)).toBe(400);
			expect(await errorCode(response)).toBe("invalid_request");
		}
	});

	it("rejects invalid limits and cursors with their own codes", async () => {
		for (const limit of [0, 101, 1.5, "50"]) {
			const response = await call("/api/v1/history", {
				token: DISCORD_TOKEN(),
				body: { issuer: ISSUER, subject: "s", limit },
			});
			expect(response.status).toBe(400);
			expect(await errorCode(response)).toBe("invalid_limit");
		}
		for (const cursor of ["abc", "-1", "1.5", 7]) {
			const response = await call("/api/v1/history", {
				token: DISCORD_TOKEN(),
				body: { issuer: ISSUER, subject: "s", cursor },
			});
			expect(response.status).toBe(400);
			expect(await errorCode(response)).toBe("invalid_cursor");
		}
	});

	it("ignores query parameters on POST routes", async () => {
		const subject = `q-${crypto.randomUUID()}`;
		await seedBound(subject);
		const response = await call("/api/v1/balance?ignored=yes", {
			token: DISCORD_TOKEN(),
			body: { issuer: ISSUER, subject },
		});
		expect(response.status).toBe(200);
	});
});

describe("idempotency-key validation", () => {
	it("requires a 1..255 Idempotency-Key on transfers and administrative issuance", async () => {
		for (const [path, token, body] of [
			["/api/v1/transfers", DISCORD_TOKEN(), transferBody("a", "b", 1)],
			["/api/v1/admin/issuances", ADMIN_TOKEN(), issueBody("a", 1)],
		] as const) {
			const missing = await call(path, { token, body });
			expect(missing.status, path).toBe(400);
			expect(await errorCode(missing)).toBe("idempotency_key_required");

			const empty = await call(path, {
				token,
				headers: { "Idempotency-Key": "" },
				body,
			});
			expect(empty.status, path).toBe(400);

			const tooLong = await call(path, {
				token,
				headers: { "Idempotency-Key": "x".repeat(256) },
				body,
			});
			expect(tooLong.status, path).toBe(400);
			expect(await errorCode(tooLong)).toBe("idempotency_key_required");
		}
	});

	it("ignores the header on read routes", async () => {
		const subject = `hdr-${crypto.randomUUID()}`;
		await seedBound(subject);
		const response = await call("/api/v1/balance", {
			token: DISCORD_TOKEN(),
			headers: { "Idempotency-Key": "not-required" },
			body: { issuer: ISSUER, subject },
		});
		expect(response.status).toBe(200);
	});
});

describe("application routes", () => {
	it("returns the bound identity's default-Account balance and 404s an unbound identity", async () => {
		const subject = `bal-${crypto.randomUUID()}`;
		await seedBound(subject);
		await issue(subject, 12);
		const response = await call("/api/v1/balance", {
			token: DISCORD_TOKEN(),
			body: { issuer: ISSUER, subject },
		});
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ balance: 12 });

		const unbound = await call("/api/v1/balance", {
			token: DISCORD_TOKEN(),
			body: { issuer: ISSUER, subject: `nobody-${crypto.randomUUID()}` },
		});
		expect(unbound.status).toBe(404);
		expect(await errorCode(unbound)).toBe("identity_not_bound");
	});

	it("returns self-history as primitive Transactions with direction and the unique same-issuer counterparty", async () => {
		const alice = `ha-${crypto.randomUUID()}`;
		const bob = `hb-${crypto.randomUUID()}`;
		await seedBound(alice);
		await seedBound(bob);
		const issued = await issue(alice, 50);
		const sent = await transfer(alice, bob, 5);
		const received = await transfer(bob, alice, 2);
		const self = await transfer(alice, alice, 1);

		const page = await historyPage(alice);

		expect(page.transactions).toEqual([
			{
				transaction_id: self,
				kind: "TRANSFER",
				amount: 1,
				committed_at: expect.any(Number),
				direction: "self",
				counterparty: { issuer: ISSUER, subject: alice },
			},
			{
				transaction_id: received,
				kind: "TRANSFER",
				amount: 2,
				committed_at: expect.any(Number),
				direction: "in",
				counterparty: { issuer: ISSUER, subject: bob },
			},
			{
				transaction_id: sent,
				kind: "TRANSFER",
				amount: 5,
				committed_at: expect.any(Number),
				direction: "out",
				counterparty: { issuer: ISSUER, subject: bob },
			},
			{
				transaction_id: issued,
				kind: "ISSUE",
				amount: 50,
				committed_at: expect.any(Number),
				direction: "in",
				counterparty: null,
			},
		]);
		expect(page.next_cursor).toBeNull();

		const unbound = await call("/api/v1/history", {
			token: DISCORD_TOKEN(),
			body: { issuer: ISSUER, subject: `none-${crypto.randomUUID()}` },
		});
		expect(unbound.status).toBe(404);
		expect(await errorCode(unbound)).toBe("identity_not_bound");
	});

	it("omits the counterparty when the other Principal has zero or several same-issuer bindings", async () => {
		const alice = `ca-${crypto.randomUUID()}`;
		const multi = `cm-${crypto.randomUUID()}`;
		const foreign = `cf-${crypto.randomUUID()}`;
		await seedBound(alice);
		const multiSeed = await seedBound(multi);
		await bindIdentity(communityStub(), multiSeed.principalId, {
			issuer: ISSUER,
			subject: `${multi}-alt`,
		});
		await seedBound(foreign, OTHER_ISSUER);
		await issue(alice, 10);
		await transfer(alice, multi, 1);
		await transferAcross(alice, { issuer: OTHER_ISSUER, subject: foreign }, 1);

		const page = await historyPage(alice);

		expect(page.transactions.slice(0, 2).map((t) => t["counterparty"])).toEqual(
			[null, null],
		);
	});

	it("never exposes internal Principal or Account identifiers", async () => {
		const alice = `ia-${crypto.randomUUID()}`;
		const bob = `ib-${crypto.randomUUID()}`;
		const aliceSeed = await seedBound(alice);
		const bobSeed = await seedBound(bob);
		await issue(alice, 10);
		await transfer(alice, bob, 3);

		const raw = JSON.stringify(await historyPage(alice));
		const issuer = await administrativeIssuer(communityStub());
		for (const internal of [
			aliceSeed.principalId,
			aliceSeed.accountId,
			bobSeed.principalId,
			bobSeed.accountId,
			issuer,
		]) {
			expect(raw).not.toContain(internal);
		}
	});

	it("paginates history newest-first by decimal cursor", async () => {
		const subject = `pg-${crypto.randomUUID()}`;
		const other = `po-${crypto.randomUUID()}`;
		await seedBound(subject);
		await seedBound(other);
		await issue(subject, 30);
		for (const amount of [1, 2, 3]) await transfer(subject, other, amount);

		const page1 = await historyPage(subject, { limit: 2 });
		expect(page1.transactions.map((t) => t["amount"])).toEqual([3, 2]);
		expect(page1.next_cursor).not.toBeNull();

		const page2 = await historyPage(subject, {
			limit: 100,
			cursor: page1.next_cursor,
		});
		expect(page2.transactions.map((t) => t["amount"])).toEqual([1, 30]);
		expect(page2.next_cursor).toBeNull();
	});

	it("registration-free reads and transfers never record an ISSUE", async () => {
		const a = `ni-${crypto.randomUUID()}`;
		const b = `nj-${crypto.randomUUID()}`;
		await seedBound(a);
		await seedBound(b);
		await issue(a, 5);
		const before = await issueCount();

		await call("/api/v1/balance", {
			token: DISCORD_TOKEN(),
			body: { issuer: ISSUER, subject: a },
		});
		await historyPage(a);
		await transfer(a, b, 5);

		expect(await issueCount()).toBe(before);
	});
});

describe("administrative issuance", () => {
	it("issues directly into the target's default Account with the administrative issuer Principal", async () => {
		const subject = `ai-${crypto.randomUUID()}`;
		const seeded = await seedBound(subject);

		const response = await call("/api/v1/admin/issuances", {
			token: ADMIN_TOKEN(),
			headers: { "Idempotency-Key": crypto.randomUUID() },
			body: issueBody(subject, 100),
		});

		expect(response.status).toBe(200);
		const body = (await response.json()) as { transaction_id: string };
		expect(Object.keys(body)).toEqual(["transaction_id"]);
		const [row] = await query<Record<string, unknown>>(
			communityStub(),
			"SELECT kind, issuer_principal_id, source_account_id, destination_account_id, amount FROM transactions WHERE id = ?",
			body.transaction_id,
		);
		expect(row).toEqual({
			kind: "ISSUE",
			issuer_principal_id: await administrativeIssuer(communityStub()),
			source_account_id: null,
			destination_account_id: seeded.accountId,
			amount: 100,
		});
		expect(await balanceOf(seeded.accountId)).toBe(100);
	});

	it("replays a duplicate delivery without duplicating supply", async () => {
		const subject = `ar-${crypto.randomUUID()}`;
		const seeded = await seedBound(subject);
		const key = `admin-${crypto.randomUUID()}`;
		const before = await issueCount();

		const first = await call("/api/v1/admin/issuances", {
			token: ADMIN_TOKEN(),
			headers: { "Idempotency-Key": key },
			body: issueBody(subject, 40),
		});
		const replay = await call("/api/v1/admin/issuances", {
			token: ADMIN_TOKEN(),
			headers: { "Idempotency-Key": key },
			body: issueBody(subject, 40),
		});

		expect(first.status).toBe(200);
		expect(replay.status).toBe(200);
		expect(await replay.json()).toEqual(await first.json());
		expect(await issueCount()).toBe(before + 1);
		expect(await balanceOf(seeded.accountId)).toBe(40);
		expect(await idempotencyRecordCount(key)).toBe(1);
	});

	it("409s a reused key with a different amount or a different target", async () => {
		const subject = `ac-${crypto.randomUUID()}`;
		const other = `ad-${crypto.randomUUID()}`;
		await seedBound(subject);
		const otherSeed = await seedBound(other);
		const key = `admin-${crypto.randomUUID()}`;
		await call("/api/v1/admin/issuances", {
			token: ADMIN_TOKEN(),
			headers: { "Idempotency-Key": key },
			body: issueBody(subject, 1),
		});

		for (const body of [issueBody(subject, 2), issueBody(other, 1)]) {
			const conflict = await call("/api/v1/admin/issuances", {
				token: ADMIN_TOKEN(),
				headers: { "Idempotency-Key": key },
				body,
			});
			expect(conflict.status).toBe(409);
			expect(await errorCode(conflict)).toBe("idempotency_key_reuse");
		}
		expect(await balanceOf(otherSeed.accountId)).toBe(0);
	});

	it("404s an unbound target and 422s a kernel rejection, recording neither", async () => {
		const subject = `ak-${crypto.randomUUID()}`;
		await seedBound(subject);
		const unboundKey = `u-${crypto.randomUUID()}`;
		const unbound = await call("/api/v1/admin/issuances", {
			token: ADMIN_TOKEN(),
			headers: { "Idempotency-Key": unboundKey },
			body: issueBody(`none-${crypto.randomUUID()}`, 1),
		});
		expect(unbound.status).toBe(404);
		expect(await errorCode(unbound)).toBe("identity_not_bound");
		expect(await idempotencyRecordCount(unboundKey)).toBe(0);

		const invalidKey = `i-${crypto.randomUUID()}`;
		const invalid = await call("/api/v1/admin/issuances", {
			token: ADMIN_TOKEN(),
			headers: { "Idempotency-Key": invalidKey },
			body: issueBody(subject, 0),
		});
		expect(invalid.status).toBe(422);
		expect(await errorCode(invalid)).toBe("invalid_amount");
		expect(await idempotencyRecordCount(invalidKey)).toBe(0);
	});
});

describe("internalTransfer idempotency", () => {
	it("commits the TRANSFER and its replay record atomically, then replays verbatim", async () => {
		const { a, b } = await seedTransferPair();
		const key = `idem-${crypto.randomUUID()}`;
		const body = transferBody(a, b, 25);

		const first = await call("/api/v1/transfers", {
			token: DISCORD_TOKEN(),
			headers: { "Idempotency-Key": key },
			body,
		});
		expect(first.status).toBe(200);
		const firstBody = (await first.json()) as {
			transaction_id: string;
			from_balance: number;
		};
		expect(firstBody.from_balance).toBe(75);
		const [row] = await query<{ kind: string; amount: number }>(
			communityStub(),
			"SELECT kind, amount FROM transactions WHERE id = ?",
			firstBody.transaction_id,
		);
		expect(row).toEqual({ kind: "TRANSFER", amount: 25 });

		// Mutation + record committed together.
		expect(await idempotencyRecordCount(key)).toBe(1);

		// A byte-identical replay returns the stored descriptor without
		// executing the mutation a second time.
		const replay = await call("/api/v1/transfers", {
			token: DISCORD_TOKEN(),
			headers: { "Idempotency-Key": key },
			body,
		});
		expect(replay.status).toBe(200);
		expect(await replay.json()).toEqual(firstBody);
		const balance = await call("/api/v1/balance", {
			token: DISCORD_TOKEN(),
			body: { issuer: ISSUER, subject: a },
		});
		expect(await balance.json()).toEqual({ balance: 75 });
	});

	it("409s a reused key with a different fingerprint", async () => {
		const { a, b } = await seedTransferPair();
		const key = `conflict-${crypto.randomUUID()}`;
		await call("/api/v1/transfers", {
			token: DISCORD_TOKEN(),
			headers: { "Idempotency-Key": key },
			body: transferBody(a, b, 10),
		});
		const conflict = await call("/api/v1/transfers", {
			token: DISCORD_TOKEN(),
			headers: { "Idempotency-Key": key },
			body: transferBody(a, b, 11),
		});
		expect(conflict.status).toBe(409);
		expect(await errorCode(conflict)).toBe("idempotency_key_reuse");
	});

	it("does not record expected non-mutating failures; the key stays retryable", async () => {
		const { a, b } = await seedTransferPair();
		const key = `retry-${crypto.randomUUID()}`;

		// Unbound recipient — an expected failure that consumes nothing.
		const failed = await call("/api/v1/transfers", {
			token: DISCORD_TOKEN(),
			headers: { "Idempotency-Key": key },
			body: transferBody(a, `ghost-${crypto.randomUUID()}`, 5),
		});
		expect(failed.status).toBe(404);
		expect(await errorCode(failed)).toBe("recipient_not_bound");
		expect(await idempotencyRecordCount(key)).toBe(0);

		// A kernel rejection leaves no record either.
		const rejected = await call("/api/v1/transfers", {
			token: DISCORD_TOKEN(),
			headers: { "Idempotency-Key": key },
			body: transferBody(a, b, 9_999_999),
		});
		expect(rejected.status).toBe(422);
		expect(await errorCode(rejected)).toBe("insufficient_balance");
		expect(await idempotencyRecordCount(key)).toBe(0);

		// The same key now executes normally.
		const retried = await call("/api/v1/transfers", {
			token: DISCORD_TOKEN(),
			headers: { "Idempotency-Key": key },
			body: transferBody(a, b, 5),
		});
		expect(retried.status).toBe(200);
		expect(await idempotencyRecordCount(key)).toBe(1);
	});

	it("404s an unbound sender and rejects a canonicalization failure", async () => {
		const { a } = await seedTransferPair();
		const unboundSender = await call("/api/v1/transfers", {
			token: DISCORD_TOKEN(),
			headers: { "Idempotency-Key": `s-${crypto.randomUUID()}` },
			body: transferBody(`ghost-${crypto.randomUUID()}`, a, 5),
		});
		expect(unboundSender.status).toBe(404);
		expect(await errorCode(unboundSender)).toBe("identity_not_bound");

		const loneSurrogate = await call("/api/v1/transfers", {
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
		const transferResponse = await call("/api/v1/transfers", {
			token: DISCORD_TOKEN(),
			headers: { "Idempotency-Key": `nf-${crypto.randomUUID()}` },
			rawBody:
				'{"from":{"issuer":"i","subject":"a"},"to":{"issuer":"i","subject":"b"},"amount":1e400}',
		});
		expect(transferResponse.status).toBe(400);
		expect(await errorCode(transferResponse)).toBe("invalid_request");

		for (const amount of ["1e400", "-1e400"]) {
			const issuance = await call("/api/v1/admin/issuances", {
				token: ADMIN_TOKEN(),
				headers: { "Idempotency-Key": `nf-${crypto.randomUUID()}` },
				rawBody: `{"target":{"issuer":"i","subject":"s"},"amount":${amount}}`,
			});
			expect(issuance.status).toBe(400);
			expect(await errorCode(issuance)).toBe("invalid_request");
		}
	});

	it("still passes finite but domain-invalid amounts to the kernel as 422", async () => {
		// 0 and 1.5 violate the kernel's amount domain; 9007199254740992 is
		// a finite JSON number outside the safe-integer range. All stay 422.
		const { a, b } = await seedTransferPair();
		for (const amount of ["0", "1.5", "9007199254740992"]) {
			const response = await call("/api/v1/admin/issuances", {
				token: ADMIN_TOKEN(),
				headers: { "Idempotency-Key": `nf-${crypto.randomUUID()}` },
				rawBody: `{"target":{"issuer":"${ISSUER}","subject":"${a}"},"amount":${amount}}`,
			});
			expect(response.status).toBe(422);
			expect(await errorCode(response)).toBe("invalid_amount");
		}

		for (const amount of [0, 1.5]) {
			const response = await call("/api/v1/transfers", {
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
	await seedBound(a);
	await seedBound(b);
	await issue(a, 100);
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

	/** A fully valid administrative issuance request. */
	function adminIssueRequest(): Request {
		return new Request(`${ORIGIN}/api/v1/admin/issuances`, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${ADMIN_TOKEN()}`,
				"Content-Type": "application/json",
				"Idempotency-Key": `broken-${crypto.randomUUID()}`,
			},
			body: JSON.stringify(issueBody("s", 1)),
		});
	}

	/**
	 * A `COMMUNITY_STATE` binding that counts `idFromName`/`get` calls and
	 * throws on either — used to prove a request reached the end of the
	 * Worker-side pipeline without touching the binding, or that the
	 * acquisition throw itself normalizes to 500.
	 */
	function countingBrokenEnv(): { env: Env; calls: { n: number } } {
		const calls = { n: 0 };
		const broken = {
			ADMIN_API_TOKEN: env.ADMIN_API_TOKEN,
			DISCORD_ADAPTER_SERVICE_TOKEN: env.DISCORD_ADAPTER_SERVICE_TOKEN,
			COMMUNITY_STATE: {
				idFromName() {
					calls.n += 1;
					throw new Error("binding exploded — internal detail");
				},
				get() {
					calls.n += 1;
					throw new Error("binding exploded — internal detail");
				},
			},
		} as unknown as Env;
		return { env: broken, calls };
	}

	function postRequest(path: string, init: RequestInit = {}): Request {
		const headers = new Headers(init.headers);
		headers.set("Authorization", `Bearer ${DISCORD_TOKEN()}`);
		return new Request(`${ORIGIN}${path}`, {
			method: "POST",
			...init,
			headers,
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

	it("never touches the binding for requests that fail before the DO call", async () => {
		const { env: broken, calls } = countingBrokenEnv();
		const json = { "Content-Type": "application/json" };
		const validTransferBody = JSON.stringify({
			from: { issuer: ISSUER, subject: "a" },
			to: { issuer: ISSUER, subject: "b" },
			amount: 1,
		});

		// 401: no bearer credential on a known route.
		const unauthenticated = await handleRequest(
			new Request(`${ORIGIN}/api/v1/balance`, { method: "POST" }),
			broken,
		);
		expect(unauthenticated.status).toBe(401);
		expect(await errorCode(unauthenticated)).toBe("unauthorized");

		// 403: an authenticated caller on the wrong route group — the
		// admin credential on a non-admin application route.
		const forbidden = await handleRequest(
			new Request(`${ORIGIN}/api/v1/balance`, {
				method: "POST",
				headers: {
					Authorization: `Bearer ${ADMIN_TOKEN()}`,
					...json,
				},
				body: "{}",
			}),
			broken,
		);
		expect(forbidden.status).toBe(403);
		expect(await errorCode(forbidden)).toBe("forbidden");

		// 415: authenticated JSON route with a non-JSON media type.
		const wrongMedia = await handleRequest(
			postRequest("/api/v1/balance", {
				headers: { "Content-Type": "text/plain" },
				body: "{}",
			}),
			broken,
		);
		expect(wrongMedia.status).toBe(415);
		expect(await errorCode(wrongMedia)).toBe("unsupported_media_type");

		// 400 invalid_request: malformed JSON on an authenticated JSON route.
		const malformed = await handleRequest(
			postRequest("/api/v1/balance", { headers: json, body: "{" }),
			broken,
		);
		expect(malformed.status).toBe(400);
		expect(await errorCode(malformed)).toBe("invalid_request");

		// 400 idempotency_key_required: valid transfer body, missing key.
		const noKey = await handleRequest(
			postRequest("/api/v1/transfers", {
				headers: json,
				body: validTransferBody,
			}),
			broken,
		);
		expect(noKey.status).toBe(400);
		expect(await errorCode(noKey)).toBe("idempotency_key_required");

		// 400 invalid_request: canonicalization failure (lone surrogate in
		// the parsed body) after a valid key is supplied.
		const loneSurrogate = await handleRequest(
			postRequest("/api/v1/transfers", {
				headers: {
					...json,
					"Idempotency-Key": `cf-${crypto.randomUUID()}`,
				},
				body: `{"from":{"issuer":"i","subject":"\\ud800"},"to":{"issuer":"i","subject":"t"},"amount":1}`,
			}),
			broken,
		);
		expect(loneSurrogate.status).toBe(400);
		expect(await errorCode(loneSurrogate)).toBe("invalid_request");

		// 400 invalid_limit / invalid_cursor: history with an invalid page
		// request — validation fails before the DO call.
		const badLimit = await handleRequest(
			postRequest("/api/v1/history", {
				headers: json,
				body: JSON.stringify({ issuer: ISSUER, subject: "s", limit: 0 }),
			}),
			broken,
		);
		expect(badLimit.status).toBe(400);
		expect(await errorCode(badLimit)).toBe("invalid_limit");
		const badCursor = await handleRequest(
			postRequest("/api/v1/history", {
				headers: json,
				body: JSON.stringify({ issuer: ISSUER, subject: "s", cursor: "abc" }),
			}),
			broken,
		);
		expect(badCursor.status).toBe(400);
		expect(await errorCode(badCursor)).toBe("invalid_cursor");

		// 400 idempotency_key_required: valid admin issuance, missing key.
		const adminNoKey = await handleRequest(
			new Request(`${ORIGIN}/api/v1/admin/issuances`, {
				method: "POST",
				headers: { Authorization: `Bearer ${ADMIN_TOKEN()}`, ...json },
				body: JSON.stringify(issueBody("s", 1)),
			}),
			broken,
		);
		expect(adminNoKey.status).toBe(400);
		expect(await errorCode(adminNoKey)).toBe("idempotency_key_required");

		// None of the above may have touched the COMMUNITY_STATE binding.
		expect(calls.n).toBe(0);
	});

	it("500s only after all Worker-side validation succeeds and acquisition throws", async () => {
		const { env: broken, calls } = countingBrokenEnv();
		const response = await handleRequest(
			postRequest("/api/v1/balance", {
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ issuer: ISSUER, subject: "s" }),
			}),
			broken,
		);
		expect(response.status).toBe(500);
		const text = await response.text();
		expect((JSON.parse(text) as { error: string }).error).toBe(
			"internal_error",
		);
		expect(text).not.toContain("binding exploded");
		// Validation fully passed, so acquisition was attempted exactly once.
		expect(calls.n).toBe(1);
	});

	it("normalizes a COMMUNITY_STATE acquisition throw to 500 internal_error without detail", async () => {
		const response = await handleRequest(adminIssueRequest(), brokenEnv());
		expect(response.status).toBe(500);
		const text = await response.text();
		expect((JSON.parse(text) as { error: string }).error).toBe(
			"internal_error",
		);
		expect(text).not.toContain("binding exploded");
	});

	it("normalizes a route-facing stub rejection to 500 internal_error without detail", async () => {
		const rejectingStub = {
			adminIssue() {
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
			adminIssueRequest(),
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
