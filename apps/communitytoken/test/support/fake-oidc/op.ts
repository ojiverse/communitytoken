/**
 * The fake OIDC Provider used by the PR-4 registration tests (issue #4
 * D11): a real OP contract over the HTTP boundary — real RSA-2048 keys,
 * real RS256 ID tokens, real form parsing — served by the Miniflare
 * `outboundService` fetch handler wired in `vitest.config.ts`. Every
 * outbound `fetch` from the worker under test (and from test code itself)
 * arrives here, so the fixture observes exactly what the production code
 * puts on the wire.
 *
 * NOTE on the interception mechanism: the pinned
 * `@cloudflare/vitest-pool-workers` exposes no `fetchMock`, so this
 * fixture uses `miniflare`'s `outboundService` option — the same
 * subrequest-interception boundary `fetchMock` is built on. All OP
 * endpoints are path-suffixed (`{issuer}/authorize`, `{issuer}/token`,
 * `{issuer}/jwks.json`), so tests may use any HTTPS issuer URL, including
 * per-test issuer paths (e.g. `https://oidc.test/t/<id>`) that fully
 * isolate JWKS queues and issued-code state between tests.
 *
 * Code issuance: a real authorization code is a short opaque handle, so
 * tests register a `FakeCodeSpec` through `POST /__control` with
 * `{command: "issue"}` and receive a `code-N` handle — see `client.ts`
 * for the workerd-side helper. A spec carries the S256 challenge copied
 * from the authorization URL, the claims to mint (including `sub` and
 * `nonce`), and optional failure directives (`kid`, `corruptSig`,
 * `jwks`, `token`).
 */

import { exportJWK, generateKeyPair, type JWK, SignJWT } from "jose";

/** The client credentials the fake OP demands via `client_secret_basic`. */
export const FAKE_OIDC_CLIENT_ID = "test-oidc-client-id";
export const FAKE_OIDC_CLIENT_SECRET = "test-oidc-client-secret";

/** The fixed production callback URI the token exchange must present. */
export const OIDC_REDIRECT_URI = "https://token.ojiver.se/auth/oidc/callback";

/** A JWKS response queued for the next `{issuer}/jwks.json` GET. */
export type JwksDirective =
	| { readonly keys: readonly string[] }
	| { readonly raw: string; readonly status?: number };

/**
 * What a fabricated authorization code carries. `challenge` is the S256
 * challenge the OP recorded at authorize time (copied from the URL the
 * Worker emitted), `claims` overrides the minted ID-token claims on top of
 * the defaults, and the remaining fields steer failure injection.
 */
export type FakeCodeSpec = {
	readonly challenge: string;
	readonly claims: Record<string, unknown>;
	readonly kid?: string;
	readonly corruptSig?: boolean;
	readonly jwks?: readonly JwksDirective[];
	readonly token?: {
		readonly status?: number;
		readonly body?: Record<string, unknown>;
		readonly raw?: string;
	};
};

type OpKey = {
	readonly kid: string;
	readonly publicJwk: JWK;
	readonly privateKey: CryptoKey;
};

type FakeOpState = {
	readonly keys: Record<string, OpKey>;
	/** Specs issued through `__control`, keyed by the opaque code handle. */
	readonly issuedCodes: Map<string, FakeCodeSpec>;
	/** JWKS responses queued per issuer path prefix, consumed per GET. */
	readonly jwksQueues: Map<string, JwksDirective[]>;
	/** Codes already exchanged — authorization codes are single-use. */
	readonly consumedCodes: Set<string>;
	/** Per-issuer-prefix request counters for refresh-policy assertions. */
	readonly stats: Map<string, { jwksGets: number; tokenPosts: number }>;
	/** Parameters recorded by GET `{issuer}/authorize`. */
	readonly authorizations: Map<string, Record<string, string>>;
	/** Monotonic counter behind the `code-N` handles. */
	codeCounter: number;
};

let statePromise: Promise<FakeOpState> | undefined;

