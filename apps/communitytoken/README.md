# CommunityToken — production core

The production CommunityToken Worker and `CommunityState` Durable Object.

Current architecture authority: [#17](https://github.com/ojiverse/communitytoken/issues/17).
Current roadmap: [#18](https://github.com/ojiverse/communitytoken/issues/18).
Current Phase 2 tracker: [#19](https://github.com/ojiverse/communitytoken/issues/19).

```text
Worker fetch (exact route match → Bearer auth → route-group
              authorization → wire validation → fingerprint)
  ↓  asserted service principal, never the credential
CommunityState Durable Object   (single serialization authority,
                                 idFromName("community"))
  ↓
SQLite-backed storage           (ctx.storage.sql)
```

CommunityToken is a feature-agnostic economic substrate. Feature-specific eligibility, cadence,
scheduling, campaign state, or business uniqueness is outside this core.

## Routes

The route set is exact `"METHOD pathname"` pairs — no trailing-slash or case normalization, and a
wrong method on a known path is `404`. Unknown routes are `404 not_found`.

The namespace follows ADR-0002 (`docs/adr/0002-api-namespace.md`): the versioned command/query
application API lives under `/api/v1/*`, its administrative-capability subset under
`/api/v1/admin/*`, and protocol-ingress endpoints stay outside the API namespace.

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

Discord interaction ingress is owned by the separate Discord adapter application, not by this core
Worker.

## Authentication boundary

Two bearer credentials, provisioned as Worker secrets:

- `DISCORD_ADAPTER_SERVICE_TOKEN` asserts the `discord-adapter` principal, authorized for the
  non-admin `/api/v1/*` routes.
- `ADMIN_API_TOKEN` asserts the `admin-api` principal, authorized for
  `/api/v1/admin/*` routes.

Authorization is explicit per-route group metadata, never pathname prefix matching. The Worker
consumes the credential; route-facing DO methods receive only the asserted principal and re-check it
against their route group as a misroute backstop.

No match is `401 unauthorized`; an authenticated principal on the wrong group is
`403 forbidden`. An unset/empty configured token never matches, and a credential matching both
configured secrets is ambiguous and fails closed. Credential comparison hashes both sides and
compares equal-length digests with `crypto.subtle.timingSafeEqual`.

The public `GET /auth/oidc/callback` route runs no Bearer authentication. It is an OIDC protocol
endpoint whose outcomes are fixed static HTML pages, never JSON and never a redirect.

## Request pipeline

Route match → authenticate → authorize → `Content-Type: application/json` (415) → JSON object body
and exact wire shape (400 `invalid_request`; unknown fields are rejected) → `Idempotency-Key` on
`POST /api/v1/transfers` and `POST /api/v1/registration-intents` → fingerprint v1 → DO call.

Fingerprint v1 is SHA-256 over:

```text
"communitytoken-idempotency-v1\n"
+ METHOD + "\n"
+ path + "\n"
+ RFC8785_JCS(parsed_body)
```

`POST /api/v1/registration-intents` additionally validates the OIDC configuration and requires the
body's `issuer` to equal the configured trusted issuer.

Expected failures return `{status, body}` descriptors; unexpected failures map to
`500 internal_error`. Query parameters on POST routes are ignored. No CORS headers are added.

## Environment surface

- `COMMUNITY_STATE` — the `CommunityState` Durable Object binding.
- `ADMIN_API_TOKEN`, `DISCORD_ADAPTER_SERVICE_TOKEN` — secret bindings provisioned out-of-band.
- `OIDC_ISSUER_URL`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET` — OIDC relying-party
  configuration. All three must be present and non-empty; the issuer must be absolute HTTPS without
  query, fragment, or trailing slash. The client secret never leaves the Worker.

Local development uses `.dev.vars` (ignored); see `.dev.vars.example`.

## Structure

- `src/index.ts` — Worker entry delegating to `handleRequest`.
- `src/http.ts` — routing, authorization groups, wire validation, and the `CommunityStateApi`
  stub contract.
- `src/auth.ts` — Bearer authentication and principal assertion.
- `src/fingerprint.ts` — local RFC 8785 (JCS) canonicalization and fingerprint v1 digest.
- `src/community-state.ts` — the singleton `CommunityState` Durable Object. Schema initialization
  and treasury seeding run under `blockConcurrencyWhile`.
- `src/schema.ts` — `users`, `wallets`, `economic_operations`, `ledger_transactions`,
  `identity_bindings`, `idempotency_records`, and `registration_intents`, with storage-level
  structural/immutability constraints. The economic operation-kind domain is exactly
  `TOKEN_ISSUANCE`, `DISTRIBUTION`, `P2P_TRANSFER`, and `TREASURY_PAYMENT`.
- `src/unit-of-work.ts` — production `UnitOfWork`, mapping the application atomic boundary onto
  `ctx.storage.transactionSync`: one injected-clock sample per section, no nesting, permanently
  revoked repository handles, and runtime rejection of Promise-like escapes.
- `src/repositories.ts` — SQLite-backed repositories.
- `src/oidc/` — Worker-owned OIDC relying-party protocol modules.
- `src/registration.ts` — public callback orchestration and static browser response pages.

## RPC surface

Route-facing methods own their complete `uow.transact` section. Identity resolution, protected
mutation, and any recordable idempotency result commit in the same serialized boundary.

The public callback read/completion methods carry no service principal. Completion rechecks intent
validity and exact verified identity inside one serialized section that resolves-or-creates the User,
zero-balance wallet, and IdentityBinding while consuming the intent.

Product use-case facade methods are:

```text
issueToken
distributeToken
transferToken
payTreasury
getBalance
getTransactionHistory
```

Test-support RPCs remain unreachable from Worker `fetch`.

## Invariants honored

- Every durable mutation runs inside one `transactionSync` section.
- `economic_operations`, `ledger_transactions`, `identity_bindings`, and
  `idempotency_records` are append-only at the storage floor.
- RegistrationIntent lifecycle constraints enforce fixed expiry, latest-wins active intent behavior,
  immutable proof/identity columns, and terminal transitions.
- Identity binding lookup is an exact `(issuer, subject)` match.
- A successful protected transfer and its idempotency record commit in the same serialized section;
  expected failures record nothing and leave the key retryable.
- Monetary values round-trip exactly within the safe-integer domain.
- The treasury is the singleton system wallet, seeded empty; initial funding is an explicit
  `TOKEN_ISSUANCE`.
- The unchanged `@communitytoken/economic-contract` suite remains the economic compatibility
  contract.
