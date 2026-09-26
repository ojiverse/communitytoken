# Deletion and Deliberate Absence

Removing code, types, checks, routes, or documentation can improve assurance when they duplicate
authority, encode an obsolete model, or preserve distinctions that no longer belong to the owning
layer.

Deletion is a design action rather than a loss of rigor.

## Remove competing authority

An obsolete abstraction that remains available invites new code to depend on it.

When current architecture no longer contains a concept, remove its active representation rather than
keeping it as compatibility vocabulary without a concrete compatibility requirement.

Historical designs remain available in version control.

## Important current absences

CommunityToken intentionally has no Principal subtype taxonomy, Account-kind taxonomy,
EconomicOperation wrapper, administrative distribution primitive, treasury Account, or generic
application-role registry.

Default Account is represented only by the narrow application designation currently required.

ISSUE issuer provenance is retained directly on Transaction rather than by reintroducing a generic
actor/audit entity.

These absences protect the responsibility boundary and are therefore worth documenting.

## Verify the replacement

Before deleting a guardrail, identify the requirement it protected and the mechanism that now owns the
requirement.

After deletion, the assurance path should be shorter and responsibility easier to locate.
