# Loose Coupling and High Cohesion

A design should place closely related responsibilities together and minimize the knowledge that
separate components require about one another. These two goals reinforce each other: a cohesive
owner can expose a small contract, and a small contract allows its consumers to remain loosely
coupled.

## High cohesion

A cohesive component owns one coherent capability, including the invariants and state transitions
required to provide it. Its contents change for the same underlying reasons and can be understood
as one design unit.

Cohesion is not measured by file size. Splitting one capability across many thin wrappers can make
ownership less clear, while a larger component may still be cohesive when every part protects the
same invariants.

## Loose coupling

Components should depend on the smallest stable contract required for collaboration. A consumer
should not know another component's storage layout, internal workflow, incidental types, or sequence
of private operations.

Loose coupling does not mean eliminating meaningful dependencies. Dependencies required by the
domain should be explicit, directional, and represented in types. The goal is to prevent changes in
one owner from forcing unrelated changes elsewhere.

## Design rule

Assign each capability and its invariants to one owner. Keep the decisions needed to preserve those
invariants inside that boundary. Expose only the behavior and data that consumers genuinely need,
using a contract that does not reveal replaceable implementation choices.

Before creating or changing a boundary, ask:

- Which capability and invariants belong together?
- Do these elements change for the same reason?
- Which component has the knowledge required to make this decision?
- What is the minimum contract a consumer needs?
- Does the contract expose an implementation detail or mutable state?
- Can either side change internally without requiring an unrelated change on the other side?
- Is an abstraction representing a real boundary, or merely adding indirection?

High cohesion localizes knowledge and change. Loose coupling keeps that knowledge from leaking into
the rest of the system.
