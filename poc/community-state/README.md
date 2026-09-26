# Historical persistence PoC — CommunityState Durable Object

This PoC is historical evidence for the Cloudflare consistency approach that preceded the current
primitive-ledger architecture.

It is not a source of truth for current domain names, schema shape, or Transaction semantics.

## What remains valid

The PoC demonstrated that one Durable Object can serialize mutations for a community, synchronous
durable transactions can prevent double-spend and lost updates, monetary overflow can be rejected
before commit, and failed mutations can roll back without leaving partial balance or history state.

It also demonstrated storage-level append-only protection, persistence across Durable Object
eviction, and a deliberately unsafe counterexample showing why the transaction boundary matters.

Those findings remain relevant to the production CommunityState design.

## What is historical

The PoC source was written against an earlier economic model.

It may contain types, tables, method names, or test fixtures that no longer match the current
Principal, Account, and Transaction architecture.

Those artifacts must not be copied into production or treated as normative merely because the PoC
still compiles.

The current normative model lives under docs/specification. Implementation reconciliation is tracked
by issue #25.

## Current interpretation

Under the current architecture, the consistency claim is simpler.

ISSUE or TRANSFER is evaluated against one serialized view of Account state.

An accepted primitive Transaction and all required balance changes commit atomically.

A rejected request creates neither a Transaction nor a balance change.

Committed Transaction history is immutable.

Persistence preserves exact integer values within the monetary domain.

The application may additionally compose identity or idempotency state in the same atomic section
when its correctness depends on the monetary mutation.

## Running the PoC

Install repository dependencies and run the poc-community-state package test command with pnpm.

Passing this PoC is evidence about Durable Object transaction mechanics, not evidence that its
historical domain vocabulary remains current.
