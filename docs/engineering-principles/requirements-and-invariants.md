# Requirements and Invariants

Design should begin with the behavior or quality the system must preserve. Functional requirements
describe what the system must do. Non-functional requirements describe qualities such as security,
reliability, consistency, performance, and operability.

Each requirement should be translated into one or more invariants: statements that must remain true
across relevant states and transitions. An invariant is more durable than a particular file layout,
tool, or implementation technique.

## Design from the invariant

Once an invariant is explicit, assign responsibility for preserving it. The design should make the
valid path natural, constrain invalid states where practical, and provide an observable boundary
when enforcement cannot be structural.

Keep these concerns distinct:

- **Requirement:** the behavior or quality that matters.
- **Invariant:** the condition that must remain true to satisfy the requirement.
- **Design:** the ownership and mechanisms that preserve the invariant.
- **Evidence:** the observation that demonstrates the design is working.

A test or checker is not the invariant itself. It is only one possible source of evidence. Adding a
check without identifying the requirement and invariant often enforces incidental structure instead
of the property the system needs.

## Questions to ask

- Which functional or non-functional requirement is being protected?
- What must always remain true for that requirement to hold?
- Which component or boundary owns preservation of that condition?
- How does the design prevent, contain, or expose a violation?
- What independent evidence shows that the invariant is preserved?
- Could the implementation change while the invariant remains intact?

This sequence keeps implementation choices traceable to requirements while allowing the design to
evolve without weakening its guarantees.
