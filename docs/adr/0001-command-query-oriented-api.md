# ADR-0001: Prefer command/query-oriented application APIs over resource-oriented CRUD APIs

Status: Accepted

Date: 2026-09-21

Last aligned with architecture: 2026-09-26

Scope: CommunityToken trusted application API

## Context

CommunityToken persists state such as Principals, Accounts, IdentityBindings, Transactions,
idempotency records, and registration state.

Those records are not independently mutable resources exposed to callers. The system accepts
application commands and queries, applies authorization and domain rules, and commits only valid
state transitions.

The primitive economic architecture now reduces monetary validity to ISSUE and TRANSFER, but that
reduction strengthens rather than weakens this decision. Product operations such as registration,
administrative issuance, administrative distribution, user transfer, balance, and history still
have application semantics that cannot be represented safely as arbitrary record mutation.

The trusted boundary also resolves an ExternalIdentity to a Principal and performs the authorized
action in one application request. Exposing a generic resolve-then-impersonate protocol would weaken
the identity boundary.

## Decision

The trusted CommunityToken API is command/query oriented.

Commands request meaningful application transitions. Queries request application-defined
projections.

The API does not expose general create, update, or delete authority over Principal, Account,
IdentityBinding, Transaction, or persistence records.

The primitive ledger remains below this boundary. Application commands translate authorized product
intent into ISSUE or TRANSFER rather than allowing callers to set balances or insert Transaction
history directly.

## Why commands remain meaningful

A primitive Transaction records the monetary fact but does not contain product reason, actor,
eligibility, or institutional role.

That higher-level meaning belongs to the application or feature that requested the primitive
transition. A command therefore remains the correct boundary for expressing product intent without
polluting the ledger.

Administrative distribution is a useful example. At the ledger layer it is simply TRANSFER from the
application-designated reserve Account to a recipient Account. At the application boundary it still
has distinct authorization, recipient resolution, visibility, and error semantics.

## Invalid intermediate states

Economic and identity changes may span multiple durable records.

A valid registration may create a Principal, default Account, IdentityBinding, and consume a
registration intent atomically. A protected transfer may update balances, append one Transaction,
and persist an idempotency result atomically.

Generic CRUD would expose partial states that are not valid application outcomes. Command
orchestration keeps those transitions indivisible.

## Identity delegation

An authenticated adapter may assert the ExternalIdentity associated with a user-facing action.

CommunityToken resolves that identity to a Principal and performs the authorized application action
inside the trusted boundary. The adapter does not receive a reusable internal Principal identifier
that functions as an impersonation credential.

## Idempotency

Idempotency belongs to one logical mutation command at the application boundary.

It protects duplicate delivery and is committed consistently with the protected mutation. It does
not infer whether two different feature requests are semantically the same business event.

## Consequences

Application endpoints may look procedural rather than resource-oriented.

Adding a persisted entity does not imply adding CRUD endpoints for it.

Adding a feature reason does not imply adding a new primitive Transaction kind when ISSUE or TRANSFER
already describes the monetary effect.

A future external API may present a different interface, but it must translate requests into the same
authorized application boundary rather than gaining direct persistence authority.

## Rejected alternative

A generic CRUD API would make persistence representation the primary mutation contract.

That would expose states callers should never be able to construct directly, obscure authorization
ownership, and couple clients to implementation details. It remains rejected.
