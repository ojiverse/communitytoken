/**
 * Service authentication at the Worker boundary (issue #4 PR-3, the
 * authentication/delegation specification): verifies the `Authorization:
 * Bearer <token>` credential against the configured service tokens and
 * asserts a service principal. Bearer bytes are consumed only here — the
 * asserted principal, never the credential, is what route-facing
 * `CommunityState` methods receive.
 *
 * Comparison policy: the presented credential and each configured
 * credential are SHA-256 hashed and the equal-length digests compared with
 * `crypto.subtle.timingSafeEqual` — the constant-time claim applies to the
 * final digest comparison, not the whole request path. An unset or empty
 * configured credential is never a candidate, and if both configured
 * credentials match the presented one (including equal configured
 * secrets), authentication is ambiguous and fails closed with no
 * principal.
 */

import { ADMIN_API_PRINCIPAL } from "@communitytoken/application";

/** The service principal bound to `DISCORD_ADAPTER_SERVICE_TOKEN`. */
export const DISCORD_ADAPTER_PRINCIPAL = "discord-adapter";

/**
 * The authenticated service principals of Phase 2 — exactly the two
 * configured bearer credentials (the authentication/delegation
 * specification).
 */
export type ServicePrincipal =
	| typeof DISCORD_ADAPTER_PRINCIPAL
	| typeof ADMIN_API_PRINCIPAL;

/**
 * The configured service credentials: raw `Env` secret values, each
 * possibly unset. Verification treats unset and empty identically — such a
 * credential never matches.
 */
export type ServiceCredentials = {
	readonly adminApiToken: string | undefined;
	readonly discordAdapterToken: string | undefined;
};

function sha256(value: string): Promise<ArrayBuffer> {
	return crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
}

/**
 * Authenticates the request's `Authorization` header and returns the
 * asserted service principal, or `null` when authentication fails —
 * missing/malformed header, no credential match, or an ambiguous match
 * (both configured credentials equal the presented one), which fails
 * closed rather than guessing a principal.
 *
 * The Bearer scheme is parsed case-insensitively; the credential is the
 * remainder of the header verbatim, untrimmed and unnormalized.
 */
export async function authenticate(
	request: Request,
	credentials: ServiceCredentials,
): Promise<ServicePrincipal | null> {
	const header = request.headers.get("Authorization");
	if (header === null) return null;
	if (header.slice(0, 7).toLowerCase() !== "bearer ") return null;
	const presented = header.slice(7);
	if (presented.length === 0) return null;
	const presentedDigest = await sha256(presented);
	const configured: ReadonlyArray<
		readonly [ServicePrincipal, string | undefined]
	> = [
		[DISCORD_ADAPTER_PRINCIPAL, credentials.discordAdapterToken],
		[ADMIN_API_PRINCIPAL, credentials.adminApiToken],
	];
	let matched: ServicePrincipal | null = null;
	for (const [principal, token] of configured) {
		if (token === undefined || token.length === 0) continue;
		const digest = await sha256(token);
		// Equal-length SHA-256 digests: timingSafeEqual never sees the raw
		// credentials and its inputs never differ in length.
		if (crypto.subtle.timingSafeEqual(presentedDigest, digest)) {
			if (matched !== null) return null;
			matched = principal;
		}
	}
	return matched;
}
