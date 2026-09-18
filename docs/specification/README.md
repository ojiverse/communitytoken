# CommunityToken Specifications

This directory contains the normative specifications of CommunityToken.

Specifications define what must remain true. They do not prescribe source-code structure,
database DDL, runtime products, package names, deployment commands, test fixtures, or rollout
steps. Those choices belong to implementation issues and pull requests.

## Authority

Within the scope fixed by the project roadmap, these documents are the source of truth for
domain meaning and system-boundary invariants.

If an implementation issue or pull-request description conflicts with a specification, the
specification wins for semantics and invariants. The implementation plan must be corrected.

Discussion comments are decision history, not normative specification. A semantic decision becomes
normative when it is incorporated into the owning document here.

## Progressive disclosure

Start with the smallest relevant layer.

1. Read [Domain Specifications](./domain/README.md) to understand what the product means.
2. Read only the domain document that owns the concept you are changing.
3. Read [Technical Specifications](./technical/README.md) when the change crosses a system boundary.
4. Consult implementation issues only after the invariant is understood.

A reader implementing a feature should not need to read every specification.

## Domain versus technical specification

**Domain specifications** define concepts, valid states, state transitions, and product policy that
must survive a change of runtime or storage technology.

**Technical specifications** define guarantees at boundaries between components or trust domains.
They may constrain ordering, atomicity, authentication, persistence, or time authority, but remain
independent of a particular implementation mechanism.

A document should state an invariant rather than the mechanism currently used to enforce it.

## Change discipline

A behavioral change that alters a normative invariant must update the owning specification in the
same change that introduces the new behavior.

Implementation-only changes should not edit these documents unless they reveal that the current
specification is incomplete or incorrect.

No specification in this directory should become an implementation manual. Concrete implementation
instructions remain in the relevant GitHub issue.
