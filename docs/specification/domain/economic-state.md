# Economic State

This document defines the authoritative monetary state and the entities on which primitive
Transactions operate.

## Principal

A Principal is a stable internal subject that may own Accounts.

The domain does not classify a Principal as human, bot, AI agent, service, organization, community,
system, or another subtype.

Principal identifiers are opaque and are not external-provider identifiers.

## Account

An Account is a non-negative integer balance container owned by exactly one Principal.

There is no primitive Account kind.

A higher-level application may designate an Account for a product purpose, but that designation does
not alter Account structure or primitive monetary validity.

## Transaction

A Transaction is one accepted immutable monetary transition.

There are exactly two kinds: ISSUE and TRANSFER.

An ISSUE records:

- one issuer Principal;
- one destination Account;
- one positive amount;
- one commit time.

A TRANSFER records:

- one source Account;
- one destination Account;
- one positive amount;
- one commit time.

The issuer Principal on ISSUE is the durable answer to which Principal created that supply.

It is not a generic actor field. TRANSFER does not acquire an actor merely to mirror application
authorization or product provenance.

Feature reason, campaign identity, request origin, and simulation-policy provenance remain outside
primitive Transaction semantics.

## Structural invariants

Every Account references exactly one existing Principal.

Every ISSUE references one existing issuer Principal and one existing destination Account.

Every TRANSFER references existing source and destination Accounts.

Committed Transaction history is immutable. A later correction is a later valid Transaction rather
than a rewrite.

## Monetary domains

The maximum monetary value is two to the power of fifty-three minus one.

Transaction amount is an integer from one through that maximum.

Account balance and total supply are integers from zero through that maximum.

Every accepted transition leaves affected balances and total supply inside those domains.

## Supply

Total supply is the sum of all Account balances.

Because the model currently has no burn primitive, total supply is also the sum of amounts of all
committed ISSUE Transactions.

These views must remain equal.

TRANSFER does not change total supply.

## Initial state

Before any ISSUE, total supply is zero and every existing Account has zero balance.

Creating a Principal, Account, IdentityBinding, or application default-Account designation creates no
monetary value and no Transaction.
