# Engineering Principles

This directory records engineering principles that should remain useful beyond a single change or
technology choice. They describe how to assign ownership, choose meaningful validation, and keep
the repository understandable as it evolves.

These documents are decision guides, not an additional policy engine. A principle should influence
the design of a change, but it should not automatically produce another script or test.

## Reading order

1. [Requirements and Invariants](./requirements-and-invariants.md) identifies what the design must
   preserve from its functional and non-functional requirements.
2. [Single Source of Truth](./single-source-of-truth.md) assigns each fact to one owner and derives
   the use of that owner's native interpretation and enforcement mechanisms.
3. [Loose Coupling and High Cohesion](./loose-coupling-and-high-cohesion.md) keeps related knowledge
   with one owner and limits what separate components must know about each other.
4. [Types as Design](./types-as-design.md) expresses requirements and invariants statically so
   contradictory implementations fail to compile.
5. [Immutability by Default](./immutability-by-default.md) makes state transitions explicit and
   treats mutable data as a narrowly justified exception.
6. [Comments Explain Why](./comments-explain-why.md) preserves only the essential rationale that
   types, structure, and implementation cannot express.
7. [Deletion and Deliberate Absence](./deletion-and-deliberate-absence.md) removes competing
   authorities and preserves the reason a parallel mechanism does not exist.

Concrete design policies that apply these principles to recurring classes of changes live separately
under [Design Policies](../design-policy/README.md). Read the relevant design policy after these
principles and before writing a feature-specific design or implementation plan.

Together, these principles favor a short assurance path:

```text
requirement -> invariant -> authoritative source -> owning mechanism -> observable outcome
```

The goal is not to maximize the number of checks. The goal is to make responsibility and evidence
unambiguous.
