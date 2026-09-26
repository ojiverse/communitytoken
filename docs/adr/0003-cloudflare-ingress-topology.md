# ADR-0003: Isolate Cloudflare resources by service while sharing one account

Status: Accepted

Date: 2026-09-25

Last aligned with architecture: 2026-09-26

Scope: Production Cloudflare service and resource topology

## Context

CommunityToken, its Discord adapter, and future feature or simulation services may run in one
OJIverse Cloudflare account for operational simplicity.

Account co-location must not collapse application, trust, or persistence boundaries. A Cloudflare
binding grants direct capability to a platform resource, so bindings are part of service authority.

The public deployment also needs two independently deployable Workers on one hostname: CommunityToken
for the application surface and the Discord adapter for the exact interactions path.

## Decision

Use one OJIverse Cloudflare account as the operational container while keeping deployable services
independently owned at the Worker and resource-binding level.

CommunityToken owns its Worker, CommunityState Durable Object namespace, persistence, secrets, and
the token.ojiver.se application origin.

The Discord adapter owns its Worker and adapter-specific configuration and is attached only to the
interactions path.

Future feature or simulation services own their own state and receive only the application authority
required by their concrete use case.

The shared account is an operational boundary only. It does not imply shared mutable state.

## Persistence isolation

Only CommunityToken may receive bindings granting direct access to CommunityToken persistence.

Other services must not receive the CommunityState binding, direct SQLite access, or future
CommunityToken-owned persistence bindings.

They must not import persistence implementation in order to mutate Principal, Account, Transaction,
IdentityBinding, or application state.

A service that needs monetary movement requests an authorized application operation that eventually
produces ISSUE or TRANSFER.

## Cross-service integration

The default integration boundary is the authenticated CommunityToken HTTP application API.

Cloudflare account co-location must not become a shortcut to shared storage.

A Service Binding may be reconsidered later as a transport choice only when a concrete requirement
justifies the additional deployment coupling. It does not redefine application semantics.

## Feature and simulation responsibility

Feature services own feature policy and state such as eligibility, cadence, claims, campaigns, and
product provenance.

Simulation services own scenario definitions, behavioral agents, policy state, and simulation
provenance.

Neither layer may redefine Account roles as primitive ledger types or bypass CommunityToken
persistence. Higher-level records may reference resulting Transaction identifiers.

## Authorization

Resource isolation does not replace application authorization.

A future service receives only the smallest authority required by its concrete use case. Running in
the same Cloudflare account is never sufficient reason to grant administrative economic authority.

Generic RBAC or plugin infrastructure is not introduced before a concrete consumer requires it.

## Current ingress realization

CommunityToken is attached as the Custom Domain token.ojiver.se.

The Discord adapter is attached as the exact Worker Route token.ojiver.se/interactions.

The adapter calls CommunityToken through ordinary HTTPS requests to token.ojiver.se. Because the
adapter owns only the exact interactions path, calls to the application API reach the CommunityToken
origin.

The Phase 2 topology deliberately avoids a wildcard adapter route, global public-fetch compatibility
flags, and a Service Binding.

Production verification belongs to issue #22.

## Consequences

The account remains operationally simple while direct resource authority stays visible in each
service's bindings.

Plugin or simulation state changes do not require sharing CommunityToken persistence.

A service can later move to another account or runtime without changing the primitive economic model
as long as the supported application contract remains available.

The cost is that each service owns its own deployment, credentials, migrations, and monitoring.

## Rejected alternatives

A shared database was rejected because storage representation would become the integration boundary.

Binding CommunityToken persistence directly into plugins or simulations was rejected because it
bypasses authorization and atomicity.

Separate Cloudflare accounts for every service are not required initially, though a future
administrative or blast-radius requirement may justify them.

A Service Binding is not the default contract because it couples integration to the current platform
topology.

## Documentation boundary

This ADR records Cloudflare-specific architectural rationale.

Runtime-independent semantics remain under docs/specification. Verified deployment and secret
provisioning belong in operations documentation rather than normative specifications.
