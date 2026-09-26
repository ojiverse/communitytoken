# Persistence

Persistence preserves primitive monetary and identity invariants independently of application
correctness.

This specification defines durable guarantees, not database DDL.

## Durability

Committed Principal, Account, IdentityBinding, default-Account designation, Transaction,
idempotency, and registration state survive runtime restart.

Ephemeral memory is never the sole authority for those facts.

## Structural guarantees

Every Account references exactly one existing Principal.

Every ExternalIdentity binds to at most one Principal.

Every ISSUE references one existing issuer Principal and one existing destination Account.

Every TRANSFER references existing source and destination Accounts.

Persisted monetary values remain inside the monetary domain.

There is no primitive Account-kind column and no EconomicOperation record paired with Transaction.

## Default-Account designation

Default Account is application state, not primitive Account structure.

A Principal may have zero or one default Account designation.

A designation must reference an Account owned by the same Principal.

Registration of a new Principal creates and designates one default Account atomically with the
IdentityBinding.

No generic application-role registry is required by the current model.

## Transaction history

Committed Transaction history is append-only.

An existing Transaction is never updated or deleted to express a correction.

ISSUE issuer Principal is immutable with the rest of the Transaction.

Higher-level application, feature, or simulation records may reference a Transaction identifier but
do not redefine its monetary fact.

## Identifier integrity

Internal identifiers are opaque and type-distinct at provider-independent boundaries.

An internal identifier must be unique within its entity namespace and must not be derived from mutable
or provider-specific profile data.

## Numeric integrity

Every persisted monetary amount and balance round-trips exactly within the monetary domain.

A representation that can silently lose integer precision is non-conforming.

## Derived data

Indexes, caches, summaries, and projections are not independent authorities for underlying durable
facts.
