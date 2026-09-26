/**
 * Non-generated augmentation of the Worker's `Env` (issue #4 PR-3): the
 * two bearer credentials are provisioned as secret bindings and therefore
 * absent from `wrangler.jsonc` and the generated `worker-configuration.d.ts`
 * (which must not be edited). Both `Env` declarations the generated types
 * expose — the global `Env` the Worker entry sees and `Cloudflare.Env` the
 * test pool's `env` uses — are augmented.
 *
 * Both secrets are optional at the type level because authentication must
 * fail closed when one is unset rather than failing to type-check.
 */
interface Env {
	/** Bearer credential asserting the `admin-api` technical caller. */
	ADMIN_API_TOKEN?: string;
	/** Bearer credential asserting the `discord-adapter` technical caller. */
	DISCORD_ADAPTER_SERVICE_TOKEN?: string;
	/** Trusted OIDC issuer URL (absolute HTTPS, no trailing slash). */
	OIDC_ISSUER_URL?: string;
	/** OIDC client identifier for the registration code flow. */
	OIDC_CLIENT_ID?: string;
	/** OIDC client secret; never leaves the Worker (never sent to the DO). */
	OIDC_CLIENT_SECRET?: string;
}

declare namespace Cloudflare {
	interface Env {
		/** Bearer credential asserting the `admin-api` technical caller. */
		ADMIN_API_TOKEN?: string;
		/** Bearer credential asserting the `discord-adapter` technical caller. */
		DISCORD_ADAPTER_SERVICE_TOKEN?: string;
		/** Trusted OIDC issuer URL (absolute HTTPS, no trailing slash). */
		OIDC_ISSUER_URL?: string;
		/** OIDC client identifier for the registration code flow. */
		OIDC_CLIENT_ID?: string;
		/** OIDC client secret; never leaves the Worker (never sent to the DO). */
		OIDC_CLIENT_SECRET?: string;
	}
}
