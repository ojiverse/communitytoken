# Deletion and Deliberate Absence

Removing code, types, checks, or documentation can improve assurance when they duplicate authority,
encode an obsolete model, or preserve distinctions that no longer belong to the owning layer.

Deletion is therefore a design action rather than a loss of rigor.

## Remove competing authority

A repository is easier to reason about when one place owns each fact.

An obsolete abstraction that remains available invites new code to depend on it. A duplicated check
can drift from the mechanism that actually owns the invariant.

When the current architecture no longer contains a concept, remove its active representation rather
than keeping it as a compatibility vocabulary without a concrete compatibility requirement.

Historical designs remain available in version control.

## Record important absences

Some absences protect architectural boundaries and deserve explicit documentation.

CommunityToken intentionally has no primitive Treasury type, no Principal subtype taxonomy, no
semantic distribution or reward Transaction kinds, and no separate EconomicOperation wrapper.

Those absences are important because higher-level application and simulation layers own those
meanings.

Not every deleted helper deserves a permanent explanation. Record an absence when a reasonable
maintainer would otherwise reintroduce the competing authority.

## Verify the replacement

Before deleting a guardrail, identify the requirement it protected and the mechanism that now owns
that requirement.

After deletion, the assurance path should be shorter and responsibility should be easier to locate.
