import { CommunityState } from "./community-state";
import { handleRequest } from "./http";

export { CommunityState };

/**
 * The CommunityToken core Worker (issue #4 PR-3): serves the seven
 * route-facing endpoints of the trusted core API plus fixed `404` for
 * everything else, including the routes later PRs own
 * (`/internal/registration-intents`, `/internal/daily-reward`,
 * `/auth/oidc/callback`).
 */
export default {
	fetch(request, env): Promise<Response> {
		return handleRequest(request, env);
	},
} satisfies ExportedHandler<Env>;
