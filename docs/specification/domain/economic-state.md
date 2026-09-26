# Economic State

This document defines the authoritative monetary state and the entities on which primitive
transactions operate.

## Principal

A Principal is a stable internal owner of Accounts.

The domain does not classify a Principal as human, bot, AI agent, service, organization, community,
system, or any other subtype.

A Principal may own zero or more Accounts at the primitive-model level. Product policy may require
particular Accounts to exist for particular application flows.

Principal identifiers are opaque and are not external-provider identifiers.

## Account

An Account is a balance container.

Every Account has exactly one owning Principal and exactly one balance.

There is no primitive Account kind. Terms such as user account, treasury, reserve, escrow, or system
account describe application or scenario roles and do not alter monetary validity.

No Account may exist without an owning Principal.

## Transaction

A Transaction is one accepted immutable monetary transition.

There are exactly two Transaction kinds: ISSUE and TRANSFER.

An ISSUE identifies one destination Account and one amount.

A TRANSFER identifies one source Account, one destination Account, and one amount.

Transaction identity and commit time are durable facts. Actor, feature reason, campaign, policy,
institutional role, and simulation provenance are not primitive Transaction semantics.

Higher-level records may reference a Transaction identifier when they need to retain those meanings.

## Structural invariants

Every Account belongs to exactly one Principal.

Every Transaction refers only to Accounts that existed for that accepted transition.

An ISSUE has no source Account.

A TRANSFER has both source and destination Accounts.

Committed Transaction history is immutable. A later correction is represented by a later valid
Transaction rather than rewriting historical monetary facts.

## Monetary domains

The current maximum monetary value is two to the power of fifty-three minus one.

A transaction amount is an integer from one through that maximum value.

An Account balance is an integer from zero through that maximum value.

Total supply is an integer from zero through that maximum value.

Every accepted transition must leave all affected balances and total supply inside those domains.

## Supply

Total supply is the sum of all Account balances.

Because the current model has no burn primitive, total supply is also the sum of amounts of all
committed ISSUE Transactions.

These two views must remain equal.

TRANSFER does not change total supply.

Whether an Account is considered circulating, reserved, locked, or otherwise excluded from an
application or simulation metric is outside the primitive supply invariant.

## Initial monetary state

Before any ISSUE, total supply is zero and every existing Account balance is zero.

Creating a Principal or Account does not create monetary value and does not create a Transaction.
