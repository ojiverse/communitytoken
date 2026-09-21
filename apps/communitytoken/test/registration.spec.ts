import { env, runInDurableObject, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import type { CommunityState } from "../src/index";
import {
	FAKE_OIDC_CLIENT_SECRET,
	fakeOpStats,
	issueAuthorizationCode,
	readAuthorizationParams,
} from "./support/fake-oidc/client";

/**
 * PR-4 end-to-end coverage of OIDC registration (issue #4): the
 * `POST /api/v1/registration-intents` trusted route and the public
 * `GET /auth/oidc/callback` protocol endpoint, exercised against the fake
 * OP that intercepts every outbound fetch (`miniflare.outboundService` —
 * the pinned pool has no `fetchMock`, so the equivalent subrequest
 * boundary is used).
 *
 * Each test installs a unique issuer (`https://oidc.test/t/<uuid>`): the
 * Worker's JWKS cache is module-scoped per issuer URL and the fake OP
 * keys its per-issuer state by URL prefix, so tests are fully isolated
 * without resets. The shared "community" DO instance likewise stays
 * collision-free through unique subjects.
 */

const ORIGIN = "https://token.ojiver.se";
const CALLBACK_PATH = "/auth/oidc/callback";
const REDIRECT_URI = `${ORIGIN}${CALLBACK_PATH}`;

const DISCORD_TOKEN = (): string => env.DISCORD_ADAPTER_SERVICE_TOKEN ?? "";
const ADMIN_TOKEN = (): string => env.ADMIN_API_TOKEN ?? "";

let ISSUER = "";

beforeEach(() => {
	ISSUER = `https://oidc.test/t/${crypto.randomUUID()}`;
	env.OIDC_ISSUER_URL = ISSUER;
});

function communityStub(): DurableObjectStub<CommunityState> {
	const id = env.COMMUNITY_STATE.idFromName("community");
	return env.COMMUNITY_STATE.get(id) as DurableObjectStub<CommunityState>;
}

function postIntents(init: {
	token?: string;
	key?: string;
	issuer?: string;
	subject?: string;
	rawBody?: string;
	headers?: Record<string, string>;
}): Promise<Response> {
	const headers = new Headers(init.headers);
	if (init.token !== undefined) {
		headers.set("Authorization", `Bearer ${init.token}`);
	}
	if (init.key !== undefined) {
		headers.set("Idempotency-Key", init.key);
	}
	headers.set("Content-Type", "application/json");
	const body =
		init.rawBody ??
		JSON.stringify({
			issuer: init.issuer ?? ISSUER,
			subject: init.subject ?? `sub-${crypto.randomUUID()}`,
		});
	return SELF.fetch(`${ORIGIN}/api/v1/registration-intents`, {
		method: "POST",
		headers,
		body,
	});
}

async function callback(query: string): Promise<Response> {
	return SELF.fetch(`${ORIGIN}${CALLBACK_PATH}?${query}`, {
		redirect: "manual",
	});
}

async function intentRow(
	state: string,
): Promise<Record<string, unknown> | null> {
	return runInDurableObject(communityStub(), async (_i, storage) => {
		const rows = storage.storage.sql
			.exec(
				"SELECT status, consumed_at FROM registration_intents WHERE state = ?",
				state,
			)
			.toArray();
		return (rows[0] as Record<string, unknown> | undefined) ?? null;
	});
}

async function bindingCount(issuer: string, subject: string): Promise<number> {
	return runInDurableObject(communityStub(), async (_i, storage) => {
		const row = storage.storage.sql
			.exec(
				"SELECT COUNT(*) AS n FROM identity_bindings WHERE issuer = ? AND subject = ?",
				issuer,
				subject,
			)
			.one();
		return Number(row["n"]);
	});
}

async function operationRowCount(): Promise<number> {
	return runInDurableObject(communityStub(), async (_i, storage) => {
		const row = storage.storage.sql
			.exec("SELECT COUNT(*) AS n FROM economic_operations")
			.one();
		return Number(row["n"]);
	});
}

async function idempotencyRecordCount(key: string): Promise<number> {
	return runInDurableObject(communityStub(), async (_i, storage) => {
		const row = storage.storage.sql
			.exec(
				"SELECT COUNT(*) AS n FROM idempotency_records WHERE idempotency_key = ?",
				key,
			)
			.one();
		return Number(row["n"]);
	});
}

type CreatedIntent = {
	readonly subject: string;
	readonly authorizationUrl: string;
	readonly state: string;
	readonly nonce: string;
	readonly challenge: string;
	readonly expiresAt: number;
};

/**
 * Drives the trusted creation route end-to-end and returns the parsed
 * authorization URL material the fake OP contract consumes.
 */
async function createIntent(
	subject = `sub-${crypto.randomUUID()}`,
	key = `ik-${crypto.randomUUID()}`,
): Promise<CreatedIntent> {
	const response = await postIntents({ token: DISCORD_TOKEN(), key, subject });
	expect(response.status).toBe(201);
	const body = (await response.json()) as {
		status: string;
		authorization_url: string;
		expires_at: number;
	};
	expect(body.status).toBe("created");
	const params = readAuthorizationParams(body.authorization_url);
	return {
		subject,
		authorizationUrl: body.authorization_url,
		state: params.get("state") ?? "",
		nonce: params.get("nonce") ?? "",
		challenge: params.get("code_challenge") ?? "",
		expiresAt: body.expires_at,
	};
}

/** Builds the success-branch callback URL the OP would redirect to. */
async function successCallbackUrl(
	state: string,
	spec: Parameters<typeof issueAuthorizationCode>[0],
): Promise<string> {
	const code = await issueAuthorizationCode(spec);
	return `state=${encodeURIComponent(state)}&code=${encodeURIComponent(code)}`;
}

function expectSecurityHeaders(response: Response): void {
	expect(response.headers.get("Content-Type")).toBe("text/html; charset=utf-8");
	expect(response.headers.get("Cache-Control")).toBe("no-store");
	expect(response.headers.get("Pragma")).toBe("no-cache");
	expect(response.headers.get("Content-Security-Policy")).toBe(
		"default-src 'none'; base-uri 'none'; frame-ancestors 'none'",
	);
	expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
	expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
	expect(response.headers.get("Set-Cookie")).toBeNull();
	expect(response.headers.get("Location")).toBeNull();
}

async function expectPage(
	response: Response,
	status: number,
	copy: string,
): Promise<string> {
	expect(response.status).toBe(status);
	expectSecurityHeaders(response);
	const text = await response.text();
	expect(text).toContain(copy);
	expect(text.toLowerCase()).toContain("<html");
	return text;
}

const SUCCESS_COPY = "Registration complete; return to Discord";
const EXPIRED_COPY = "registration link expired — run /register again";
const FAILURE_COPY =
	"Registration failed — return to Discord and run /register again";

describe("POST /api/v1/registration-intents", () => {
	it("creates an intent and returns the exact authorization URL", async () => {
		const subject = `sub-${crypto.randomUUID()}`;
		const before = Date.now();
		const response = await postIntents({
			token: DISCORD_TOKEN(),
			key: `ik-${crypto.randomUUID()}`,
			subject,
		});
		expect(response.status).toBe(201);
		const body = (await response.json()) as {
			status: string;
			authorization_url: string;
			expires_at: number;
		};
		expect(body.status).toBe("created");
		expect(body.expires_at).toBeGreaterThanOrEqual(before + 600_000);
		expect(body.expires_at).toBeLessThanOrEqual(Date.now() + 600_000);

		const url = new URL(body.authorization_url);
		expect(`${url.origin}${url.pathname}`).toBe(`${ISSUER}/authorize`);
		const p = url.searchParams;
		expect(p.get("response_type")).toBe("code");
		expect(p.get("client_id")).toBe(env.OIDC_CLIENT_ID);
		expect(p.get("redirect_uri")).toBe(REDIRECT_URI);
		expect(p.get("scope")).toBe("openid");
		expect(p.get("code_challenge_method")).toBe("S256");
		for (const name of ["state", "nonce", "code_challenge"]) {
			expect(p.get(name)).toMatch(/^[A-Za-z0-9_-]{43}$/);
		}
		// Exactly the eight fixed parameters — no policy parameters.
		expect([...p.keys()].sort()).toEqual(
			[
				"client_id",
				"code_challenge",
				"code_challenge_method",
				"nonce",
				"redirect_uri",
				"response_type",
				"scope",
				"state",
			].sort(),
		);
	});

	it("replays the exact stored authorization URL for the same idempotency key", async () => {
		const subject = `sub-${crypto.randomUUID()}`;
		const key = `ik-${crypto.randomUUID()}`;
		const first = await postIntents({ token: DISCORD_TOKEN(), key, subject });
		const firstBody = (await first.json()) as Record<string, unknown>;

		// A new interaction for the same identity supersedes the intent —
		// replay still returns the first response verbatim.
		const second = await postIntents({
			token: DISCORD_TOKEN(),
			key: `ik-${crypto.randomUUID()}`,
			subject,
		});
		expect(second.status).toBe(201);

		const replay = await postIntents({ token: DISCORD_TOKEN(), key, subject });
		expect(replay.status).toBe(201);
		expect(await replay.json()).toEqual(firstBody);
	});

	it("supersedes a prior active intent on a new interaction", async () => {
		const subject = `sub-${crypto.randomUUID()}`;
		const first = await createIntent(subject);
		await createIntent(subject);
		expect(await intentRow(first.state)).toMatchObject({
			status: "superseded",
			consumed_at: null,
		});
	});

	it("returns already_registered without mutating or recording a replay", async () => {
		const subject = `sub-${crypto.randomUUID()}`;
		const stub = communityStub();
		expect(await stub.createBoundUser(`u-${subject}`, ISSUER, subject)).toEqual(
			{ ok: true },
		);
		const key = `ik-${crypto.randomUUID()}`;
		const response = await postIntents({
			token: DISCORD_TOKEN(),
			key,
			subject,
		});
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ status: "already_registered" });
		expect(await idempotencyRecordCount(key)).toBe(0);
		await runInDurableObject(stub, async (_i, storage) => {
			const row = storage.storage.sql
				.exec(
					"SELECT COUNT(*) AS n FROM registration_intents WHERE expected_subject = ?",
					subject,
				)
				.one();
			expect(row["n"]).toBe(0);
		});
	});

	it("401s unauthenticated, 403s the wrong principal", async () => {
		expect(
			(
				await postIntents({
					subject: `sub-${crypto.randomUUID()}`,
					key: `ik-${crypto.randomUUID()}`,
				})
			).status,
		).toBe(401);
		const admin = await postIntents({
			token: ADMIN_TOKEN(),
			key: `ik-${crypto.randomUUID()}`,
			subject: `sub-${crypto.randomUUID()}`,
		});
		expect(admin.status).toBe(403);
	});

	it("400s a missing or oversized Idempotency-Key", async () => {
		for (const init of [
			{ token: DISCORD_TOKEN() },
			{
				token: DISCORD_TOKEN(),
				key: "x".repeat(256),
			},
		]) {
			const response = await postIntents({
				...init,
				subject: `sub-${crypto.randomUUID()}`,
			});
			expect(response.status).toBe(400);
			const body = (await response.json()) as { error: string };
			expect(body.error).toBe("idempotency_key_required");
		}
	});

	it("400s a body issuer that is not the configured trusted issuer", async () => {
		const response = await postIntents({
			token: DISCORD_TOKEN(),
			key: `ik-${crypto.randomUUID()}`,
			issuer: "https://other.example.com",
			subject: `sub-${crypto.randomUUID()}`,
		});
		expect(response.status).toBe(400);
		expect(((await response.json()) as { error: string }).error).toBe(
			"invalid_request",
		);
	});

	it("409s a reused key with a different fingerprint", async () => {
		const key = `ik-${crypto.randomUUID()}`;
		const subject = `sub-${crypto.randomUUID()}`;
		await postIntents({ token: DISCORD_TOKEN(), key, subject });
		const conflict = await postIntents({
			token: DISCORD_TOKEN(),
			key,
			subject: `other-${crypto.randomUUID()}`,
		});
		expect(conflict.status).toBe(409);
		expect(((await conflict.json()) as { error: string }).error).toBe(
			"idempotency_key_reuse",
		);
	});

	it("500s JSON internal_error when OIDC configuration is missing", async () => {
		env.OIDC_CLIENT_SECRET = "";
		try {
			const response = await postIntents({
				token: DISCORD_TOKEN(),
				key: `ik-${crypto.randomUUID()}`,
				subject: `sub-${crypto.randomUUID()}`,
			});
			expect(response.status).toBe(500);
			const text = await response.text();
			expect((JSON.parse(text) as { error: string }).error).toBe(
				"internal_error",
			);
		} finally {
			env.OIDC_CLIENT_SECRET = FAKE_OIDC_CLIENT_SECRET;
		}
	});
});

