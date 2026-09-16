import { env } from "cloudflare:test";
import { defineEconomicContract } from "@communitytoken/economic-contract";
import type { CommunityState } from "../src/index";
import { createPocHarness } from "./economic-harness";

/**
 * Runs the storage-independent economic contract suite against the
 * DO + SQLite implementation. PoC-specific guarantees (serialization,
 * eviction, storage-level append-only, rollback mechanics) stay in
 * community-state.spec.ts as integration tests.
 */
defineEconomicContract("DO + SQLite PoC", () => {
	const id = env.COMMUNITY_STATE.idFromName(crypto.randomUUID());
	const stub = env.COMMUNITY_STATE.get(id) as DurableObjectStub<CommunityState>;
	return createPocHarness(stub);
});
