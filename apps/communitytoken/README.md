# CommunityToken — production core

The production CommunityToken Worker and `CommunityState` Durable Object
(issue #4, Phase 2 PR-3 trusted API + PR-4 OIDC registration):

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
owned by later PRs (`POST /api/v1/daily-reward`, `POST /interactions`)
return `404` until their owners land.

The namespace follows ADR-0002 (`docs/adr/0002-api-namespace.md`): the
versioned command/query application API lives under `/api/v1/*`, its
administrative-capability subset under `/api/v1/admin/*`, and
protocol-ingress endpoints stay outside the API namespace.

| Route | Group | DO method |
| --- | --- | --- |
| `POST /api/v1/balance` | internal | `internalBalance` |
| `POST /api/v1/history` | internal | `internalHistory` |
| `POST /api/v1/transfers` | internal | `internalTransfer` (idempotent) |
| `POST /api/v1/registration-intents` | internal | `apiCreateRegistrationIntent` (idempotent) |
| `GET /auth/oidc/callback` | public | `getOidcRegistrationIntent` + `completeOidcRegistration` |
| `POST /api/v1/admin/issuances` | admin | `adminIssue` |
| `POST /api/v1/admin/distributions` | admin | `adminDistribute` |
| `GET /api/v1/admin/treasury/balance` | admin | `adminTreasuryBalance` |
| `GET /api/v1/admin/treasury/history` | admin | `adminTreasuryHistory` |

## Authentication boundary

Two bearer credentials, provisioned as Worker secrets:

- `DISCORD_ADAPTER_SERVICE_TOKEN` asserts the `discord-adapter`
  principal, authorized for the non-admin `/api/v1/*` routes.
- `ADMIN_API_TOKEN` asserts the `admin-api` principal, authorized for
  `/api/v1/admin/*` routes.

Authorization is explicit per-route group metadata, never pathname
prefix matching: `/api/v1/admin/*` is lexically inside `/api/v1/*` but a
distinct authorization group, and the pathname itself is descriptive,
not a security boundary (ADR-0002).

The Worker consumes the credential; route-facing DO methods receive only
the asserted principal and re-check it against their route group as a
misroute backstop. No match is `401 unauthorized`; an authenticated
principal on the wrong group is `403 forbidden`. An unset/empty
configured token never matches, and a credential matching both configured
secrets is ambiguous and fails closed. The credential comparison hashes
both sides and compares equal-length digests with
`crypto.subtle.timingSafeEqual`. The `public` route
`GET /auth/oidc/callback` runs no Bearer authentication at all — it is
an OIDC protocol endpoint whose outcomes are fixed static HTML pages,
never JSON and never a redirect.

## Request pipeline

Route match → authenticate → authorize → `Content-Type: application/json`
(415) → JSON object body and exact wire shape (400 `invalid_request`;
unknown fields are rejected, including nested ones) → `Idempotency-Key`
on `POST /api/v1/transfers` and `POST /api/v1/registration-intents`
(400 `idempotency_key_required`, length 1..255, value verbatim) →
fingerprint v1 = SHA-256 over
`"communitytoken-idempotency-v1\n" + METHOD + "\n" + path + "\n" +
RFC8785_JCS(parsed_body)` (400 on canonicalization failure) → DO call.
`POST /api/v1/registration-intents` additionally validates the OIDC
configuration (500 `internal_error` when unset or malformed) and
requires the body's `issuer` to equal the configured trusted issuer.
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
- `OIDC_ISSUER_URL`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET` — the OIDC
  relying-party configuration (PR-4). All three must be present and
  non-empty; the issuer must be absolute HTTPS without query, fragment,
  or trailing slash. A missing or malformed configuration fails closed:
  `500 internal_error` on `POST /api/v1/registration-intents`, the
  generic failure page on the callback. The client secret never leaves
  the Worker.

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
  `idempotency_records`, `registration_intents`) and append-only
  UPDATE/DELETE triggers on all four history/record tables. The
  operation-kind CHECK is created with all five Phase 2 literals;
  `DAILY_REWARD` semantics arrive with their feature PR.
  `registration_intents` carries its own lifecycle triggers: immutable
  identity/proof columns and only `active → consumed` /
  `active → superseded` transitions (deletion stays legal at the
  storage floor).
- `src/unit-of-work.ts` — the production `UnitOfWork`, mapping the
  application's serialized atomic boundary onto
  `ctx.storage.transactionSync`: one injected-clock sample per section,
  no nesting, permanently revoked repository handles, runtime rejection
  of object- and function-valued thenables.
- `src/repositories.ts` — SQLite-backed `WalletRepository`,
  `OperationRepository`, `LedgerRepository`, `IdentityBindingRepository`,
  `IdempotencyRepository`, `UserRepository`, and
  `RegistrationIntentRepository` implementations.
- `src/oidc/` — the PR-4 relying-party protocol modules (`config`,
  `authorize`, `token`, `id-token`), owned entirely by the Worker
  boundary: config validation, authorization-URL construction, the
  confidential-client token exchange, and JWKS fetch/cache + ID-token
  verification via `jose` (no `createRemoteJWKSet`).
- `src/registration.ts` — the public callback orchestration: strict
  query grammar, intent read, token exchange, ID-token verification,
  atomic completion RPC, and the fixed success/expired/failure pages
  with their fixed security headers.

## RPC surface

- Route-facing methods (the ten above): principal-bearing methods each
  receive the asserted principal, own the complete `uow.transact`
  section — identity resolution, the protected mutation, and its
  idempotency record commit atomically — and return a serializable
  `{status, body}` descriptor. The public-callback pair
  (`getOidcRegistrationIntent`, `completeOidcRegistration`) carries no
  principal: the read returns the proof material for an active intent
  or `unavailable`, and the completion re-checks intent validity and
  the exact verified identity inside one serialized section that
  resolves-or-creates the User, its zero-balance wallet, and the
  IdentityBinding while consuming the intent.
- Product use-case methods: `issueToken`, `distributeToken`,
  `transferToken`, `payTreasury`, `getBalance`, `getTransactionHistory` —
  facade entries kept for the contract harness; each opens its own
  section.
- Test-support methods — unreachable from `fetch`: `createUser`,
  `createBoundUser`, `applyEconomicCommand`, `listOperations`,
  `listLedger`, `issuedAmount`, `totalSupply`. `createBoundUser`
  atomically inserts the User, its zero-balance wallet, and the
  `(issuer, subject)` IdentityBinding production registration commits in
  `completeOidcRegistration`; duplicate user ids and duplicate bindings
  are conflict values, not RPC rejections.

## Invariants honored

- Every durable mutation runs inside one `transactionSync` section —
  concurrent mutations serialize; a throw rolls back every partial write.
- `economic_operations`, `ledger_transactions`, `identity_bindings`, and
  `idempotency_records` reject UPDATE/DELETE at the storage level.
- `registration_intents` enforces the intent lifecycle at the storage
  level: a fixed 600-second TTL, at most one `active` row per
  `(expected_issuer, expected_subject)` (a partial UNIQUE index makes
  latest-wins supersession atomic), immutable identity/proof columns,
  and only `active → consumed` (with `consumed_at`) or
  `active → superseded` (without it) transitions.
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
