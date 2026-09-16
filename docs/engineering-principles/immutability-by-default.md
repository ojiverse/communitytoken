# Immutability by Default

Values should be immutable by default. A state change should produce a new value rather than alter
an existing value that other code may still observe.

Mutation introduces time into the meaning of data. The same reference can represent different
values at different moments, so correctness begins to depend on operation order, hidden aliases,
and knowledge of who may write next. This creates temporal coupling and makes local reasoning less
reliable.

Immutability keeps a value stable after construction. Callers can share it without coordinating
writes, functions can reason from their inputs, and state transitions remain explicit in the code.
It also gives the type system a stronger model because a validated value cannot silently change
behind a trusted reference.

## Design rule

Begin with immutable domain values, inputs, outputs, collections, and configuration. Model a change
as a transformation from the current value to the next value. Make that transition visible at the
boundary responsible for it.

In TypeScript, use readonly types and APIs to express this intent statically. `const` protects only
the binding, not the object it references, so the type model must also prevent writes to properties
and collections where immutability is required.

## Mutation as an explicit exception

Some requirements may justify mutation, such as integration with a stateful platform primitive or
a measured performance constraint. Convenience alone is not sufficient.

When mutation is unavoidable:

- identify the requirement that makes it necessary;
- confine it to the smallest possible owner and lifetime;
- do not expose mutable references across that boundary;
- make permitted transitions and preserved invariants explicit;
- provide evidence for the behavior that static types cannot prove;
- explain [why mutation is necessary](./comments-explain-why.md) when the reason is not recoverable
  from the design.

Encapsulated mutation can be an implementation detail behind an immutable interface, but it still
carries risk and must not leak into the surrounding model.

Mutability is the last representation to choose. The burden of justification belongs to the code
that introduces it; immutability requires no special exception.
