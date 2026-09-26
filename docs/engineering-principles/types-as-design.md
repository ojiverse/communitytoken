# Types as Design

The type system is a design medium.

Types can express domain concepts, valid states, permitted transitions, and boundary contracts before
runtime logic is written.

The goal is to make code that contradicts stable design assumptions difficult or impossible to
compile.

## Type the confirmed distinction

Use distinct types when the distinction is real and stable.

Principal identifiers, Account identifiers, Transaction identifiers, and ExternalIdentity components
may share a runtime representation while carrying different meaning.

The type system should preserve that meaning across boundaries.

Do not create a type hierarchy for an unconfirmed taxonomy. Principal kinds or Account roles should
not appear merely because current product data can be classified that way.

## Encode alternatives precisely

When a model has real alternatives, represent them explicitly and handle them exhaustively.

ISSUE and TRANSFER are such an alternative because they have different monetary effects and required
references.

Distribution, peer-to-peer payment, and treasury payment are not primitive alternatives because they
share the same TRANSFER monetary semantics.

Types should follow the invariant rather than product labels.

## External data

Runtime inputs remain untrusted until validated.

After validation, convert them into the strongest internal type that accurately represents the
confirmed contract.

Unchecked assertions, broad dynamic types, and accidental string interchange weaken the proof value
of the type model.

## Relationship to tests

Static types prove only properties represented in the type system.

Tests remain necessary for arithmetic, persistence, runtime integrations, protocol behavior, and
concurrency.

Use tests to complement the type model rather than to compensate for distinctions that could have
been made structurally impossible.

The strongest design uses types for stable structural truth and runtime evidence for properties that
cannot be proven statically.
