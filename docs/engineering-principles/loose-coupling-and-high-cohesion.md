# Loose Coupling and High Cohesion

A cohesive component owns one coherent capability and the invariants required to provide it.

Loosely coupled components depend only on the smallest stable contract required for collaboration.

These properties reinforce one another: clear ownership enables a small interface, and a small
interface prevents unrelated knowledge from leaking across boundaries.

## High cohesion

Place decisions together when they change for the same underlying reason.

The primitive economic kernel owns monetary arithmetic and invariants because ISSUE and TRANSFER are
evaluated from the same monetary facts.

Identity proof, product authorization, treasury designation, feature policy, and simulation behavior
change for different reasons and therefore remain outside that kernel.

Cohesion is not measured by file size or number of wrappers.

## Loose coupling

A consumer should not need another component's storage layout, private workflow, runtime-specific
types, or internal sequence of operations.

The Discord adapter depends on the supported CommunityToken application contract rather than
Principal or Account persistence.

Future feature and simulation consumers should follow the same rule.

## Design questions

Before changing a boundary, identify which invariant is owned there, what information that owner
requires, what consumers actually need, and whether the proposed contract exposes a replaceable
implementation detail.

Do not create an abstraction only to add indirection.

A useful abstraction represents a real shared invariant or trust boundary.

## Outcome

High cohesion localizes change.

Loose coupling allows the owner to evolve internally without forcing unrelated consumers to change.

Together they keep architecture aligned with responsibility rather than repository structure.
