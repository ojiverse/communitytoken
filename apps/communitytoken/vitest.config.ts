import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
	plugins: [
		cloudflareTest({
			wrangler: { configPath: "./wrangler.jsonc" },
			// Test-only bearer credentials injected as pool bindings (issue #4
			// PR-3): never committed to wrangler.jsonc or .dev.vars. The token
			// literals are arbitrary test fixtures, not real secrets.
			miniflare: {
				bindings: {
					ADMIN_API_TOKEN: "test-admin-api-token",
					DISCORD_ADAPTER_SERVICE_TOKEN: "test-discord-adapter-token",
				},
			},
		}),
	],
	// No `dangerouslyIgnoreUnhandledErrors`: expected-failure RPCs return
	// result values instead of rejecting across the DO boundary, so any
	// unhandled error reported here is a real defect and must fail the run.
});
