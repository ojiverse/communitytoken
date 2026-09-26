# Immutability by Default

Values are immutable by default.

A state change should be expressed as an explicit transition rather than as uncontrolled mutation of
an object that other code may still observe.

## Why immutability is the default

Mutation makes the meaning of a reference depend on time, operation order, hidden aliases, and future
writers.

Immutable values remain stable after construction, can be shared without coordinating writes, and
allow local reasoning from inputs to outputs.

They also make type-level guarantees stronger because a validated value cannot silently change behind
a trusted reference.

## State transitions

When state must change, the owning boundary defines the transition and the invariants it preserves.

For CommunityToken, committed Transaction history is immutable even though Account balances change
through accepted ISSUE and TRANSFER transitions.

A correction is another valid Transaction, not a rewrite of the historical fact.

## Mutation as an exception

Platform integration or a demonstrated performance constraint may require mutation.

When mutation is necessary, confine it to the smallest owner and lifetime, do not leak mutable
references, make permitted transitions explicit, and provide runtime evidence for properties the type
system cannot prove.

Convenience alone is not sufficient reason to expand the mutable surface.

## Type expression

Use readonly or equivalent type constructs where they strengthen the design.

A constant binding alone does not make the referenced value immutable, so the type model and exposed
API must preserve the intended boundary.

Immutability is the default assumption. Code that introduces wider mutation carries the burden of
justification.
