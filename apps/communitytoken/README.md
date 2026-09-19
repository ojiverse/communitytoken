# CommunityToken — production core

The production CommunityToken Worker and `CommunityState` Durable Object
(issue #4, Phase 2 PR-2):

```text
Worker (fetch -> 404 in PR-2; routes land with their feature PRs)
  ↓
CommunityState Durable Object   (single serialization authority,
                                 idFromName("community"))
  ↓
SQLite-backed storage           (ctx.storage.sql)
```

## Structure

- `src/index.ts` — Worker entry. `fetch()` returns 404 for every request:
  no product route exists yet and none is stubbed.
- `src/community-state.ts` — the `CommunityState` Durable Object. Schema
  initialization and treasury seeding run under `blockConcurrencyWhile`.
- `src/schema.ts` — the PR-2 tables (`users`, `wallets`,
  `economic_operations`, `ledger_transactions`) and the append-only
  triggers on both history tables. The operation-kind CHECK is created
  with all five Phase 2 literals; `DAILY_REWARD` semantics arrive with
  their feature PR.
- `src/unit-of-work.ts` — the production `UnitOfWork`, mapping the
  application's serialized atomic boundary onto
  `ctx.storage.transactionSync`: one injected-clock sample per section,
  no nesting, permanently revoked repository handles, runtime rejection
  of object- and function-valued thenables.
- `src/repositories.ts` — SQLite-backed `WalletRepository`,
  `OperationRepository`, and `LedgerRepository` implementations.

## RPC surface

- Product use-case methods: `issueToken`, `distributeToken`,
  `transferToken`, `payTreasury`, `getBalance`, `getTransactionHistory`.
  These are the real production entries; later PRs wire them to routes
  and own the full `transact` body (idempotency record, eligibility
  state, and protected mutation in one section).
- Test-support methods — unreachable from `fetch`: `createUser`,
  `applyEconomicCommand`, `listOperations`, `listLedger`,
  `issuedAmount`, `totalSupply`. `createUser` stores the contract-suite
  user id verbatim and seeds the wallet with a fresh UUID;
  `applyEconomicCommand` drives the unchanged Phase 1 contract suite
  through the same evaluate/persist path as the product use cases.

## Invariants honored

- Every durable mutation runs inside one `transactionSync` section —
  concurrent mutations serialize; a throw rolls back every partial write.
- `economic_operations` and `ledger_transactions` reject UPDATE/DELETE at
  the storage level.
- Monetary values are stored as SQLite INTEGER and round-trip exactly
  within the safe-integer domain.
- The treasury is a singleton `system` wallet (`id = "treasury"`) seeded
  empty at construction; initial funding is an explicit `TOKEN_ISSUANCE`.
- The unchanged `@communitytoken/economic-contract` suite runs against
  this DO via `test/economic-harness.ts`.
