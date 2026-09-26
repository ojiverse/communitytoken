# Persistence

Persistence preserves primitive monetary and identity invariants independently of application
correctness.

This specification defines durable guarantees, not database DDL.

## Durability

Committed state survives process, instance, or runtime restart.

Ephemeral memory is never the sole authority for Account balances, Principal identity bindings,
idempotency state, registration state, or Transaction history.

## Structural guarantees

Every Account persistently references exactly one existing Principal.

No primitive Account kind is required or permitted as the authority for user, treasury, reserve,
system, or other institutional roles.

Every ExternalIdentity may bind to at most one Principal.

A persisted ISSUE identifies an existing destination Account and no source Account.

A persisted TRANSFER identifies existing source and destination Accounts.

A persisted balance must remain inside the Account-balance monetary domain.

Persistence must not require a separate EconomicOperation record paired with each Transaction.

## Transaction history

Committed Transaction history is append-only.

An existing Transaction is not updated or deleted to express a correction.

Persistence must enforce historical immutability as a structural floor rather than relying only on
application convention.

Higher-level application, feature, or simulation records may reference a Transaction identifier but
do not redefine the monetary fact stored by that Transaction.

## Identifier integrity

Internal identifiers are opaque and type-distinct at provider-independent boundaries.

An internal identifier must be unique within its entity namespace and must not be derived from mutable
or provider-specific profile data.

Rehydrating a persisted identifier restores its internal identity; it does not reinterpret an
external identifier as an internal one.

## Numeric integrity

Every persisted monetary amount and balance must round-trip exactly within the monetary domain.

A persistence representation that may silently lose integer precision is non-conforming.

## Derived data

Indexes, caches, summaries, and projections may exist, but they are not independent authorities for
underlying Principal, Account, IdentityBinding, or Transaction facts.

If a derived representation disagrees with authoritative persisted state, the authoritative state
wins.

## Application-designated roles

Persistence may store application state that identifies an ordinary Principal or Account for a
specific product role, such as the current community reserve.

That designation must not alter primitive Account structure or ISSUE and TRANSFER validity.
