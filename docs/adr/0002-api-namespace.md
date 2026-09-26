# ADR-0002: Namespace the application API under /api/v1

Status: Accepted

Date: 2026-09-21

Last aligned with architecture: 2026-09-26

Scope: CommunityToken HTTP surface

## Context

ADR-0001 defines a command/query-oriented application boundary.

Earlier Phase 2 work used internal and admin path prefixes. The internal label was misleading because
trust comes from authentication and authorization, not network placement or pathname.

CommunityToken also exposes protocol-specific ingress that is not part of the application API, such
as the OIDC callback. Discord interactions are owned by a separate adapter.

## Decision

The versioned application API lives under /api/v1.

Administrative-capability operations live under /api/v1/admin.

Authentication-protocol ingress lives under /auth.

Discord interaction ingress lives at /interactions on the separate Discord adapter.

The namespace communicates surface ownership but is not itself an authorization mechanism.

## Current product routes

The current Phase 2 product includes routes for registration intents, balance, history, transfers,
administrative issuance, administrative distribution, and administrative reserve inspection.

The existing treasury spelling in administrative reserve-inspection routes may remain for Phase 2
compatibility. It is application vocabulary and must not be interpreted as a primitive Account kind.

## Versioning

The CommunityToken Worker and its callers are independently deployed.

The v1 namespace makes a breaking application contract change explicit. It does not require multiple
versions to operate indefinitely.

## Administrative visibility

Administrative issuance, distribution, and reserve inspection are capabilities distinct from
delegated user actions.

Keeping them under the admin namespace makes that operational distinction visible while leaving
authorization enforcement to the application.

## Protocol ingress

The OIDC callback participates in an authentication protocol rather than the command/query API.

The Discord interaction endpoint participates in the Discord protocol and belongs to the adapter,
which translates verified interactions into supported CommunityToken application requests.

These protocol endpoints therefore remain outside /api/v1.

## Rejected alternatives

An internal namespace was rejected because it implies a network trust property that does not exist.

An rpc namespace was rejected because the architectural decision is about application semantics, not
branding the transport as RPC.

Adapter- or service-named namespaces were rejected because they couple the core contract to current
callers.

## Consequences

Future application commands and queries live under a versioned API namespace.

Protocol ingress remains separate.

Route authorization must be explicit and cannot rely on path hierarchy alone.

A future breaking HTTP contract uses a new API version or another explicit migration rather than
silently changing v1 semantics.
