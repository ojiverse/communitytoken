import { defineEconomicContract } from "@communitytoken/economic-contract";
import { createInMemoryHarness } from "./in-memory-harness";

/**
 * Runs the storage-independent economic contract suite against the in-memory
 * reference adapter, which embeds the pure evaluator of this package.
 */
defineEconomicContract("in-memory reference", createInMemoryHarness);