function base64url(bytes: Uint8Array): string {
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary)
		.replaceAll("+", "-")
		.replaceAll("/", "_")
		.replaceAll("=", "");
}

async function generateOpKey(kid: string): Promise<OpKey> {
	const { publicKey, privateKey } = await generateKeyPair("RS256", {
		modulusLength: 2048,
		extractable: true,
	});
	const publicJwk = await exportJWK(publicKey);
	publicJwk.kid = kid;
	publicJwk.use = "sig";
	publicJwk.alg = "RS256";
	return { kid, publicJwk, privateKey };
}

/**
 * Initializes the fixture once per Miniflare process: three RSA-2048
 * keypairs. `key-a` and `key-b` are published by the default JWKS
 * document; `key-z` is never published unless a directive lists it, so it
 * produces a permanently-unknown kid.
 */
function state(): Promise<FakeOpState> {
	statePromise ??= (async () => ({
		keys: {
			a: await generateOpKey("key-a"),
			b: await generateOpKey("key-b"),
			z: await generateOpKey("key-z"),
		},
		issuedCodes: new Map(),
		jwksQueues: new Map(),
		consumedCodes: new Set(),
		stats: new Map(),
		authorizations: new Map(),
		codeCounter: 0,
	}))();
	return statePromise;
}

function bump(
	op: FakeOpState,
	prefix: string,
	field: "jwksGets" | "tokenPosts",
): void {
	const entry = op.stats.get(prefix) ?? { jwksGets: 0, tokenPosts: 0 };
	entry[field]++;
	op.stats.set(prefix, entry);
}

function json(body: unknown, status = 200): Response {
	return Response.json(body, { status });
}

function opError(status: number, error: string, description: string): Response {
	return json({ error, error_description: description }, status);
}

/**
 * Parses an `application/x-www-form-urlencoded` body strictly, the way the
 * production OP does: duplicated parameters are rejected outright.
 */
function parseForm(
	raw: string,
): { ok: true; params: Map<string, string> } | { ok: false } {
	const params = new Map<string, string>();
	if (raw === "") return { ok: true, params };
	for (const pair of raw.split("&")) {
		const eq = pair.indexOf("=");
		const rawName = eq === -1 ? pair : pair.slice(0, eq);
		const rawValue = eq === -1 ? "" : pair.slice(eq + 1);
		const name = decodeURIComponent(rawName.replaceAll("+", " "));
		const value = decodeURIComponent(rawValue.replaceAll("+", " "));
		if (params.has(name)) return { ok: false };
		params.set(name, value);
	}
	return { ok: true, params };
}

/** The exact `Authorization` header value the OP requires. */
function expectedBasic(): string {
	const joined = `${encodeURIComponent(FAKE_OIDC_CLIENT_ID)}:${encodeURIComponent(FAKE_OIDC_CLIENT_SECRET)}`;
	return `Basic ${btoa(joined)}`;
}

async function sha256Base64url(value: string): Promise<string> {
	const digest = await crypto.subtle.digest(
		"SHA-256",
		new TextEncoder().encode(value),
	);
	return base64url(new Uint8Array(digest));
}

const CODE_VERIFIER_PATTERN = /^[A-Za-z0-9\-._~]{43,128}$/;

/**
 * `POST {issuer}/token`: validates the real OP contract — method, media
 * type, no duplicated parameters, `grant_type`, fixed `redirect_uri`,
 * `client_secret_basic` (each Basic component form-encoded), the PKCE
 * verifier shape, the S256 binding to the recorded challenge, and
 * single-use codes — then mints a real RS256 ID token.
 */
