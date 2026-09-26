# ADR-0002: Namespace the application API under /api/v1

Status: Accepted

Date: 2026-09-21

Last aligned with architecture: 2026-09-26

Scope: CommunityToken HTTP surface

## Context

ADR-0001 defines a command/query-oriented application boundary.

Earlier Phase 2 work used internal and admin path prefixes. The internal label was misleading because
trust comes from authentication and authorization, not network placement or pathname.

CommunityToken also exposes protocol-specific ingress outside the application API, such as the OIDC
callback. Discord interactions are owned by a separate adapter.

## Decision

The versioned application API lives under /api/v1.

Administrative-capability operations live under /api/v1/admin.

Authentication-protocol ingress lives under /auth.

Discord interaction ingress lives at /interactions on the separate Discord adapter.

The namespace communicates surface ownership but is not itself an authorization mechanism.

## Phase 2 product routes after #25

The supported application surface contains registration intents, self balance, self history,
user-facing transfer, and administrative issuance.

Administrative distribution and treasury-inspection routes from the superseded model are removed
before production rollout.

The administrative issuance route is the sole current API surface that requests ISSUE.

## Versioning

The CommunityToken Worker and its callers are independently deployed.

The v1 namespace makes a breaking application contract change explicit without requiring multiple
versions to operate indefinitely.

Because production rollout has not occurred, #25 may reconcile the unshipped v1 route set directly
without compatibility aliases for removed superseded routes.

## Administrative visibility

Administrative ISSUE is a capability distinct from delegated user actions.

Keeping it under the admin namespace makes that operational distinction visible while authorization
remains an application concern.

## Protocol ingress

The OIDC callback participates in an authentication protocol rather than the command/query API.

The Discord interaction endpoint participates in the Discord protocol and belongs to the adapter.

These protocol endpoints remain outside /api/v1.

## Rejected alternatives

An internal namespace was rejected because it implies a network trust property that does not exist.

An rpc namespace was rejected because the decision concerns application semantics rather than
transport branding.

Adapter- or service-named namespaces were rejected because they couple the core contract to current
callers.

## Consequences

Future application commands and queries live under a versioned API namespace.

Protocol ingress remains separate.

Route authorization must be explicit and cannot rely on path hierarchy alone.

A future breaking HTTP contract uses an explicit version or migration rather than silently changing
deployed semantics.
