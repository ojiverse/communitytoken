# Transaction Consistency

Every state-changing application operation executes inside one serialized atomic section.

## Serialization

For one deployed community there is exactly one serialization authority for durable mutations.

Concurrent mutations must be observationally equivalent to some serial ordering.

A mutation may not observe a partially committed concurrent mutation.

## Atomicity

All durable effects of one accepted application operation commit together or not at all.

For a primitive monetary mutation, the Transaction and every required Account balance change are
indivisible.

When idempotency, registration, identity, or another application record must be consistent with that
monetary mutation, the owning application operation composes those effects in the same outer atomic
section.

A rejection is not partial success. No primitive Transaction is committed for a rejected ISSUE or
TRANSFER.

## Outermost ownership

The outermost application orchestration owns the serialized section.

Primitive economic operations may run inside an already-open transaction context so the application
can compose them with other state without exposing an intermediate committed state.

Nested or re-entrant transaction ownership is not part of the contract.

## Feature and simulation state

Feature or simulation state remains outside the primitive economic model.

If correctness requires a higher-level record and a monetary Transaction to become visible together,
the application may compose both through one supported atomic boundary.

That composition does not make the feature or simulation record part of Transaction semantics.

## Transaction-scoped capabilities

Repository handles available through an active transaction context are capabilities scoped to that
context.

After the context closes, those handles remain unusable.

Values returned from persistence must not provide mutable aliases that allow durable state to be
changed outside supported mutation operations.

## Synchronous critical section

The serialized critical section performs no external interaction and does not suspend while holding
the mutation capability.

Network calls and other asynchronous work complete before the critical section begins.

If execution attempts to escape the supported synchronous section before producing its final result,
the mutation must not commit.

## Recovery model

A process or runtime failure before commit leaves no partial durable mutation.

A failure after commit may require request replay or operational diagnosis, but it must not require
rewriting committed Transaction history to repair monetary state.
