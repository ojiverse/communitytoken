import { env } from "cloudflare:test";
import { defineEconomicContract } from "@communitytoken/economic-contract";
import type { CommunityState } from "../src/index";
import { createProductionHarness } from "./economic-harness";

/**
 * Runs the unchanged storage-independent Phase 1 economic contract suite
 * against the production CommunityState Durable Object. Production-specific
 * guarantees (serialization, eviction, storage-level append-only, rollback
 * mechanics, transaction-context lifetime) stay in community-state.spec.ts
 * as integration tests.
 */
defineEconomicContract("production CommunityState", () => {
	const id = env.COMMUNITY_STATE.idFromName(crypto.randomUUID());
	const stub = env.COMMUNITY_STATE.get(id) as DurableObjectStub<CommunityState>;
	return createProductionHarness(stub);
});