async function handleToken(
	request: Request,
	op: FakeOpState,
	issuer: string,
	prefix: string,
): Promise<Response> {
	bump(op, prefix, "tokenPosts");
	if (request.method !== "POST") {
		return opError(405, "invalid_request", "token endpoint requires POST");
	}
	const contentType = request.headers.get("Content-Type") ?? "";
	if (
		!contentType.toLowerCase().startsWith("application/x-www-form-urlencoded")
	) {
		return opError(400, "invalid_request", "expected form-urlencoded body");
	}
	if (request.headers.get("Authorization") !== expectedBasic()) {
		return opError(401, "invalid_client", "client authentication failed");
	}
	const form = parseForm(await request.text());
	if (!form.ok) {
		return opError(400, "invalid_request", "duplicated form parameter");
	}
	const params = form.params;
	if (params.get("grant_type") !== "authorization_code") {
		return opError(400, "invalid_request", "unsupported grant_type");
	}
	const code = params.get("code");
	if (code === undefined || code === "" || code.length > 256) {
		return opError(400, "invalid_request", "missing or oversized code");
	}
	if (params.get("redirect_uri") !== OIDC_REDIRECT_URI) {
		return opError(400, "invalid_grant", "redirect_uri mismatch");
	}
	const verifier = params.get("code_verifier");
	if (verifier === undefined || !CODE_VERIFIER_PATTERN.test(verifier)) {
		return opError(400, "invalid_request", "invalid code_verifier");
	}
	// The contract forbids `client_id` in the form body — authentication is
	// exclusively the Basic credential.
	if (params.get("client_id") !== undefined) {
		return opError(400, "invalid_request", "client_id must not be in the body");
	}
	if (op.consumedCodes.has(code)) {
		return opError(400, "invalid_grant", "authorization code already used");
	}
	op.consumedCodes.add(code);
	const spec = op.issuedCodes.get(code);
	if (spec === undefined) {
		return opError(400, "invalid_grant", "unknown authorization code");
	}
	if ((await sha256Base64url(verifier)) !== spec.challenge) {
		return opError(400, "invalid_grant", "PKCE verification failed");
	}
	if (spec.jwks !== undefined) {
		op.jwksQueues.set(prefix, [...spec.jwks]);
	}
	if (spec.token !== undefined) {
		const directive = spec.token;
		const status = directive.status ?? 200;
		if (directive.raw !== undefined) {
			return new Response(directive.raw, { status });
		}
		return json(directive.body ?? {}, status);
	}
	const claims = spec.claims ?? {};
	const subject = claims["sub"];
	if (typeof subject !== "string" || subject === "") {
		return opError(400, "invalid_grant", "code carries no subject");
	}
	const key = op.keys[spec.kid ?? "a"];
	if (key === undefined) {
		return opError(400, "invalid_grant", `unknown signing key ${spec.kid}`);
	}
	const nowSeconds = Math.floor(Date.now() / 1000);
	const payload: Record<string, unknown> = {
		iss: issuer,
		aud: FAKE_OIDC_CLIENT_ID,
		sub: subject,
		iat: nowSeconds,
		exp: nowSeconds + 600,
		at_hash: "fake-at-hash",
		...claims,
	};
	const unsigned = { alg: "RS256", kid: key.kid };
	let idToken = await new SignJWT(payload)
		.setProtectedHeader(unsigned)
		.sign(key.privateKey);
	if (spec.corruptSig === true) {
		// Corrupt the first signature character — the last character of a
		// 256-byte base64url signature carries only padding bits, so a
		// trailing-character flip would decode to identical bytes.
		const parts = idToken.split(".");
		const signature = parts[2] ?? "";
		const first = signature.at(0) ?? "a";
		parts[2] = `${first === "a" ? "b" : "a"}${signature.slice(1)}`;
		idToken = parts.join(".");
	}
	return json({
		access_token: "fake-access-token",
		token_type: "Bearer",
		expires_in: 600,
		scope: "openid",
		id_token: idToken,
	});
}

/**
 * `GET {issuer}/jwks.json`: serves the queued directive for this issuer
 * prefix when one was installed by a code's `jwks` field, otherwise the
 * default `{key-a, key-b}` document.
 */
