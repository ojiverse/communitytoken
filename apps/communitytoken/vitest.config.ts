import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
	plugins: [
		cloudflareTest({
			wrangler: { configPath: "./wrangler.jsonc" },
		}),
	],
	// No `dangerouslyIgnoreUnhandledErrors`: expected-failure RPCs return
	// result values instead of rejecting across the DO boundary, so any
	// unhandled error reported here is a real defect and must fail the run.
});
