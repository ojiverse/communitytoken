# Requirements and Invariants

Design begins with behavior or quality the system must preserve.

Each requirement should be translated into explicit invariants before implementation details are
chosen.

## From requirement to invariant

A requirement is the outcome that matters.

An invariant is the condition that must remain true for that outcome to hold.

Design assigns ownership and mechanisms that preserve the invariant.

Evidence demonstrates that the mechanism works.

Tests and checkers are evidence, not the invariant itself.

## Prefer the smallest invariant

CommunityToken must prevent negative balances and unintended supply changes. ISSUE and TRANSFER are
sufficient monetary primitives for those requirements.

The product also requires supply creation to retain which Principal issued it. That requirement is
captured narrowly as ISSUE issuer provenance rather than a generic actor model.

The product requires at most one default Account per Principal. That is an application designation
invariant, not primitive Account structure.

Overstating an invariant creates permanent vocabulary from temporary policy.

## Ownership

Monetary conservation and ISSUE issuer integrity belong to the primitive ledger.

External identity uniqueness belongs to the identity boundary.

Default Account designation and product authorization belong to the application.

Feature eligibility belongs to the feature.

Simulation behavior belongs to the scenario or policy layer.

## Evidence

Use static types for structural distinctions, unit tests for transitions, persistence tests for
atomicity and durability, and integration tests for boundary contracts.

Do not create independent implementations of the same rule merely to obtain more checks.

The preferred assurance path is requirement, invariant, authoritative owner, owning mechanism, then
observable evidence.
