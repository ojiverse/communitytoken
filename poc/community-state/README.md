# Persistence PoC — CommunityState Durable Object

Validates the target production consistency model for the CommunityToken rebuild
(tracking issue: #3 / docs/specification/):

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
- Credits that would push a wallet balance or total supply above the 2^53-1
  monetary domain are rejected
- Failed transfers roll back atomically: no balance change, no ledger/operation
  rows
- Ledger history is append-only at the storage level (SQLite triggers)
- Committed state survives Durable Object eviction (`evictDurableObject`)
- Counterexample: a deliberately non-transactional path
  (`transferP2PUnsafe`) demonstrably loses funds

## Notes

- Treasury is a singleton `system` wallet (`id = "treasury"`) bootstrapped in
  the DO constructor; `createWallet` only ever creates `user` wallets, so a
  second system wallet cannot be minted.
- Rejection errors carry a contract code prefix (`INVALID_AMOUNT`,
  `WALLET_NOT_FOUND`, `DIRECTION_VIOLATION`, `INSUFFICIENT_BALANCE`,
  `OVERFLOW`) so the shared contract suite can assert reasons across
  implementations.
- The same storage-independent contract suite (`@communitytoken/economic-contract`)
  runs against this DO and against the in-memory kernel reference; the tests
  below that remain PoC-specific cover serialization, eviction, storage-level
  append-only, and rollback mechanics.
- The DO holds no mutable state in instance fields — all state lives in
  SQLite — so eviction is safe by construction.
- `transferP2PUnsafe` exists only to demonstrate why the transaction boundary
  matters. Do not carry it into production code.
- `economic_operations` has no actor column on purpose: the actor/visibility specification owns
  initiator modeling, and an actor must never be an alias for `from_wallet`.
  Do not reintroduce one here.

## Run

```bash
pnpm install
pnpm --filter @communitytoken/poc-community-state test
```
