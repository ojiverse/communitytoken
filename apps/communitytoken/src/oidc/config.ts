/**
 * Central validation of the OIDC environment triple (issue #4 PR-4): all
 * three values must be present and non-empty and the issuer must be an
 * absolute HTTPS URL with no query, fragment, or trailing slash. Anything
 * less fails closed — `readOidcConfig` returns `null` and the caller maps
 * that to its route's fixed `500` rendering (JSON `internal_error` on the
 * API, the generic HTML page on the callback) without identifying which
 * field was missing.
 *
 * `clientSecret` is Worker-only credential material: the validated config
 * is consumed exclusively by Worker OIDC code and is never passed into a
 * Durable Object method.
 */

export type OidcConfig = {
	/** The configured trusted issuer URL — the `{issuer}` every OP endpoint hangs off. */
	readonly issuerUrl: string;
	/** The registered client identifier (`aud` in minted ID tokens). */
	readonly clientId: string;
	/** The client credential for `client_secret_basic` token exchange. */
	readonly clientSecret: string;
};

/**
 * Validates the raw `Env` bindings and returns the OIDC configuration, or
 * `null` when any value is missing, empty, or malformed — the fail-closed
 * contract. No detail about which field failed is exposed.
 */
export function readOidcConfig(env: {
	readonly OIDC_ISSUER_URL?: string;
	readonly OIDC_CLIENT_ID?: string;
	readonly OIDC_CLIENT_SECRET?: string;
}): OidcConfig | null {
	const issuer = env.OIDC_ISSUER_URL;
	const clientId = env.OIDC_CLIENT_ID;
	const clientSecret = env.OIDC_CLIENT_SECRET;
	if (
		issuer === undefined ||
		issuer === "" ||
		clientId === undefined ||
		clientId === "" ||
		clientSecret === undefined ||
		clientSecret === ""
	) {
		return null;
	}
	let url: URL;
	try {
		url = new URL(issuer);
	} catch {
		return null;
	}
	if (
		url.protocol !== "https:" ||
		url.username !== "" ||
		url.password !== "" ||
		url.search !== "" ||
		url.hash !== "" ||
		issuer.endsWith("/")
	) {
		return null;
	}
	return { issuerUrl: issuer, clientId, clientSecret };
}
