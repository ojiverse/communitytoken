import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
	plugins: [
		cloudflareTest({
			wrangler: { configPath: "./wrangler.jsonc" },
		}),
	],
	test: {
		// Expected-failure RPC calls (insufficient balance, direction
		// violations, …) surface twice: the awaited promise rejects inside the
		// test (caught by expect().rejects) and workerd additionally reports an
		// "uncaught (in promise)" error from the DO side. The assertions still
		// verify the domain behavior; the extra report is pipeline noise.
		dangerouslyIgnoreUnhandledErrors: true,
	},
});
