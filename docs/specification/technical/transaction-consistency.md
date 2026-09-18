# Transaction Consistency

Every state-changing application operation executes inside one serialized atomic section.

## Serialization

For one community, there is exactly one serialization authority for durable mutations.

Two concurrent mutations must be observationally equivalent to some serial ordering.

A mutation may not observe a partially committed concurrent mutation.

## Atomicity

All durable effects of one accepted application operation commit together or not at all.

When a transaction aborts, no write performed within that transaction is observable afterward.

A domain-level rejection is not a partial success. Unless an outer application operation explicitly
persists a separate non-economic result, the rejected economic operation itself writes no economic
state.

## Outermost ownership

The outermost application orchestration owns the transaction.

Feature state that protects or qualifies an economic mutation, such as eligibility or replay state,
must be composed in the same transaction as the protected mutation when their correctness depends on
one another.

Nested or re-entrant transactions are not part of the contract.

## Transaction capability lifetime

Repositories available through a transaction context are capabilities scoped to that transaction.

After the transaction closes:

- the context is permanently unusable;
- repository handles obtained from it are permanently unusable;
- a later transaction must not make an earlier handle valid again.

Values read from a repository must not provide a mutable alias to durable state. State changes occur
only through the mutation operations owned by the active transaction.

## Synchronous critical section

The atomic section contains no external I/O and does not suspend.

Work that may wait on an external system must complete before entering the serialized section.

Returning a thenable from the section is a contract violation and aborts the transaction, regardless
of whether the thenable is represented as an object or function.

## Composition

A use-case operation may run inside an already-open transaction context.

This permits an outer feature operation to compose multiple invariant-preserving operations without
opening another transaction or introducing an intermediate committed state.
