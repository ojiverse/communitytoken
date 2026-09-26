# Design at the Current Level of Certainty

A design should be strict about what is already known and permissive about what is not yet known.

The purpose of design is not to predict every future shape of the system. It is to preserve confirmed
meaning and constraints while leaving room for requirements that have not become concrete.

## Start from the fact that must survive

Begin with the behavior or meaning that must be preserved, then derive the smallest invariant that
protects it.

A semantic distinction may be stable before its representation is known. In that case preserve the
distinction without prematurely committing to a type hierarchy, table layout, framework, or lifecycle
model.

The same rule applies to ownership. If provider-specific representation must not become domain truth,
establish the ownership boundary first. Do not invent a generic provider-independent framework until
multiple concrete cases justify one.

## Distinguish mechanism from current policy

A current product rule is not automatically a primitive mechanism.

For CommunityToken, the confirmed monetary facts are that value may be issued into an Account or
transferred between Accounts while preserving balance and supply invariants. Treasury, reward,
campaign, human-user, and simulation-agent classifications are useful policies or roles, but they do
not alter those monetary facts.

The current architecture therefore fixes ISSUE and TRANSFER while deliberately leaving institutional
and feature roles outside the primitive ledger.

A future requirement may justify another primitive, but the burden is to show that ISSUE and TRANSFER
cannot preserve the required monetary invariant, not merely that another label would be convenient.

## Treat uncertainty as design information

An unresolved question is not necessarily a design defect.

When a choice is not required to preserve a known invariant, prefer leaving it open if it can be made
later without losing information or breaking the current contract.

Taxonomies, retention policies, generic plugin systems, Principal kinds, Account kinds, and simulation
frameworks are examples of choices that may remain open until concrete requirements exist.

Known invariants should still be precise. Leaving an unneeded classification open is different from
leaving balance correctness, identity uniqueness, or transaction atomicity vague.

## Preserve information before interpretation

When future interpretation is uncertain, preserve authoritative facts and provenance rather than
normalizing them into a richer model prematurely.

Information that survives can be reinterpreted later. Information erased by early classification
often cannot be reconstructed reliably.

For the primitive ledger, immutable Transaction history preserves monetary facts. A feature or
simulation that needs semantic provenance owns that information and may reference the Transaction.
The ledger does not need to duplicate the higher-level interpretation.

## Do not preserve the path of discussion

Design documents are not transcripts.

A first-time reader should see the current concepts in the order needed to understand the system, not
the sequence in which alternatives were debated.

Rejected concepts deserve durable documentation only when their absence protects an important
boundary or when a reasonable maintainer would otherwise reintroduce them.

Historical designs remain available in version control and issue history.

## Increase the burden with permanence

A local implementation detail can be replaced cheaply. A domain concept, persistent identifier,
public contract, or cross-service dependency is expensive to unwind.

The more permanent a decision is, the stronger the evidence required before fixing it.

This is why primitive domain vocabulary should be smaller than product vocabulary and why generic
frameworks should follow demonstrated shared requirements rather than precede them.

## Stop when the known invariants are protected

A design is complete enough when confirmed requirements have explicit invariants and owners,
consumers can depend on a small stable contract, and unresolved questions can remain unresolved
without loss of meaning.

Additional detail can reduce quality by creating vocabulary and commitments that later work must
honor or remove.

A durable design is precise about what is known now and deliberately silent about what is not yet
required.
