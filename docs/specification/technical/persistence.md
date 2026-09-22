# Persistence

Persistence must preserve domain structure independently of application correctness.

This specification defines durable guarantees, not a storage schema.

## Durability

Committed state survives process, instance, or runtime restart.

Ephemeral memory is never the sole authority for balances, identity bindings, eligibility, replay
state, Daily Reward policy/window history, or economic history.

## Structural constraints

The persistence boundary must make the following invalid states impossible or reject them:

1. more than one wallet owned by the same User;
2. a system wallet with a User owner;
3. a user wallet without a User owner;
4. more than one User bound to the same ExternalIdentity;
5. an economic actor whose kind and identifier presence disagree;
6. a ledger movement referring to nonexistent required economic state;
7. a balance outside the WalletBalance domain;
8. more than one successful Daily Reward claim for the same User and reward window;
9. more than one Daily Reward claim referring to the same economic operation.

The unique treasury invariant must hold for each deployment.

## Economic history

EconomicOperation and LedgerTransaction history is append-only.

Existing economic history is not updated or deleted to express correction.

Persistence must enforce history immutability as a hard structural floor rather than relying only on
application convention.

## Daily Reward history

Committed Daily Reward policy revisions, materialized reward windows, and successful claim records
are append-only historical state.

A policy revision does not mutate an existing window. A claim record does not move between windows or
economic operations after commit.

Persistence must preserve enough information in each materialized window to determine the amount and
reset phase that governed claims in that window without consulting mutable configuration.

## Identifier integrity

Internal identifiers are opaque and type-distinct at provider-independent boundaries.

An internally generated identifier must be unique in its entity namespace and must not be derived
from mutable or provider-specific identity data.

Rehydrating a persisted identifier restores its internal type; it does not reinterpret an external
identifier as an internal one.

## Numeric integrity

Every persisted monetary value must round-trip exactly within the monetary domains defined by the
economic specification.

A persistence representation that can silently lose integer precision is non-conforming.

## Authority

Derived indexes, caches, or summaries may exist, but they are not independent authorities for the
underlying domain facts.

If a derived representation disagrees with authoritative persisted state, the authoritative state
wins.
