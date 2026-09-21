import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";
import {
	FAKE_OIDC_CLIENT_ID,
	FAKE_OIDC_CLIENT_SECRET,
	fakeOidcOutboundService,
} from "./test/support/fake-oidc/op";

export default defineConfig({
	plugins: [
		cloudflareTest({
			wrangler: { configPath: "./wrangler.jsonc" },
			// Test-only bearer credentials injected as pool bindings (issue #4
			// PR-3): never committed to wrangler.jsonc or .dev.vars. The token
			// literals are arbitrary test fixtures, not real secrets. The OIDC
			// triple (issue #4 PR-4) likewise: a placeholder issuer — specs
			// assign `env.OIDC_ISSUER_URL` a unique per-test issuer path — and
			// arbitrary fake credentials the fake OP demands.
			miniflare: {
				bindings: {
					ADMIN_API_TOKEN: "test-admin-api-token",
					DISCORD_ADAPTER_SERVICE_TOKEN: "test-discord-adapter-token",
					OIDC_ISSUER_URL: "https://oidc.test/placeholder",
					OIDC_CLIENT_ID: FAKE_OIDC_CLIENT_ID,
					OIDC_CLIENT_SECRET: FAKE_OIDC_CLIENT_SECRET,
				},
				// Every outbound fetch the Worker under test (or the spec code
				// itself) makes is routed to the fake OIDC Provider — the
				// `fetchMock` boundary is unavailable in the pinned pool, so the
				// equivalent `outboundService` interception is used (D11).
				outboundService: fakeOidcOutboundService,
			},
		}),
	],
	// No `dangerouslyIgnoreUnhandledErrors`: expected-failure RPCs return
	// result values instead of rejecting across the DO boundary, so any
	// unhandled error reported here is a real defect and must fail the run.
});
