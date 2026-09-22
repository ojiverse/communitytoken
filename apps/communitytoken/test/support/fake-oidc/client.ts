/**
 * Worker-safe helpers for driving the fake OIDC Provider from spec files.
 * Authorization codes are short opaque handles: a `FakeCodeSpec` is
 * registered through the OP's `/__control` endpoint and exchanged at
 * `POST {issuer}/token` (wired as Miniflare's `outboundService`). These
 * helpers deliberately use only standard web APIs so they work inside
 * the workers pool.
 *
 * Every spec should use a unique per-test issuer (e.g.
 * `https://oidc.test/t/<uuid>`), which isolates the fake OP's JWKS queue
 * and stats — and, because the Worker caches JWKS per issuer, isolates
 * the JWKS cache too.
 */

import type { FakeCodeSpec } from "./op";

export type { FakeCodeSpec, JwksDirective } from "./op";
export {
	FAKE_OIDC_CLIENT_ID,
	FAKE_OIDC_CLIENT_SECRET,
	OIDC_REDIRECT_URI,
} from "./op";

/**
 * Registers a code spec with the fake OP and returns the issued opaque
 * `code-N` handle, like a real OP issuing an authorization code after
 * the authorize redirect. Goes through the global fetch — the same
 * `outboundService` interception the worker's own fetches use.
 */
export async function issueAuthorizationCode(
	spec: FakeCodeSpec,
): Promise<string> {
	const response = await fetch("https://oidc.test/__control", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ command: "issue", spec }),
	});
	const body = (await response.json()) as { code?: unknown };
	if (typeof body.code !== "string") {
		throw new Error("fake OP did not issue a code");
	}
	return body.code;
}

/**
 * Extracts the parameters the Worker put on the authorization URL it
 * returned in a `201` registration response.
 */
export function readAuthorizationParams(
	authorizationUrl: string,
): URLSearchParams {
	return new URL(authorizationUrl).searchParams;
}

/** Request counters the fake OP keeps per issuer path prefix. */
export type FakeOpStats = {
	readonly jwksGets: number;
	readonly tokenPosts: number;
};

/**
 * Reads the fake OP's per-issuer counters. Goes through the global fetch —
 * the same `outboundService` interception the worker's own fetches use.
 */
export async function fakeOpStats(issuer: string): Promise<FakeOpStats> {
	const response = await fetch("https://oidc.test/__control", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ command: "stats", issuer }),
	});
	return (await response.json()) as FakeOpStats;
}
