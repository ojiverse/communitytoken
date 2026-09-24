# ADR-0002: Namespace the application API under /api/v1

- Status: Accepted
- Date: 2026-09-21
- Scope: CommunityToken HTTP surface

## Context

ADR-0001 defines the trusted core as a command/query-oriented application API rather than a generic
resource-oriented CRUD API.

The initial Phase 2 implementation grouped delegated operations under `/internal/*` and
administrative operations under `/admin/*`. That layout correctly separated authorization groups,
but `internal` is misleading: these endpoints are not defined by private-network reachability, and
the path itself is not a security boundary.

The namespace should communicate what kind of HTTP surface a caller is using without encoding the
current adapter implementation or pretending that URL hierarchy is the authority model.

CommunityToken also has protocol-specific public ingress that is not part of the application API:
the OIDC callback. Discord interactions are a separate external-protocol surface owned by the Discord
adapter rather than by the core application API.

## Decision

The CommunityToken HTTP surface is partitioned as follows:

```text
/api/v1/*
    versioned command/query application API

/api/v1/admin/*
    administrative-capability subset of the application API

/auth/*
    authentication-protocol endpoints

/interactions
    Discord interactions protocol ingress when the Discord adapter is deployed
```

The current core application routes are:

```text
POST /api/v1/registration-intents
POST /api/v1/balance
POST /api/v1/history
POST /api/v1/transfers

POST /api/v1/admin/issuances
POST /api/v1/admin/distributions
GET  /api/v1/admin/treasury/balance
GET  /api/v1/admin/treasury/history

GET  /auth/oidc/callback
```

The non-admin `/api/v1/*` operations are currently authorized for the `discord-adapter` service
principal. Administrative operations under `/api/v1/admin/*` require the `admin-api` principal.

Authorization is route metadata and application policy, not a raw string-prefix security check.
Because `/api/v1/admin/*` is lexically below `/api/v1/*`, implementations must not authorize the
non-admin principal merely by matching the broader prefix.

## Rationale

### Remove the false meaning of internal

`internal` commonly implies private-network reachability, deployment locality, or an interface that
is inaccessible outside a trusted network. None of those properties defines the CommunityToken
boundary.

The API is protected by authenticated service principals and authorization. A route does not become
trusted because its pathname contains `internal`.

### Use API to identify the application protocol surface

`/api` communicates that the route belongs to CommunityToken's machine-facing application
contract without claiming REST resource semantics.

ADR-0001 remains authoritative for the interaction model: the API carries commands and queries whose
meaning is defined by application operations and domain transitions.

### Version the independently deployed HTTP contract

The core Worker and its callers are independently deployed. `/v1` provides an explicit boundary for
future breaking HTTP-contract changes.

Versioning the path does not require parallel long-term operation of multiple versions. A later
version may replace v1 operationally while still making the breaking contract change explicit.

### Keep administrative authority visible

Administrative issuance, distribution, and treasury inspection are qualitatively different
capabilities from delegated User operations. Keeping them under `/api/v1/admin/*` makes that
difference visible to operators and reviewers.

The namespace is descriptive, not authoritative. Application-level authorization remains required.

### Keep external protocols outside the application API namespace

`/auth/oidc/callback` participates in the OIDC protocol rather than the command/query API.

`/interactions` participates in the Discord interactions protocol. The Discord adapter verifies and
translates that external protocol before invoking CommunityToken application operations over their
supported boundary.

These endpoints therefore remain outside `/api/v1`.

## Rejected alternatives

### /internal/*

Rejected because it implies a network or deployment trust property that does not exist. It also makes
the actual authentication and authorization boundary less obvious.

### /rpc/*

Rejected because ADR-0001 is about state-transition-oriented application semantics, not commitment to
an RPC-branded transport style. The URL should not encode more implementation style than necessary.

### /adapter/*

Rejected because it couples the core contract to the current caller role. Future trusted callers may
use the same application operations without being Discord adapters.

### /service/*

Rejected because it is too broad to explain the contract and does not distinguish the application API
from other service-facing protocol endpoints.

### /delegated/*

Rejected because delegation is an authorization relationship, not the complete meaning of every
query and command exposed by the application API.

## Migration

PR-3 shipped the first trusted API implementation using `/internal/*` and `/admin/*`.

Before PR-4 added new routes, the existing implementation was renamed to the accepted namespace. The
service had not reached production rollout, so no compatibility aliases or redirect routes were
introduced.

The mapping was:

```text
/internal/balance                -> /api/v1/balance
/internal/history                -> /api/v1/history
/internal/transfers              -> /api/v1/transfers

/admin/issuances                 -> /api/v1/admin/issuances
/admin/distributions             -> /api/v1/admin/distributions
/admin/treasury/balance          -> /api/v1/admin/treasury/balance
/admin/treasury/history          -> /api/v1/admin/treasury/history
```

The old paths became `404 not_found`.

Because the idempotency fingerprint includes the request path, the rename changed transfer
fingerprints. No compatibility or record migration was required before production rollout; tests and
fixtures use the new path consistently.

## Consequences

- Future application commands and queries live under `/api/v1`.
- Administrative application operations live under `/api/v1/admin`.
- Protocol ingress remains outside the application API namespace.
- Route authorization must be explicit and must not rely solely on pathname hierarchy.
- Adding a new caller does not require adding a caller-named namespace.
- A future breaking application HTTP contract uses a new API version rather than silently changing
  v1 semantics.
