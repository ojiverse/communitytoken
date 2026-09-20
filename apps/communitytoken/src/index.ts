import { CommunityState } from "./community-state";

export { CommunityState };

/**
 * The CommunityToken core Worker. In PR-2 no route exists yet — the fixed
 * Phase 2 route set lands with the feature PRs that own it — so every
 * request gets a plain 404. No health endpoint, no provisional route.
 */
export default {
	fetch(): Response {
		return new Response("Not Found", { status: 404 });
	},
} satisfies ExportedHandler<Env>;
