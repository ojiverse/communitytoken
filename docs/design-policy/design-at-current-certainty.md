# Design at the Current Level of Certainty

A design should be strict about what is already known and permissive about what is not yet known.

The purpose of design is not to predict every future shape of the system. It is to preserve confirmed
meaning and constraints while leaving room for requirements that have not become concrete.

## Start from the fact that must survive

Begin with the behavior or meaning that must be preserved, then derive the smallest invariant that
protects it.

A semantic distinction may be stable before its representation is known. Preserve that distinction
without prematurely committing to a type hierarchy, table layout, framework, or lifecycle model.

## Distinguish mechanism from current policy

A current product rule is not automatically a primitive mechanism.

For CommunityToken, confirmed monetary facts are that a Principal may issue new value into an Account
and that existing value may transfer between Accounts.

The issuer Principal is retained because provenance of supply creation is a confirmed requirement.

Default Account is an application designation because product operations need one convenient Account
selection per registered Principal. It does not change primitive Account semantics.

Other product labels and simulation classifications remain outside the primitive ledger until a
concrete invariant requires them.

## Treat uncertainty as design information

An unresolved question is not necessarily a design defect.

When a choice is not required to preserve a known invariant, leave it open if it can be made later
without losing information or breaking the current contract.

Taxonomies, retention policies, generic plugin systems, Principal kinds, Account kinds, and simulation
frameworks are examples of choices that may remain open.

Known invariants should still be precise. Leaving an unneeded classification open is different from
leaving balance correctness, identity uniqueness, ISSUE provenance, or transaction atomicity vague.

## Preserve information before interpretation

When future interpretation is uncertain, preserve authoritative facts and provenance rather than
normalizing them into a richer model prematurely.

Immutable Transaction history preserves monetary facts. ISSUE includes issuer Principal because that
fact is required to explain supply creation.

Feature or simulation provenance beyond primitive facts remains owned by the higher-level layer and
may reference the Transaction.

## Do not preserve the path of discussion

Design documents are not transcripts.

A first-time reader should see current concepts in the order needed to understand the system, not the
sequence in which alternatives were debated.

Historical designs remain available in version control and issue history.

## Increase the burden with permanence

A local implementation detail can be replaced cheaply. A domain concept, persistent identifier,
public contract, or cross-service dependency is expensive to unwind.

The more permanent a decision is, the stronger the evidence required before fixing it.

## Stop when known invariants are protected

A design is complete enough when confirmed requirements have explicit invariants and owners,
consumers can depend on a small stable contract, and unresolved questions can remain unresolved
without loss of meaning.

Additional detail can reduce quality by creating vocabulary and commitments future work must honor or
remove.
