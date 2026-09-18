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

Daily Reward derives reward_window_id only from the transaction's authoritative now_ms and the
domain formula in the Daily Reward specification.

All eligibility checks and the corresponding successful claim observe that same value.
