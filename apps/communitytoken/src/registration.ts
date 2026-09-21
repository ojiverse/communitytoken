/**
 * The public OIDC callback endpoint `GET /auth/oidc/callback` (issue #4
 * PR-4): strict query parsing, the Worker-side OIDC pipeline, and the
 * fixed static HTML pages. This route is public — no Bearer
 * authentication runs — and it never returns JSON, never redirects, and
 * never emits cookies; every outcome is a fixed static page with the
 * fixed security headers.
 *
 * Query grammar (the issue contract):
 *
 *   - exactly one 43-character base64url `state`;
 *   - success: exactly one non-empty `code` of at most 256 characters and
 *     no `error`;
 *   - OP failure: exactly one non-empty `error`, optional at-most-one
 *     `error_description`, and no `code`;
 *   - a duplicate `state`, `code`, `error`, or `error_description` is
 *     invalid;
 *   - unknown query parameters are ignored;
 *   - OP `error`/`error_description` text is never echoed.
 *
 * Outcome mapping:
 *
 *   completed (new or already-bound)              -> 200 success page
 *   unknown / expired / consumed / superseded     -> 410 expired page
 *   invalid callback query                        -> 400 failure page
 *   OP ?error                                     -> 400 failure page
 *   token / JWKS / ID-token failure               -> 400 failure page
 *   issuer / subject / nonce mismatch             -> 400 failure page
 *   unexpected exception                          -> 500 failure page
 *
 * The pipeline re-checks intent state at both sides of the external OIDC
 * work: the synchronous intent read runs before the token exchange, and
 * the completion RPC re-validates everything inside its own serialized
 * section. All async work — token exchange, JWKS retrieval, JWT
 * verification — happens between the two DO calls, never inside a
 * section.
 */

import type { CommunityStateApi } from "./http";
import {
	buildAuthorizationUrl,
	computeProofKeyChallenge,
	generateRegistrationSecrets,
	OIDC_REDIRECT_URI,
} from "./oidc/authorize";
import { readOidcConfig } from "./oidc/config";
import { verifyIdToken } from "./oidc/id-token";
import { exchangeAuthorizationCode } from "./oidc/token";

export { OIDC_REDIRECT_URI };

/** The 43-character unpadded base64url form every `state` must match. */
const STATE_PATTERN = /^[A-Za-z0-9_-]{43}$/;

const CODE_MAX_LENGTH = 256;

const PAGE_HEADERS: Record<string, string> = {
	"Content-Type": "text/html; charset=utf-8",
	"Cache-Control": "no-store",
	Pragma: "no-cache",
	"Content-Security-Policy":
		"default-src 'none'; base-uri 'none'; frame-ancestors 'none'",
	"Referrer-Policy": "no-referrer",
	"X-Content-Type-Options": "nosniff",
};

const SUCCESS_COPY = "Registration complete; return to Discord";
const EXPIRED_COPY = "registration link expired — run /register again";
const FAILURE_COPY =
	"Registration failed — return to Discord and run /register again";

function page(status: number, copy: string): Response {
	return new Response(
		`<!doctype html>\n<html lang="en">\n<head><meta charset="utf-8"><title>CommunityToken registration</title></head>\n<body><p>${copy}</p></body>\n</html>\n`,
		{ status, headers: PAGE_HEADERS },
	);
}

/** The success page (`200`). */
export function successPage(): Response {
	return page(200, SUCCESS_COPY);
}

/** The expired-link page (`410`) for unusable intents. */
export function expiredPage(): Response {
	return page(410, EXPIRED_COPY);
}

/**
 * The generic failure page: `400` for every expected failure branch and
 * `500` for unexpected exceptions and missing configuration — the same
 * fixed copy either way; nothing about the failure is exposed.
 */
export function failurePage(status: 400 | 500 = 400): Response {
	return page(status, FAILURE_COPY);
}

/**
 * The strictly-parsed callback query: a `success` branch carries the one
 * `state` and `code`; an `op-error` branch means the OP itself reported
 * failure; `invalid` covers every other shape. Duplicate known
 * parameters are always invalid.
 */
export type CallbackQuery =
	| { readonly type: "success"; readonly state: string; readonly code: string }
	| { readonly type: "op-error" }
	| { readonly type: "invalid" };

/**
 * Parses the callback query per the fixed grammar. Unknown parameters are
 * ignored; OP error text is captured nowhere — only the branch type
 * survives, so it cannot be echoed.
 */
export function parseCallbackQuery(url: URL): CallbackQuery {
	const states = url.searchParams.getAll("state");
	const codes = url.searchParams.getAll("code");
	const errors = url.searchParams.getAll("error");
	const descriptions = url.searchParams.getAll("error_description");
	if (
		states.length !== 1 ||
		codes.length > 1 ||
		errors.length > 1 ||
		descriptions.length > 1
	) {
		return { type: "invalid" };
	}
	const state = states[0] ?? "";
	if (!STATE_PATTERN.test(state)) return { type: "invalid" };
	const code = codes[0];
	const error = errors[0];
	if (error !== undefined) {
		if (code !== undefined || error === "") return { type: "invalid" };
		return { type: "op-error" };
	}
	if (descriptions.length === 1) return { type: "invalid" };
	if (code === undefined || code === "" || code.length > CODE_MAX_LENGTH) {
		return { type: "invalid" };
	}
	return { type: "success", state, code };
}

/**
 * The public callback handler (issue #4 PR-4): runs the fixed pipeline —
 * strict query parse, synchronous intent read, token exchange, JWKS +
 * ID-token verification, completion RPC — and maps every outcome onto the
 * fixed pages. Configuration failure renders the generic `500` page; an
 * unexpected exception likewise, via the route's error boundary.
 */
export async function handleOidcCallback(context: {
	readonly url: URL;
	readonly env: Env;
	readonly getStub: () => CommunityStateApi;
}): Promise<Response> {
	const query = parseCallbackQuery(context.url);
	if (query.type === "invalid") return failurePage(400);
	if (query.type === "op-error") return failurePage(400);

	const config = readOidcConfig(context.env);
	if (config === null) return failurePage(500);

	const intent = await context.getStub().getOidcRegistrationIntent(query.state);
	if (intent.type !== "active") return expiredPage();

	const exchanged = await exchangeAuthorizationCode(
		config,
		query.code,
		intent.proofKeySecret,
	);
	if (!exchanged.ok) return failurePage(400);

	const verified = await verifyIdToken(config, exchanged.idToken, {
		nonce: intent.nonce,
		expectedIssuer: intent.expectedIssuer,
		expectedSubject: intent.expectedSubject,
	});
	if (!verified.ok) return failurePage(400);

	const outcome = await context
		.getStub()
		.completeOidcRegistration(query.state, {
			issuer: verified.verifiedIssuer,
			subject: verified.verifiedSubject,
		});
	if (outcome.type === "completed") return successPage();
	if (outcome.reason === "mismatch") return failurePage(400);
	return expiredPage();
}

/**
 * Re-export for the route module: the authorization-request helpers the
 * `POST /api/v1/registration-intents` handler composes. Kept as a single
 * import surface so `http.ts` touches one registration module.
 */
export {
	buildAuthorizationUrl,
	computeProofKeyChallenge,
	generateRegistrationSecrets,
	readOidcConfig,
};
