# Deletion and Deliberate Absence

Removing a check can improve assurance when that check duplicates authority, enforces incidental
structure, or obscures the mechanism that actually owns the concern.

Deletion is therefore a design action, not a retreat from quality. The desired result is a clearer
chain of responsibility: one authoritative definition, one owning mechanism, and evidence from the
resulting behavior.

## Record why something does not exist

An intentional absence can look like an omission to a future maintainer. Without context, the same
redundant helper or test may be introduced again.

Documentation should record:

- what owns the underlying fact;
- which mechanism provides assurance;
- which parallel mechanism is intentionally absent;
- why that absence preserves a clearer boundary.

This record should explain the enduring responsibility boundary rather than narrate a temporary
implementation diff.

Before removing a guardrail, identify the concrete risk it covered and confirm where that risk is
now observed. After removal, the repository should have fewer competing claims and a more obvious
place to investigate failures.