describe("GET /auth/oidc/callback", () => {
	it("completes registration: success page, bound user, consumed intent", async () => {
		const operationsBefore = await operationRowCount();
		const intent = await createIntent();
		const response = await callback(
			await successCallbackUrl(intent.state, {
				challenge: intent.challenge,
				claims: { sub: intent.subject, nonce: intent.nonce },
			}),
		);
		await expectPage(response, 200, SUCCESS_COPY);
		expect(await intentRow(intent.state)).toMatchObject({
			status: "consumed",
		});
		expect(await bindingCount(ISSUER, intent.subject)).toBe(1);
		// Registration creates no EconomicOperation and no actor.
		expect(await operationRowCount()).toBe(operationsBefore);

		// The completed registration is usable through the trusted API.
		const balance = await SELF.fetch(`${ORIGIN}/api/v1/balance`, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${DISCORD_TOKEN()}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ issuer: ISSUER, subject: intent.subject }),
		});
		expect(balance.status).toBe(200);
		expect(await balance.json()).toEqual({ balance: 0 });
	});

	it("resolves an already-bound identity without duplicating user/wallet/binding", async () => {
		const intent = await createIntent();
		const stub = communityStub();
		expect(
			await stub.createBoundUser(`u-${intent.subject}`, ISSUER, intent.subject),
		).toEqual({ ok: true });
		const response = await callback(
			await successCallbackUrl(intent.state, {
				challenge: intent.challenge,
				claims: { sub: intent.subject, nonce: intent.nonce },
			}),
		);
		await expectPage(response, 200, SUCCESS_COPY);
		expect(await intentRow(intent.state)).toMatchObject({
			status: "consumed",
		});
		expect(await bindingCount(ISSUER, intent.subject)).toBe(1);
		await runInDurableObject(stub, async (_i, storage) => {
			const row = storage.storage.sql
				.exec(
					"SELECT COUNT(*) AS n FROM wallets WHERE owner_user_id = ?",
					`u-${intent.subject}`,
				)
				.one();
			expect(row["n"]).toBe(1);
		});
	});

	it("rejects a wrong-subject proof without consuming the intent", async () => {
		const intent = await createIntent();
		const response = await callback(
			await successCallbackUrl(intent.state, {
				challenge: intent.challenge,
				claims: {
					sub: `other-${crypto.randomUUID()}`,
					nonce: intent.nonce,
				},
			}),
		);
		await expectPage(response, 400, FAILURE_COPY);
		expect(await intentRow(intent.state)).toMatchObject({
			status: "active",
			consumed_at: null,
		});
		expect(await bindingCount(ISSUER, intent.subject)).toBe(0);
	});

	it("410s expired, consumed, superseded, and unknown states", async () => {
		// Consumed: complete once, then replay the callback.
		const done = await createIntent();
		await callback(
			await successCallbackUrl(done.state, {
				challenge: done.challenge,
				claims: { sub: done.subject, nonce: done.nonce },
			}),
		);
		const replayed = await callback(`state=${done.state}&code=x`);
		await expectPage(replayed, 410, EXPIRED_COPY);

		// Superseded: a newer intent replaced this one.
		const subject = `sub-${crypto.randomUUID()}`;
		const old = await createIntent(subject);
		await createIntent(subject);
		const superseded = await callback(`state=${old.state}&code=x`);
		await expectPage(superseded, 410, EXPIRED_COPY);

		// Expired: an active row whose expires_at is in the past — seeded
		// directly because the production CHECK pins expires_at to
		// created_at + 600000, so both timestamps sit in the past.
		const expiredState = "e".repeat(43);
		await runInDurableObject(communityStub(), async (_i, storage) => {
			storage.storage.sql.exec(
				"INSERT INTO registration_intents (id, expected_issuer, expected_subject, state, nonce, pkce_verifier, status, created_at, expires_at, consumed_at) VALUES (?, ?, ?, ?, 'n', 'v', 'active', ?, ?, NULL)",
				crypto.randomUUID(),
				ISSUER,
				`sub-${crypto.randomUUID()}`,
				expiredState,
				Date.now() - 700_000,
				Date.now() - 100_000,
			);
		});
		const expired = await callback(`state=${expiredState}&code=x`);
		await expectPage(expired, 410, EXPIRED_COPY);

		// Unknown state (well-formed but never issued).
		const unknown = await callback(
			`state=${"a".repeat(43)}&code=${await issueAuthorizationCode({
				challenge: "x",
				claims: { sub: "s", nonce: "n" },
			})}`,
		);
		await expectPage(unknown, 410, EXPIRED_COPY);
	});

	it("400s malformed, duplicate, or contradictory query parameters", async () => {
		const validState = "a".repeat(43);
		for (const query of [
			"", // nothing
			`code=x`, // no state
			`state=short&code=x`, // malformed state
			`state=${validState}`, // neither code nor error
			`state=${validState}&state=${validState}&code=x`, // duplicate state
			`state=${validState}&code=a&code=b`, // duplicate code
			`state=${validState}&error=e&error=f`, // duplicate error
			`state=${validState}&code=x&error=e`, // code + error together
			`state=${validState}&error_description=d`, // description without error
			`state=${validState}&code=${"c".repeat(257)}`, // oversized code
		]) {
			const response = await callback(query);
			await expectPage(response, 400, FAILURE_COPY);
		}
	});

	it("400s an OP error branch without echoing provider text", async () => {
		const validState = "a".repeat(43);
		const response = await callback(
			`state=${validState}&error=access_denied&error_description=secret-op-text`,
		);
		const text = await expectPage(response, 400, FAILURE_COPY);
		expect(text).not.toContain("access_denied");
		expect(text).not.toContain("secret-op-text");
	});

	it("ignores unknown query parameters and any Authorization header", async () => {
		const intent = await createIntent();
		const response = await SELF.fetch(
			`${ORIGIN}${CALLBACK_PATH}?${await successCallbackUrl(intent.state, {
				challenge: intent.challenge,
				claims: { sub: intent.subject, nonce: intent.nonce },
			})}&unknown=ignored`,
			{
				headers: { Authorization: "Bearer bogus" },
				redirect: "manual",
			},
		);
		await expectPage(response, 200, SUCCESS_COPY);
	});

	it("400s token exchange failures", async () => {
		const intent = await createIntent();
		for (const token of [
			{ status: 500, body: { error: "server_error" } },
			{ raw: "<html>not json</html>" },
			{ body: { access_token: "x" } }, // no id_token
		] as const) {
			const response = await callback(
				await successCallbackUrl(intent.state, {
					challenge: intent.challenge,
					claims: { sub: intent.subject, nonce: intent.nonce },
					token,
				}),
			);
			await expectPage(response, 400, FAILURE_COPY);
		}
		// The intent is still active — proof failure never consumes it.
		expect(await intentRow(intent.state)).toMatchObject({ status: "active" });
	});

	it("400s nonce and issuer mismatches", async () => {
		const wrongNonce = await createIntent();
		const nonceMismatch = await callback(
			await successCallbackUrl(wrongNonce.state, {
				challenge: wrongNonce.challenge,
				claims: { sub: wrongNonce.subject, nonce: "forged-nonce" },
			}),
		);
		await expectPage(nonceMismatch, 400, FAILURE_COPY);

		const wrongIss = await createIntent();
		const issMismatch = await callback(
			await successCallbackUrl(wrongIss.state, {
				challenge: wrongIss.challenge,
				claims: {
					sub: wrongIss.subject,
					nonce: wrongIss.nonce,
					iss: "https://attacker.example.com",
				},
			}),
		);
		await expectPage(issMismatch, 400, FAILURE_COPY);
	});
});