async function handleJwks(op: FakeOpState, prefix: string): Promise<Response> {
	bump(op, prefix, "jwksGets");
	const queue = op.jwksQueues.get(prefix);
	const directive =
		queue !== undefined && queue.length > 0 ? queue.shift() : undefined;
	if (directive !== undefined && "raw" in directive) {
		return new Response(directive.raw, { status: directive.status ?? 200 });
	}
	const kids = directive !== undefined ? directive.keys : ["a", "b"];
	const keys = kids
		.map((kid) => op.keys[kid]?.publicJwk)
		.filter((jwk): jwk is JWK => jwk !== undefined);
	return json({ keys });
}

/**
 * `GET {issuer}/authorize`: records the authorization request parameters
 * (state, nonce, redirect URI, S256 challenge) like the production OP and
 * replies 200; the browser round-trip is outside the tested surface.
 */
function handleAuthorize(
	request: Request,
	op: FakeOpState,
	prefix: string,
): Response {
	const url = new URL(request.url);
	const recorded: Record<string, string> = {};
	for (const [name, value] of url.searchParams) recorded[name] = value;
	op.authorizations.set(`${prefix}|${recorded["state"] ?? ""}`, recorded);
	return new Response("authorize-ok", { status: 200 });
}

async function handleControl(
	request: Request,
	op: FakeOpState,
): Promise<Response> {
	let command: Record<string, unknown>;
	try {
		command = (await request.json()) as Record<string, unknown>;
	} catch {
		return json({ error: "invalid control body" }, 400);
	}
	switch (command["command"]) {
		case "reset":
			op.issuedCodes.clear();
			op.jwksQueues.clear();
			op.consumedCodes.clear();
			op.stats.clear();
			op.authorizations.clear();
			return json({ ok: true });
		case "issue": {
			const spec = command["spec"];
			if (
				typeof spec !== "object" ||
				spec === null ||
				typeof (spec as Record<string, unknown>)["challenge"] !== "string"
			) {
				return json({ error: "spec with a string challenge required" }, 400);
			}
			const code = `code-${op.codeCounter++}`;
			op.issuedCodes.set(code, spec as FakeCodeSpec);
			return json({ code });
		}
		case "stats": {
			const issuer = command["issuer"];
			if (typeof issuer !== "string")
				return json({ error: "issuer required" }, 400);
			const prefix = new URL(issuer).pathname;
			return json(op.stats.get(prefix) ?? { jwksGets: 0, tokenPosts: 0 });
		}
		case "jwks": {
			const issuer = command["issuer"];
			const items = command["items"];
			if (typeof issuer !== "string" || !Array.isArray(items)) {
				return json({ error: "issuer and items required" }, 400);
			}
			op.jwksQueues.set(new URL(issuer).pathname, items as JwksDirective[]);
			return json({ ok: true });
		}
		default:
			return json({ error: "unknown command" }, 400);
	}
}

/**
 * The Miniflare `outboundService` handler: receives every outbound
 * subrequest the worker under test (or test code) makes. Routes on the
 * pathname suffix so any issuer origin — including per-test issuer paths —
 * resolves the same way the production `{issuer}/token` and
 * `{issuer}/jwks.json` URLs do. Unknown paths return 404 so unexpected
 * outbound traffic fails visibly.
 */
export async function fakeOidcOutboundService(
	request: Request,
): Promise<Response> {
	const url = new URL(request.url);
	const op = await state();
	if (url.pathname === "/__control") {
		return handleControl(request, op);
	}
	for (const endpoint of ["token", "jwks.json", "authorize"] as const) {
		const suffix = `/${endpoint}`;
		if (url.pathname.endsWith(suffix)) {
			const prefix = url.pathname.slice(0, -suffix.length);
			const issuer = `${url.origin}${prefix}`;
			switch (endpoint) {
				case "token":
					return handleToken(request, op, issuer, prefix);
				case "jwks.json":
					return handleJwks(op, prefix);
				case "authorize":
					return handleAuthorize(request, op, prefix);
			}
		}
	}
	return new Response("fake-oidc: unhandled outbound request", {
		status: 404,
	});
}
