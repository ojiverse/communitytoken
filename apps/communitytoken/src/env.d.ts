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
	/** Bearer credential asserting the `admin-api` principal. */
	ADMIN_API_TOKEN?: string;
	/** Bearer credential asserting the `discord-adapter` principal. */
	DISCORD_ADAPTER_SERVICE_TOKEN?: string;
}

declare namespace Cloudflare {
	interface Env {
		/** Bearer credential asserting the `admin-api` principal. */
		ADMIN_API_TOKEN?: string;
		/** Bearer credential asserting the `discord-adapter` principal. */
		DISCORD_ADAPTER_SERVICE_TOKEN?: string;
	}
}
