/**
 * The token exchange of the registration flow (issue #4 PR-4):
 * `POST {issuer}/token` with `client_secret_basic` and the exact
 * authorization-code form of the production OP contract.
 *
 * The Basic credential is built per the OP's contract: each of client id
 * and client secret is `application/x-www-form-urlencoded`-encoded
 * separately, the encodings joined with `:`, the result standard-base64
 * encoded, and the header emitted with the literal `Basic ` prefix. No
 * `client_id` goes into the form body.
 *
 * Fetch policy: a 10-second timeout and no redirect following — the issue
 * contract's `redirect: "error"` maps to `redirect: "manual"` on workerd
 * (`"error"` is unimplemented at the edge; `manual` never follows and the
 * `HTTP 200` requirement rejects any redirect response anyway). No retry:
 * a single exchange attempt per callback. Only `HTTP 200` + valid JSON +
 * a non-empty string `id_token` succeeds; `access_token` and every other
 * token field are dropped unread and never logged, persisted, or
 * returned.
 */

import { OIDC_REDIRECT_URI } from "./authorize";
import type { OidcConfig } from "./config";

const TOKEN_TIMEOUT_MS = 10_000;

/**
 * The exchange outcome: the minted `id_token` on success, or a bare
 * failure — no provider detail crosses this boundary (OP error text is
 * never echoed upstream).
 */
export type TokenExchangeResult =
	| { readonly ok: true; readonly idToken: string }
	| { readonly ok: false };

/** The `Authorization` header value for `client_secret_basic`. */
function basicCredentials(config: OidcConfig): string {
	const joined = `${encodeURIComponent(config.clientId)}:${encodeURIComponent(config.clientSecret)}`;
	return `Basic ${btoa(joined)}`;
}

/**
 * Exchanges the callback `code` at `{issuer}/token`. Any transport,
 * status, media, or payload anomaly resolves to `{ok: false}` — the
 * callback maps it to the generic failure page.
 */
export async function exchangeAuthorizationCode(
	config: OidcConfig,
	code: string,
	proofKeySecret: string,
): Promise<TokenExchangeResult> {
	let response: Response;
	try {
		response = await fetch(`${config.issuerUrl}/token`, {
			method: "POST",
			headers: {
				"Content-Type": "application/x-www-form-urlencoded",
				Authorization: basicCredentials(config),
			},
			body: new URLSearchParams({
				grant_type: "authorization_code",
				code,
				redirect_uri: OIDC_REDIRECT_URI,
				code_verifier: proofKeySecret,
			}),
			// `redirect: "error"` is unimplemented on workerd; `manual`
			// never follows, and the HTTP-200 requirement rejects 3xx.
			redirect: "manual",
			signal: AbortSignal.timeout(TOKEN_TIMEOUT_MS),
		});
	} catch {
		return { ok: false };
	}
	if (response.status !== 200) return { ok: false };
	let body: unknown;
	try {
		body = await response.json();
	} catch {
		return { ok: false };
	}
	if (typeof body !== "object" || body === null || Array.isArray(body)) {
		return { ok: false };
	}
	const idToken = (body as Record<string, unknown>)["id_token"];
	if (typeof idToken !== "string" || idToken === "") {
		return { ok: false };
	}
	return { ok: true, idToken };
}
