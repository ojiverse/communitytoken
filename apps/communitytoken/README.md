# CommunityToken — production core

The production CommunityToken Worker and `CommunityState` Durable Object
(issue #4, Phase 2 PR-3):

```text
Worker fetch (exact route match → Bearer auth → route-group
              authorization → wire validation → fingerprint)
  ↓  asserted service principal, never the credential
CommunityState Durable Object   (single serialization authority,
                                 idFromName("community"))
  ↓
SQLite-backed storage           (ctx.storage.sql)
```

## Routes

The route set is exact `"METHOD pathname"` pairs — no trailing-slash or
case normalization, and a wrong method on a known path is `404`. Routes
owned by later PRs (`POST /internal/registration-intents`,
`POST /internal/daily-reward`, `GET /auth/oidc/callback`) return `404`
until their owners land.

| Route | Group | DO method |
| --- | --- | --- |
| `POST /internal/balance` | internal | `internalBalance` |
| `POST /internal/history` | internal | `internalHistory` |
| `POST /internal/transfers` | internal | `internalTransfer` (idempotent) |
| `POST /admin/issuances` | admin | `adminIssue` |
| `POST /admin/distributions` | admin | `adminDistribute` |
| `GET /admin/treasury/balance` | admin | `adminTreasuryBalance` |
| `GET /admin/treasury/history` | admin | `adminTreasuryHistory` |

## Authentication boundary

Two bearer credentials, provisioned as Worker secrets:

- `DISCORD_ADAPTER_SERVICE_TOKEN` asserts the `discord-adapter`
  principal, authorized for `/internal/*` routes.
- `ADMIN_API_TOKEN` asserts the `admin-api` principal, authorized for
  `/admin/*` routes.

The Worker consumes the credential; route-facing DO methods receive only
the asserted principal and re-check it against their route group as a
misroute backstop. No match is `401 unauthorized`; an authenticated
principal on the wrong group is `403 forbidden`. An unset/empty
configured token never matches, and a credential matching both configured
secrets is ambiguous and fails closed. The credential comparison hashes
both sides and compares equal-length digests with
`crypto.subtle.timingSafeEqual`.

## Request pipeline

Route match → authenticate → authorize → `Content-Type: application/json`
(415) → JSON object body and exact wire shape (400 `invalid_request`;
unknown fields are rejected, including nested ones) → `Idempotency-Key`
on `POST /internal/transfers` (400 `idempotency_key_required`, length
1..255, value verbatim) → fingerprint v1 = SHA-256 over
`"communitytoken-idempotency-v1\n" + METHOD + "\n" + path + "\n" +
RFC8785_JCS(parsed_body)` (400 on canonicalization failure) → DO call.
Expected failures return `{status, body}` descriptors; unexpected
rejections map to `500 internal_error`. Query parameters on POST routes
are ignored. No CORS headers.

## Environment surface

- `COMMUNITY_STATE` — the `CommunityState` Durable Object binding
  (`wrangler.jsonc`, generated `worker-configuration.d.ts`).
- `ADMIN_API_TOKEN`, `DISCORD_ADAPTER_SERVICE_TOKEN` — secret bindings
  provisioned out-of-band; typed via the non-generated `src/env.d.ts`
  augmentation. Local development uses `.dev.vars` (ignored); see
  `.dev.vars.example`.

## Structure

- `src/index.ts` — Worker entry delegating to `handleRequest`.
- `src/http.ts` — routing, authorization groups, wire validation, and the
  `CommunityStateApi` stub contract.
- `src/auth.ts` — Bearer authentication and principal assertion.
- `src/fingerprint.ts` — the local RFC 8785 (JCS) canonicalizer and the
  fingerprint v1 digest.
- `src/community-state.ts` — the `CommunityState` Durable Object. Schema
  initialization and treasury seeding run under `blockConcurrencyWhile`.
- `src/schema.ts` — the tables (`users`, `wallets`,
  `economic_operations`, `ledger_transactions`, `identity_bindings`,
  `idempotency_records`) and append-only UPDATE/DELETE triggers on all
  four history/record tables. The operation-kind CHECK is created with
  all five Phase 2 literals; `DAILY_REWARD` semantics arrive with their
  feature PR.
- `src/unit-of-work.ts` — the production `UnitOfWork`, mapping the
  application's serialized atomic boundary onto
  `ctx.storage.transactionSync`: one injected-clock sample per section,
  no nesting, permanently revoked repository handles, runtime rejection
  of object- and function-valued thenables.
- `src/repositories.ts` — SQLite-backed `WalletRepository`,
  `OperationRepository`, `LedgerRepository`, `IdentityBindingRepository`,
  and `IdempotencyRepository` implementations.

## RPC surface

- Route-facing methods (the seven above): each receives the asserted
  principal, owns the complete `uow.transact` section — identity
  resolution, the protected mutation, and its idempotency record commit
  atomically — and returns a serializable `{status, body}` descriptor.
- Product use-case methods: `issueToken`, `distributeToken`,
  `transferToken`, `payTreasury`, `getBalance`, `getTransactionHistory` —
  facade entries kept for the contract harness; each opens its own
  section.
- Test-support methods — unreachable from `fetch`: `createUser`,
  `createBoundUser`, `applyEconomicCommand`, `listOperations`,
  `listLedger`, `issuedAmount`, `totalSupply`. `createBoundUser`
  atomically inserts the User, its zero-balance wallet, and the
  `(issuer, subject)` IdentityBinding production registration will commit
  in PR-4; duplicate user ids and duplicate bindings are conflict values,
  not RPC rejections.

## Invariants honored

- Every durable mutation runs inside one `transactionSync` section —
  concurrent mutations serialize; a throw rolls back every partial write.
- `economic_operations`, `ledger_transactions`, `identity_bindings`, and
  `idempotency_records` reject UPDATE/DELETE at the storage level.
- Identity binding lookup is an exact `(issuer, subject)` match — no
  normalization — inside the same section as the mutation it guards.
- A successful protected transfer and its idempotency record commit in
  the same serialized section; expected failures record nothing and leave
  the key retryable.
- Monetary values are stored as SQLite INTEGER and round-trip exactly
  within the safe-integer domain.
- The treasury is a singleton `system` wallet (`id = "treasury"`) seeded
  empty at construction; initial funding is an explicit `TOKEN_ISSUANCE`.
- The unchanged `@communitytoken/economic-contract` suite runs against
  this DO via `test/economic-harness.ts`.
