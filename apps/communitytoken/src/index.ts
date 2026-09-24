import { CommunityState } from "./community-state";
import { handleRequest } from "./http";

export { CommunityState };

/**
 * The CommunityToken core Worker (issue #4): serves the trusted core API
 * plus the PR-4 OIDC registration surface — `POST
 * /api/v1/registration-intents` (service) and `GET /auth/oidc/callback`
 * (public) — and fixed `404` for every other method/path.
 */
export default {
	fetch(request, env): Promise<Response> {
		return handleRequest(request, env);
	},
} satisfies ExportedHandler<Env>;
