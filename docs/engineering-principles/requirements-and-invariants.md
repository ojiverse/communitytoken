# Requirements and Invariants

Design begins with behavior or quality the system must preserve.

Functional requirements describe what the system must do. Non-functional requirements describe
qualities such as security, consistency, reliability, performance, and operability.

Each requirement should be translated into explicit invariants before implementation details are
chosen.

## From requirement to invariant

A requirement is the outcome that matters.

An invariant is the condition that must remain true for that outcome to hold.

Design assigns ownership and mechanisms that preserve the invariant.

Evidence demonstrates that the mechanism works.

Tests and checkers are evidence. They are not the invariant itself.

## Prefer the smallest invariant

An invariant should be no broader than the requirement demands.

CommunityToken needs to prevent negative balances and unintended supply changes. That requires
precise ISSUE and TRANSFER rules; it does not require a primitive distinction between distribution,
peer-to-peer payment, treasury payment, or reward.

Overstating the invariant creates permanent vocabulary from temporary product policy.

## Ownership

For each invariant, identify the component with enough information and authority to preserve it.

Monetary conservation belongs to the primitive ledger. External identity uniqueness belongs to the
identity boundary. Product authorization belongs to the application. Feature eligibility belongs to
the feature. Simulation behavior belongs to the scenario or policy layer.

Moving a rule to a layer that lacks the required knowledge either weakens enforcement or forces
unrelated concepts into that layer.

## Evidence

Choose evidence appropriate to the owner.

Static types can rule out invalid representations. Unit tests can prove transition behavior.
Persistence tests can prove atomicity and durability. Integration tests can prove boundary contracts.

Do not create multiple independent implementations of the same rule merely to obtain more checks.

The preferred assurance path is requirement, invariant, authoritative owner, owning mechanism, then
observable evidence.
