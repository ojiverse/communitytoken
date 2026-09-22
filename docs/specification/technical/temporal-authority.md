# Temporal Authority

Time used for a mutation is part of the transaction boundary.

## One authoritative instant

Every serialized mutation has exactly one authoritative timestamp, now_ms.

That timestamp is sampled after the serialized transaction begins and before application logic
inside the transaction makes time-dependent decisions.

The value is immutable for the lifetime of the transaction.

## Consistency

Every timestamp created by the same transaction uses the same now_ms when those timestamps describe
that transaction's state change.

A single transaction therefore cannot cross a policy boundary merely because wall-clock time
advanced during execution.

This applies to economic history, identity lifecycle changes, registration state, reward eligibility,
and replay state whenever they are created or consumed by the same mutation.

## Caller isolation

An external caller cannot supply the authoritative transaction time.

Transport fields, request timestamps, client clocks, and provider timestamps may be evidence or
input data, but they cannot replace now_ms for mutation authority.

## Testability

A conforming system may substitute a controlled time source for tests.

The substitution must occur at the time-authority boundary, not by adding caller-controlled time to
the product interface.

## Daily Reward

Daily Reward window membership is determined only from the transaction's authoritative now_ms and
the community-global window sequence defined by the Daily Reward specification.

Before a claim or policy change observes the current Daily Reward window, stale materialized window
state is advanced until it contains that same now_ms.

A policy change is applied only after any window transition already implied by now_ms has been
resolved. A change committed after a boundary therefore targets a future window rather than changing
the window that has already begun.

Request arrival time, client time, and transaction completion time do not determine Daily Reward
window membership.

Two Users whose serialized transactions fall on opposite sides of a window boundary may correctly
belong to different windows. Two transactions whose authoritative times belong to the same window
must observe the same community-global window identity and policy snapshot.
