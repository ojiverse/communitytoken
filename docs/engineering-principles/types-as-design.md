# Types as Design

The type system is a design medium, not merely a tool for annotating finished code. A strong design
expresses domain concepts, valid states, permitted transitions, ownership, and boundary contracts
as types before implementation logic is written.

The primary objective is to make code that contradicts the design fail to compile. When an invalid
state cannot be represented and an invalid operation cannot be called, an entire class of defects
is removed before tests or runtime checks are involved.

## Types as proof obligations

In TypeScript, a type can be understood as a set of possible values. Relationships among types
describe which values and operations are permitted. The compiler checks those relationships across
the program and rejects code that cannot satisfy them.

Within the model expressed by the program, successful type checking is a machine-checked proof that
the code satisfies those static constraints. The quality of that proof depends on the quality of
the model. Broad types, unchecked assertions, `any`, and unvalidated external data weaken it by
admitting values that the design did not account for.

The type system should therefore be used as fully as practical: distinguish domain concepts even
when their runtime representation is similar, represent alternatives explicitly, make transitions
total, and require exhaustive handling of every valid case.

## Design before logic

Implementation should begin by translating requirements and invariants into the type system. This
usually reveals missing states, ambiguous ownership, and invalid transitions before operational
code obscures them.

The essential engineering work is constructing a model in which correct implementation is natural
and contradictory implementation is rejected. Writing the runtime logic is then the completion of
that model, not the first expression of the design.

## Relationship to tests

Tests remain necessary for runtime behavior, algorithms, integration boundaries, and values that
enter from systems the compiler cannot inspect. Runtime inputs must be validated before they are
treated as trusted domain types.

Tests should complement the static model rather than compensate for an avoidably weak one. First
encode the design so unintended code cannot compile. Then test the behavior that types alone cannot
prove.

This follows the [Single Source of Truth](./single-source-of-truth.md) principle: for invariants that
can be expressed statically, the type model is their authoritative expression and the language's
type checker is its native enforcement and proof mechanism. A separate test should not recreate a
guarantee the type system can establish directly.