describe("JWKS cache and ID-token validation", () => {
	it("refetches JWKS exactly once for an unknown kid and succeeds", async () => {
		const intent = await createIntent();
		const response = await callback(
			await successCallbackUrl(intent.state, {
				challenge: intent.challenge,
				claims: { sub: intent.subject, nonce: intent.nonce },
				kid: "b",
				jwks: [{ keys: ["a"] }, { keys: ["a", "b"] }],
			}),
		);
		await expectPage(response, 200, SUCCESS_COPY);
		expect(await fakeOpStats(ISSUER)).toMatchObject({ jwksGets: 2 });
	});

	it("rejects a permanently-unknown kid after one refetch", async () => {
		const intent = await createIntent();
		const response = await callback(
			await successCallbackUrl(intent.state, {
				challenge: intent.challenge,
				claims: { sub: intent.subject, nonce: intent.nonce },
				kid: "z",
			}),
		);
		await expectPage(response, 400, FAILURE_COPY);
		expect(await fakeOpStats(ISSUER)).toMatchObject({ jwksGets: 2 });
	});

	it("rejects a known-kid signature failure without refetching", async () => {
		const intent = await createIntent();
		const response = await callback(
			await successCallbackUrl(intent.state, {
				challenge: intent.challenge,
				claims: { sub: intent.subject, nonce: intent.nonce },
				kid: "a",
				corruptSig: true,
			}),
		);
		await expectPage(response, 400, FAILURE_COPY);
		expect(await fakeOpStats(ISSUER)).toMatchObject({ jwksGets: 1 });
	});

	it("rejects malformed and duplicate-kid JWKS documents", async () => {
		const malformed = await createIntent();
		const first = await callback(
			await successCallbackUrl(malformed.state, {
				challenge: malformed.challenge,
				claims: { sub: malformed.subject, nonce: malformed.nonce },
				jwks: [{ raw: "not json at all" }],
			}),
		);
		await expectPage(first, 400, FAILURE_COPY);

		const duplicate = await createIntent();
		const second = await callback(
			await successCallbackUrl(duplicate.state, {
				challenge: duplicate.challenge,
				claims: { sub: duplicate.subject, nonce: duplicate.nonce },
				jwks: [{ keys: ["a", "a"] }],
			}),
		);
		await expectPage(second, 400, FAILURE_COPY);
	});

	it("rejects expired, not-yet-valid, and wrong-audience tokens", async () => {
		const nowSeconds = Math.floor(Date.now() / 1000);
		for (const claims of [
			{ exp: nowSeconds - 600, iat: nowSeconds - 1200 }, // expired
			{ iat: nowSeconds + 3600 }, // issued in the future
			{ aud: "some-other-client" }, // wrong audience
		]) {
			const intent = await createIntent();
			const response = await callback(
				await successCallbackUrl(intent.state, {
					challenge: intent.challenge,
					claims: {
						sub: intent.subject,
						nonce: intent.nonce,
						...claims,
					},
				}),
			);
			await expectPage(response, 400, FAILURE_COPY);
		}
	});
});
