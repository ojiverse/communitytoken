# Engineering Principles

This directory records repository-wide engineering principles that should remain useful beyond any
single feature, runtime, or architecture revision.

They are reasoning rules, not an additional policy engine.

Requirements and Invariants begins with properties the design must preserve.

Single Source of Truth assigns each fact to one authoritative owner.

Loose Coupling and High Cohesion keeps related knowledge together and limits cross-boundary leakage.

Types as Design expresses stable invariants through the type system where practical.

Immutability by Default makes state transitions explicit.

Comments Explain Why reserves comments for irreducible rationale.

Deletion and Deliberate Absence explains why removing obsolete or duplicate mechanisms can improve
assurance.

## Current architectural example

The primitive-ledger reset demonstrates these principles.

Principal, Account, Transaction, ISSUE, and TRANSFER are primitive because they protect confirmed
monetary requirements.

ISSUE records issuer Principal because provenance of supply creation is now a confirmed requirement.

Default Account remains an application designation with an at-most-one invariant per Principal.

Product labels, feature policy, and simulation behavior remain outside primitive monetary validity.

The goal is not the largest model that can describe the system. It is the shortest reliable path from
requirement to invariant to owner to observable behavior.
