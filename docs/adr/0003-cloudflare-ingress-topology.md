# ADR-0003: Isolate Cloudflare resources by service while sharing one account

- Status: Accepted
- Date: 2026-09-25
- Scope: Production Cloudflare service/resource topology

## Context

CommunityToken runs on Cloudflare, and future feature services/plugins are expected to run in the same
Cloudflare account for operational simplicity.

Account co-location must not collapse application, trust, or persistence boundaries.

Cloudflare bindings grant a Worker direct capability to platform resources. A Worker can access a D1
database, Durable Object namespace, KV namespace, R2 bucket, Queue, or another bound resource only
when that capability is explicitly attached to the Worker.

The architecture therefore treats resource bindings as part of the service authority boundary, not
as shared account-wide infrastructure.

The current public ingress also needs two independently deployable Workers on one hostname:

- CommunityToken core at `token.ojiver.se`;
- Discord adapter at `token.ojiver.se/interactions`.

## Decision

Use one OJIverse Cloudflare account as the operational container, while keeping every deployable
service/plugin independently owned at the Worker and resource-binding level.

Conceptually:

```text
Cloudflare account
├ CommunityToken core
│  ├ Worker
│  ├ CommunityState Durable Object namespace
│  ├ core-owned secrets/config
│  └ token.ojiver.se
│
├ Discord adapter
│  ├ Worker
│  ├ adapter-owned secrets/config
│  └ token.ojiver.se/interactions
│
└ feature/plugin
   ├ Worker
   ├ plugin-owned state/resources
   └ plugin-specific core credential when required
```

The shared Cloudflare account is an operational boundary only. It does not imply shared mutable
application state or shared runtime authority.

## Resource ownership

Every mutable Cloudflare resource has one owning service/plugin.

A service may bind its own resources as required by its domain, for example:

- Durable Object namespaces;
- D1 databases;
- KV namespaces;
- R2 buckets;
- Queues;
- Workflows or scheduled triggers.

A plugin is not required to use the same persistence architecture as CommunityToken or another
plugin.

Resource names and Wrangler configuration should make the owning service and environment apparent
where practical.

## CommunityToken persistence isolation

Only the CommunityToken core may receive bindings that grant direct access to CommunityToken
economic persistence.

Other services/plugins must not receive:

- the `COMMUNITY_STATE` Durable Object binding;
- direct access to CommunityToken SQLite state;
- a CommunityToken-owned D1/KV/R2/Queue binding if one is introduced later;
- imports that bypass the supported CommunityToken application/protocol boundary to mutate core
  persistence.

A plugin that needs to cause an economic transition requests a supported CommunityToken operation.
It does not reproduce or directly mutate wallet, ledger, operation, identity, or treasury state.

## Cross-service integration

Cross-service integration uses explicit application or protocol boundaries.

For CommunityToken, the default integration boundary is its authenticated HTTP application API.

Cloudflare account co-location must not be used as a shortcut to replace that contract with direct
database/resource access.

A Service Binding is not part of the CommunityToken application contract. It may be reconsidered as a
transport optimization only when a concrete requirement justifies the additional deployment coupling.

## Feature/plugin responsibility

A feature/plugin owns its feature-domain state and policy.

For example, a future Daily plugin may own:

```text
DailyRewardPolicy
DailyRewardWindow
DailyRewardClaim
```

and persist those concepts in resources bound only to that plugin.

CommunityToken sees only the authorized generic economic command, such as `DISTRIBUTION`.

The plugin decides why, when, how often, and for whom that command is requested.

## Authorization

Resource isolation does not replace application authorization.

A future plugin that needs CommunityToken authority receives only the smallest core capability
required by its concrete use case.

Do not grant `admin-api` authority to a feature service merely because both run in the same
Cloudflare account.

Do not prebuild a generic RBAC or plugin capability framework before a concrete consumer requires it.

Runtime credentials should be service-specific where practical. Deployment credentials should also
be scoped per deployable service when Cloudflare/IAM configuration permits it.

## Current ingress realization

For the current Phase 2 deployment:

```text
token.ojiver.se
├ /interactions
│  -> Discord adapter Worker Route
└ all other paths
   -> CommunityToken Custom Domain Worker
```

CommunityToken is attached as the Custom Domain `token.ojiver.se`.

The Discord adapter is attached as the exact Worker Route
`token.ojiver.se/interactions`.

The adapter calls CommunityToken with ordinary HTTPS `fetch()` to
`COMMUNITYTOKEN_BASE_URL=https://token.ojiver.se`.

This relies on Cloudflare's documented behavior that a Worker on a Route may run before a Custom
Domain Worker on the same hostname, and that same-zone Worker `fetch()` may target a Worker on a
Custom Domain.

Do not use a wildcard adapter route, `global_fetch_strictly_public`, or a Service Binding for this
Phase 2 topology.

Production verification of this platform behavior belongs to issue #22.

## Consequences

Benefits:

- one Cloudflare account keeps billing, zone management, and deployment operations simple;
- direct resource authority remains least-privilege and visible in each Worker's bindings;
- plugin failures or schema choices do not require sharing CommunityToken persistence;
- a plugin can later move to another Cloudflare account/runtime without changing core domain
  semantics, provided the application protocol boundary remains available.

Costs:

- services that share an account are still operationally correlated;
- cross-service calls have an explicit network/application boundary rather than implicit shared
  storage;
- each plugin may need its own resource lifecycle, migrations, credentials, and monitoring.

## Rejected alternatives

### Shared database with service-owned tables

Rejected because the database would become the integration boundary and would let services depend on
each other's persistence representation.

### Bind CommunityToken persistence into plugins

Rejected because it bypasses core economic/identity authorization and atomicity.

### Separate Cloudflare account for every plugin

Not required initially. Account separation may be introduced later for a concrete administrative,
billing, regulatory, blast-radius, or ownership requirement.

### Service Binding as the default plugin/core contract

Rejected as the default because it couples integration to the Cloudflare deployment topology.
Application semantics remain defined by the supported CommunityToken protocol boundary.

## Documentation boundary

This ADR records Cloudflare-specific architecture rationale.

Runtime-independent domain/system semantics remain under `docs/specification/`.

Verified deployment, secret provisioning, and operator procedures belong under `docs/operations/`
and must not be copied into the normative specification tree.
