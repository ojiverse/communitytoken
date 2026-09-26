# Temporal Authority

Time used by a durable mutation is part of the transaction boundary.

## One authoritative instant

Every serialized mutation has exactly one authoritative timestamp.

That instant is sampled after the serialized section begins and before mutation logic makes
time-dependent decisions.

The value remains fixed for the lifetime of that section.

## Consistency

Every durable timestamp describing effects of the same atomic application mutation uses the same
authoritative instant when those effects are intended to represent one committed state change.

This applies to Transaction commit time, registration state, identity lifecycle changes, idempotency
records, and other application state composed in the same mutation.

A single mutation must not observe several authoritative instants merely because wall-clock time
advances while code executes.

## Primitive ledger boundary

ISSUE and TRANSFER validity does not depend on wall-clock policy.

Time is recorded for durable ordering and application consistency, but the primitive ledger does not
use time to infer eligibility, cadence, reward windows, campaign state, or other policy.

Those decisions belong to the higher-level owner that requests the primitive transition.

## Caller isolation

An external caller cannot supply authoritative mutation time.

Transport timestamps, provider timestamps, client clocks, and simulation-event timestamps may be
input or provenance, but they do not replace the authoritative commit instant for durable state.

## Testability

A conforming implementation may substitute a controlled time source in tests.

The substitution occurs at the time-authority boundary rather than by exposing caller-controlled
commit time through the product interface.
