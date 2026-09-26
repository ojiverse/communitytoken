import { env } from "cloudflare:test";
import { defineEconomicContract } from "@communitytoken/economic-contract";
import type { CommunityState } from "../src/index";
import { createProductionHarness } from "./economic-harness";

/**
 * Runs the storage-independent primitive ledger contract suite against the
 * production CommunityState storage. Production-specific guarantees
 * (serialization, eviction, storage-level constraints, rollback mechanics,
 * transaction-context lifetime) stay in community-state.spec.ts.
 */
defineEconomicContract("production CommunityState", () => {
	const id = env.COMMUNITY_STATE.idFromName(crypto.randomUUID());
	const stub = env.COMMUNITY_STATE.get(id) as DurableObjectStub<CommunityState>;
	return createProductionHarness(stub);
});
