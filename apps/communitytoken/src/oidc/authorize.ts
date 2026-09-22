/**
 * Authorization-request material of the registration flow (issue #4
 * PR-4): the three independent 32-byte random values — `state`, `nonce`,
 * and the proof-key secret (the PKCE verifier, named provider-independently
 * at the application boundary) — plus the fixed-parameter authorization
 * URL the trusted route returns to the adapter.
 *
 * Every random value is `crypto.getRandomValues(new Uint8Array(32))`
 * encoded as unpadded base64url — exactly 43 characters — and each comes
 * from its own call: no derivation, no reuse.
 */

/** The fixed production callback URI — never derived from the request origin. */
export const OIDC_REDIRECT_URI = "https://token.ojiver.se/auth/oidc/callback";

/** Unpadded base64url of a byte string. */
function base64url(bytes: Uint8Array): string {
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary)
		.replaceAll("+", "-")
		.replaceAll("/", "_")
		.replaceAll("=", "");
}

/**
 * The unguessable registration material persisted on the intent:
 * correlation `state`, authentication `nonce`, and the proof-key secret
 * the token exchange later presents as `code_verifier`.
 */
export type RegistrationSecrets = {
	readonly state: string;
	readonly nonce: string;
	readonly proofKeySecret: string;
};

/** Generates the three independent 43-character base64url secrets. */
export function generateRegistrationSecrets(): RegistrationSecrets {
	return {
		state: base64url(crypto.getRandomValues(new Uint8Array(32))),
		nonce: base64url(crypto.getRandomValues(new Uint8Array(32))),
		proofKeySecret: base64url(crypto.getRandomValues(new Uint8Array(32))),
	};
}

/**
 * The S256 proof-key challenge: `base64url(SHA-256(ASCII(secret)))`.
 * WebCrypto is asynchronous, so this completes in the Worker before the
 * synchronous Durable Object section runs.
 */
export async function computeProofKeyChallenge(
	proofKeySecret: string,
): Promise<string> {
	const digest = await crypto.subtle.digest(
		"SHA-256",
		new TextEncoder().encode(proofKeySecret),
	);
	return base64url(new Uint8Array(digest));
}

/**
 * Builds `GET {issuer}/authorize` with exactly the fixed parameter set of
 * the production OP contract — `response_type=code`, `client_id`, the
 * fixed `redirect_uri`, `scope=openid`, `state`, `nonce`,
 * `code_challenge`, `code_challenge_method=S256`. No `prompt`,
 * `max_age`, `login_hint`, or other optional policy parameters.
 */
export function buildAuthorizationUrl(
	issuerUrl: string,
	clientId: string,
	secrets: RegistrationSecrets,
	codeChallenge: string,
): string {
	const url = new URL(`${issuerUrl}/authorize`);
	url.search = new URLSearchParams({
		response_type: "code",
		client_id: clientId,
		redirect_uri: OIDC_REDIRECT_URI,
		scope: "openid",
		state: secrets.state,
		nonce: secrets.nonce,
		code_challenge: codeChallenge,
		code_challenge_method: "S256",
	}).toString();
	return url.toString();
}
