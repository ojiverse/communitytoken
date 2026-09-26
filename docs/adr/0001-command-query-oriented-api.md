# ADR-0001: Prefer command/query-oriented application APIs over resource-oriented CRUD APIs

Status: Accepted

Date: 2026-09-21

Last aligned with architecture: 2026-09-26

Scope: CommunityToken trusted application API

## Context

CommunityToken persists Principals, Accounts, IdentityBindings, Transactions, idempotency records,
registration state, and application designations such as a Principal's optional default Account.

Those records are not independently mutable resources exposed to callers.

The system accepts application commands and queries, applies authentication, authorization, identity
resolution, and domain rules, then commits only valid state transitions.

The primitive economic architecture reduces monetary validity to ISSUE and TRANSFER, but product
operations still carry application semantics that should not be expressed as arbitrary record
mutation.

## Decision

The trusted CommunityToken API is command/query oriented.

Commands request meaningful application transitions. Queries request application-defined projections.

The API does not expose general create, update, or delete authority over Principal, Account,
IdentityBinding, Transaction, or persistence records.

The application translates authorized product intent into ISSUE or TRANSFER rather than permitting
callers to set balances or insert Transaction history directly.

## Current examples

Registration proves one ExternalIdentity and creates or resolves a Principal and default Account.

Administrative issuance resolves a target ExternalIdentity to its Principal and default Account, maps
the authenticated administrative authority to an issuer Principal, and requests ISSUE.

User-facing transfer resolves sender and recipient identities to their default Accounts and requests
TRANSFER.

Balance and history are projections over a caller's default Account.

## Invalid intermediate states

A valid registration may create Principal, Account, default designation, IdentityBinding, and consume
a registration intent atomically.

A protected ISSUE or TRANSFER may update balances, append one Transaction, and persist an idempotency
result atomically.

Generic CRUD would expose partial states that are not valid application outcomes.

## Identity delegation

An authenticated adapter may assert the ExternalIdentity associated with a user-facing action.

CommunityToken resolves that identity and performs the authorized action in one trusted request.

The adapter does not receive a reusable internal Principal identifier that functions as an
impersonation credential.

## Idempotency

Idempotency belongs to one logical mutation command at the application boundary.

It prevents duplicate execution and remains distinct from feature-domain uniqueness.

## Consequences

Application endpoints may look procedural rather than resource-oriented.

Adding a persisted entity does not imply adding CRUD endpoints for it.

Adding a feature reason does not imply adding a new primitive Transaction kind when ISSUE or TRANSFER
already describes the monetary effect.

A future external API may present a different interface, but it must translate requests into the same
authorized application boundary rather than gaining direct persistence authority.

## Rejected alternative

A generic CRUD API would make persistence representation the primary mutation contract, expose states
callers should not construct directly, and obscure authorization ownership.

It remains rejected.
