# Persistence PoC — CommunityState Durable Object

Validates the target production consistency model for the CommunityToken rebuild
(tracking issue: #3 / Phase 1 §5):

```text
Worker
  ↓
CommunityState Durable Object   (single serialization authority)
  ↓
SQLite-backed storage           (ctx.storage.sql)
```

## What it proves

- Wallet creation and atomic balance mutation
- `EconomicOperation` + `LedgerTransaction` persisted in one logical
  transaction (`ctx.storage.transactionSync`)
- Concurrent transfer requests serialize correctly — no double-spend, no lost
  updates
- Failed transfers roll back atomically: no balance change, no ledger/operation
  rows
- Ledger history is append-only at the storage level (SQLite triggers)
- Committed state survives Durable Object eviction (`evictDurableObject`)
- Counterexample: a deliberately non-transactional path
  (`transferP2PUnsafe`) demonstrably loses funds

## Notes

- Treasury is a singleton `system` wallet (`id = "treasury"`) bootstrapped in
  the DO constructor.
- The DO holds no mutable state in instance fields — all state lives in
  SQLite — so eviction is safe by construction.
- `transferP2PUnsafe` exists only to demonstrate why the transaction boundary
  matters. Do not carry it into production code.

## Run

```bash
pnpm install
pnpm --filter @communitytoken/poc-community-state test
```
