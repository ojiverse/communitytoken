# ADR-0003: Isolate Cloudflare resources by service while sharing one account

- Status: Accepted
- Date: 2026-09-25
- Scope: Production Cloudflare service/resource topology

## Context

CommunityToken and future feature services/plugins may run in one OJIverse Cloudflare account for
operational simplicity. Account co-location must not collapse application, trust, or persistence
boundaries.

Cloudflare bindings grant a Worker direct capability to platform resources. Resource bindings are
therefore part of service authority, not shared account-wide infrastructure.

The current public ingress also needs two independently deployable Workers on one hostname:
CommunityToken core at `token.ojiver.se` and the Discord adapter at
`token.ojiver.se/interactions`.

## Decision

Use one OJIverse Cloudflare account as the operational container while keeping every deployable
service/plugin independently owned at the Worker and resource-binding level.

```text
Cloudflare account
├ CommunityToken core
│  ├ Worker
│  ├ CommunityState Durable Object namespace
│  ├ core-owned secrets/config
│  └ token.ojiver.se
├ Discord adapter
│  ├ Worker
│  ├ adapter-owned secrets/config
│  └ token.ojiver.se/interactions
└ feature/plugin
   ├ Worker
   ├ plugin-owned state/resources
   └ plugin-specific core credential when required
```

The shared account is an operational boundary only. It does not imply shared mutable state or shared
runtime authority.

## Resource ownership

Every mutable Cloudflare resource has one owning service/plugin. A service may bind resources required
by its domain, such as Durable Objects, D1, KV, R2, Queues, Workflows, or scheduled triggers.

A plugin is not required to use the same persistence architecture as CommunityToken or another
plugin. Resource names and Wrangler configuration should make owner and environment apparent where
practical.

## CommunityToken persistence isolation

Only CommunityToken core may receive bindings granting direct access to CommunityToken economic
persistence.

Other services/plugins must not receive:

- the `COMMUNITY_STATE` Durable Object binding;
- direct access to CommunityToken SQLite state;
- a CommunityToken-owned D1/KV/R2/Queue binding if one is introduced later;
- imports that bypass the supported CommunityToken application/protocol boundary to mutate core
  persistence.

A plugin that needs to cause an economic transition requests a supported CommunityToken operation. It
does not directly mutate wallet, ledger, operation, identity, or treasury state.

## Cross-service integration

Cross-service integration uses explicit application or protocol boundaries.

For CommunityToken, the default integration boundary is its authenticated HTTP application API.
Cloudflare account co-location must not become a shortcut to direct database/resource access.

A Service Binding is not part of the CommunityToken application contract. It may be reconsidered as a
transport optimization only when a concrete requirement justifies the added deployment coupling.

## Feature/plugin responsibility

A feature/plugin owns its feature-domain state and policy. For example, a future Daily plugin may own
DailyRewardPolicy, DailyRewardWindow, and DailyRewardClaim in resources bound only to that plugin.

CommunityToken sees only the authorized generic economic command, such as `DISTRIBUTION`. The plugin
decides why, when, how often, and for whom that command is requested.

## Authorization

Resource isolation does not replace application authorization.

A future plugin that needs CommunityToken authority receives only the smallest core capability
required by its concrete use case. Do not grant `admin-api` merely because both services run in the
same Cloudflare account.

Do not prebuild generic RBAC or a plugin capability framework before a concrete consumer requires it.

Runtime credentials should be service-specific where practical. Deployment credentials should also
be scoped per deployable service when the platform/IAM configuration permits it.

## Current ingress realization

For Phase 2:

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

This relies on Cloudflare behavior where a Worker Route may run before a Custom Domain Worker on the
same hostname and same-zone Worker `fetch()` may target a Worker on a Custom Domain.

Do not use a wildcard adapter route, `global_fetch_strictly_public`, or a Service Binding for this
Phase 2 topology. Production verification belongs to issue #22.

## Consequences

Benefits:

- billing, zone management, and deployment operations stay in one account;
- direct resource authority remains visible in each Worker's bindings;
- plugin state/schema changes do not require sharing CommunityToken persistence;
- a plugin can later move to another account/runtime without changing core domain semantics if the
  application protocol remains available.

Costs:

- services in one account remain operationally correlated;
- cross-service calls keep an explicit application boundary instead of shared storage;
- each plugin may need its own resource lifecycle, migrations, credentials, and monitoring.

## Rejected alternatives

### Shared database with service-owned tables

Rejected because the database would become the integration boundary and expose persistence
representations across services.

### Bind CommunityToken persistence into plugins

Rejected because it bypasses core economic/identity authorization and atomicity.

### Separate Cloudflare account for every plugin

Not required initially. Account separation may be introduced for a concrete administrative, billing,
regulatory, blast-radius, or ownership requirement.

### Service Binding as the default plugin/core contract

Rejected as the default because it couples integration to the Cloudflare deployment topology.
Application semantics remain defined by the supported CommunityToken protocol boundary.

## Documentation boundary

This ADR records Cloudflare-specific architecture rationale.

Runtime-independent domain/system semantics remain under `docs/specification/`.

Verified deployment, secret provisioning, and operator procedures belong under `docs/operations/`
and must not be copied into the normative specification tree.
