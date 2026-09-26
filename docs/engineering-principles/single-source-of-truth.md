# Single Source of Truth

Every durable fact or semantic rule should have one authoritative owner.

Copies create competing authorities and may drift while continuing to look plausible.

## Facts and interpretation

Single ownership applies both to stored values and their meaning.

Normative specifications own CommunityToken domain semantics.

Committed Transaction history owns monetary facts.

ISSUE itself owns issuer Principal provenance.

IdentityBinding owns the mapping from exact ExternalIdentity to Principal.

The application's default-Account designation owns which Account, if any, is the Principal's current
default.

Feature and simulation provenance remain owned by those higher-level layers.

## Native enforcement

Prefer the owning subsystem's normal execution path and native validation before writing custom
interpreters.

A generated artifact is safe when it can be recreated from its authoritative source. A
hand-maintained duplicate is another source of truth.

## Decision test

Ask which component owns the fact, whether a future change would require editing the same meaning in
multiple places, whether consumers can observe authoritative state directly, and whether a custom
validation path duplicates interpretation.

Clear ownership shortens diagnosis.
