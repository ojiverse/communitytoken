/**
 * ID-token verification for the registration flow (issue #4 PR-4):
 * compact-JWT parsing, JWK import, and RS256 signature verification via
 * `jose` — `createRemoteJWKSet` is deliberately not used because the
 * Worker owns the exact JWKS refresh policy of the issue contract.
 *
 * The JWKS cache is module-scoped isolate memory only — not durable
 * authority, no TTL, no proactive refresh. The selection algorithm is
 * fixed:
 *
 *   decode protected header
 *   -> require alg === "RS256"
 *   -> require non-empty kid
 *   -> if cache absent: fetch /jwks.json and replace cache
 *   -> lookup kid
 *   -> if absent: refetch exactly once and replace cache
 *   -> lookup again
 *   -> if still absent: reject
 *   -> if duplicate matching kid exists: reject malformed JWKS
 *   -> import selected RSA key
 *   -> verify the JWT exactly once
 *   -> on signature failure: reject, do not refetch
 *
 * A usable JWK requires: matching `kid`, `kty === "RSA"`, string `n`/`e`,
 * `use === "sig"` when present, `alg === "RS256"` when present.
 *
 * After the signature verifies, claims are checked against one wall-clock
 * sample: `iss` equals the configured issuer, `aud` is or contains the
 * client id, `exp`/`iat` are finite integer NumericDates with
 * `now <= exp + 60`, `iat <= now + 60`, `exp >= iat`, the nonce matches
 * the intent's exactly, `sub` is the non-empty expected subject, and the
 * intent's expected issuer equals the configured issuer. `at_hash` is
 * not validated in Phase 2; `azp` is not required; additional claims are
 * ignored.
 */

import {
	compactVerify,
	decodeProtectedHeader,
	importJWK,
	type JWK,
} from "jose";
import type { OidcConfig } from "./config";

const JWKS_TIMEOUT_MS = 10_000;
const CLOCK_TOLERANCE_SECONDS = 60;

/**
 * The issuer-scoped JWKS cache: isolate memory only. An issuer absent
 * from the map has never been fetched; a present value is the last
 * successfully parsed document (replaced wholesale on each fetch).
 */
const jwksCache = new Map<string, readonly JWK[]>();

/**
 * The intent the verified token must prove: the nonce minted for this
 * registration and the expected external identity it was created for.
 */
export type ExpectedIntent = {
	readonly nonce: string;
	readonly expectedIssuer: string;
	readonly expectedSubject: string;
};

/**
 * Verification outcome: the proven external identity — the token's exact
 * `iss`/`sub` — or a bare failure carrying no detail (OP and verification
 * failures are never echoed upstream).
 */
export type IdTokenResult =
	| {
			readonly ok: true;
			readonly verifiedIssuer: string;
			readonly verifiedSubject: string;
	  }
	| { readonly ok: false };

const FAIL: IdTokenResult = { ok: false };

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * `GET {issuer}/jwks.json`: 10-second timeout, no redirect following —
 * `redirect: "manual"` stands in for the issue contract's `redirect:
 * "error"` (unimplemented on workerd; the `HTTP 200` requirement rejects
 * any redirect response anyway) — plus a JSON object with an array `keys`
 * member whose elements are objects. Anything else is a malformed
 * document and returns `null`.
 */
async function fetchJwks(issuerUrl: string): Promise<readonly JWK[] | null> {
	let response: Response;
	try {
		response = await fetch(`${issuerUrl}/jwks.json`, {
			redirect: "manual",
			signal: AbortSignal.timeout(JWKS_TIMEOUT_MS),
		});
	} catch {
		return null;
	}
	if (response.status !== 200) return null;
	let body: unknown;
	try {
		body = await response.json();
	} catch {
		return null;
	}
	if (!isRecord(body) || !Array.isArray(body["keys"])) return null;
	if (!body["keys"].every((key) => isRecord(key))) return null;
	return body["keys"] as readonly JWK[];
}

/** The usable-JWK criteria of the JWKS selection contract. */
function usableJwk(key: JWK, kid: string): boolean {
	return (
		key.kid === kid &&
		key.kty === "RSA" &&
		typeof key.n === "string" &&
		typeof key.e === "string" &&
		(key.use === undefined || key.use === "sig") &&
		(key.alg === undefined || key.alg === "RS256")
	);
}

function matchingKeys(keys: readonly JWK[], kid: string): readonly JWK[] {
	return keys.filter((key) => usableJwk(key, kid));
}

/**
 * Verifies `idToken` against the configured issuer's JWKS and the intent's
 * expected nonce/identity. Every expected failure — malformed header,
 * unknown or duplicated `kid`, JWKS anomalies, signature failure, claim
 * mismatch — resolves to `{ok: false}`; nothing about the failure crosses
 * this boundary.
 */
export async function verifyIdToken(
	config: OidcConfig,
	idToken: string,
	intent: ExpectedIntent,
): Promise<IdTokenResult> {
	let kid: string;
	try {
		const header = decodeProtectedHeader(idToken);
		if (header.alg !== "RS256") return FAIL;
		if (typeof header.kid !== "string" || header.kid === "") return FAIL;
		kid = header.kid;
	} catch {
		return FAIL;
	}

	let keys = jwksCache.get(config.issuerUrl);
	if (keys === undefined) {
		const fetched = await fetchJwks(config.issuerUrl);
		if (fetched === null) return FAIL;
		keys = fetched;
		jwksCache.set(config.issuerUrl, keys);
	}
	let matching = matchingKeys(keys, kid);
	if (matching.length === 0) {
		const refetched = await fetchJwks(config.issuerUrl);
		if (refetched === null) return FAIL;
		jwksCache.set(config.issuerUrl, refetched);
		matching = matchingKeys(refetched, kid);
		if (matching.length === 0) return FAIL;
	}
	if (matching.length !== 1) return FAIL;

	let payload: Uint8Array;
	try {
		const key = await importJWK(matching[0] as JWK, "RS256");
		const verified = await compactVerify(idToken, key);
		payload = verified.payload;
	} catch {
		return FAIL;
	}

	let claims: unknown;
	try {
		claims = JSON.parse(new TextDecoder().decode(payload));
	} catch {
		return FAIL;
	}
	if (!isRecord(claims)) return FAIL;

	if (intent.expectedIssuer !== config.issuerUrl) return FAIL;
	if (claims["iss"] !== config.issuerUrl) return FAIL;

	const aud = claims["aud"];
	const audienceOk =
		aud === config.clientId ||
		(Array.isArray(aud) && aud.includes(config.clientId));
	if (!audienceOk) return FAIL;

	const exp = claims["exp"];
	const iat = claims["iat"];
	if (
		typeof exp !== "number" ||
		!Number.isInteger(exp) ||
		typeof iat !== "number" ||
		!Number.isInteger(iat)
	) {
		return FAIL;
	}
	const now = Math.floor(Date.now() / 1000);
	if (!(now <= exp + CLOCK_TOLERANCE_SECONDS)) return FAIL;
	if (!(iat <= now + CLOCK_TOLERANCE_SECONDS)) return FAIL;
	if (exp < iat) return FAIL;

	if (claims["nonce"] !== intent.nonce) return FAIL;

	const sub = claims["sub"];
	if (typeof sub !== "string" || sub === "" || sub !== intent.expectedSubject) {
		return FAIL;
	}

	return {
		ok: true,
		verifiedIssuer: config.issuerUrl,
		verifiedSubject: sub,
	};
}
