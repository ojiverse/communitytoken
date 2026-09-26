# Single Source of Truth

Every durable fact or semantic rule should have one authoritative owner.

Copies create competing authorities. They can drift while continuing to look plausible.

## Facts and interpretation

Single ownership applies both to stored values and to their meaning.

A schema definition, dependency version, identity binding, transaction history, or deployment
configuration should have one place that determines truth.

Consumers should use that source or observe its effects rather than maintaining parallel handwritten
lists.

## Semantics

Normative specifications own CommunityToken domain semantics.

The primitive ledger owns committed monetary facts.

Application roles such as community reserve are owned by application state or configuration rather
than inferred from Account structure.

Feature and simulation provenance are owned by those higher-level layers and may reference a
Transaction identifier instead of being copied into primitive Transaction semantics.

## Native enforcement

Prefer the owning subsystem's normal execution path and native validation before writing a custom
interpreter.

A generated artifact is safe when it can be recreated from its authoritative source. A
hand-maintained duplicate is another source of truth.

## Decision test

Ask which component owns the fact, whether a future change would require editing the same meaning in
multiple places, whether consumers can observe the authoritative source directly, and whether a
custom validation path is duplicating interpretation.

Clear ownership shortens diagnosis: when a fact is wrong, maintainers know where to correct it.
