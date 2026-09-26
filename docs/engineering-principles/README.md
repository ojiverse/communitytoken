# Engineering Principles

This directory records repository-wide engineering principles that should remain useful beyond any
single feature, runtime, or architecture revision.

They are reasoning rules, not an additional policy engine.

## Reading order

Requirements and Invariants begins with the properties a design must preserve.

Single Source of Truth assigns each fact to one authoritative owner.

Loose Coupling and High Cohesion keeps related knowledge together and limits cross-boundary leakage.

Types as Design expresses stable invariants through the type system where practical.

Immutability by Default makes state transitions explicit.

Comments Explain Why reserves comments for irreducible rationale.

Deletion and Deliberate Absence explains why removing obsolete or duplicate mechanisms can improve
assurance.

Design policies under docs/design-policy apply these principles to recurring design choices.

## Current architectural example

The primitive-ledger reset demonstrates the intended use of these principles.

The monetary requirement is smaller than the old product vocabulary, so Principal, Account,
Transaction, ISSUE, and TRANSFER are the authoritative primitive concepts.

Treasury, distribution, human-user classification, feature provenance, and simulation policy remain
outside that boundary because they are owned by higher-level consumers.

The goal is not the largest model that can describe the system. It is the shortest reliable path from
requirement to invariant to owner to observable behavior.
