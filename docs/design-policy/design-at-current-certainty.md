# Design at the Current Level of Certainty

A design should be strict about what is already known and permissive about what is not yet known. The purpose of design is not to anticipate every future shape of the system. It is to preserve the meaning and constraints that are already justified while leaving room for requirements that have not yet become concrete.

This is especially important when adding a new domain or datasource. Early in that work, many future concepts are easy to imagine: classifications, derived states, indexes, caches, taxonomies, lifecycle models, or cross-domain links. Their plausibility does not make them requirements. Encoding them too early turns an expectation about the future into a constraint on the present.

The useful question is therefore not "what could this become?" but "what would be incorrect to lose or contradict, given what we know now?"

## Start from the fact that must survive

Begin with the behavior or meaning the system must preserve, then derive the smallest invariant that protects it. If a datasource reports a fact with a particular temporal meaning, for example, the durable design concern is that the meaning must survive interpretation. The design does not automatically require a particular union type, table layout, or generic time abstraction.

This distinction matters because semantic differences are often stable before their representation is. It may already be clear that two records cannot be treated as equivalent while it is still unclear whether they deserve different types, different owners, or only different validation rules. Fix the semantic distinction first. Choose the representation only when the requirements justify it.

The same reasoning applies to ownership. If provider-specific representation must not become domain truth, establish a boundary between source representation and domain interpretation. Do not immediately invent a provider-independent framework beyond what that boundary requires. A good abstraction represents a demonstrated invariant shared by multiple cases; resemblance between possible future cases is not enough.

## Treat uncertainty as design information

An unresolved question is not necessarily a design defect. Sometimes it is evidence that the system does not yet have enough requirements to make the decision responsibly.

When a decision is not required to preserve a known invariant, prefer leaving it open if a later choice can be made without losing information or breaking the current contract. Taxonomies, storage layouts, retention periods, revision strategies, derived models, and generic frameworks commonly fall into this category during an early domain design.

This is not an argument for vague contracts. Known invariants should be expressed as precisely as practical, including in types when the type system can enforce them. The distinction is between precision and speculation: make confirmed meaning difficult to violate, but do not make an unconfirmed taxonomy difficult to change.

A useful mental split is:

```text
confirmed meaning or constraint
        -> make explicit and durable

plausible future requirement
        -> preserve room for it

replaceable implementation choice
        -> keep outside the domain contract
```

The burden of proof should increase with the permanence of the decision. A local implementation detail can be changed cheaply; a domain concept, public contract, or cross-domain dependency is much more expensive to unwind. The latter therefore requires stronger evidence that the distinction is real and enduring.

## Do not confuse the path of discussion with the shape of the design

Design documents are not transcripts of the reasoning process. The authors may have considered many alternatives, but a first-time reader does not share that history and should not need it.

A concept should not be introduced only so the document can say that it is intentionally absent. Doing so expands the reader's mental model for no functional reason. Record a negative decision when a reasonable reader would otherwise infer the rejected design from the requirements or surrounding architecture, or when the absence itself protects an important boundary. Otherwise, omit the abandoned idea entirely.

For example, when a datasource is the obvious source of incoming data, explaining why its response is not itself domain truth clarifies a real boundary. By contrast, saying that a domain does not contain an unintroduced `Entitlement` entity teaches the reader nothing unless the requirements or existing architecture would naturally imply such an entity.

The document should therefore be organized in the order a new reader needs concepts, not the order in which the design conversation discovered them. Each section should establish the premise needed for the next decision. A reader should be able to derive why a boundary exists without knowing which alternatives were previously debated.

## Prefer information preservation over premature interpretation

When future requirements are uncertain, preserving source meaning and provenance is usually more valuable than committing to a richer interpretation. Information that survives can be reinterpreted later; information erased by an early normalization often cannot be recovered.

This does not mean retaining every possible byte or exposing provider details throughout the system. It means identifying which distinctions are already meaningful and ensuring the chosen boundaries do not destroy them. The implementation can remain replaceable behind those boundaries.

The same principle constrains aggregation and other computations. If a result is computed from domain facts, do not let convenience turn that result into a second authority for those facts. Whether the system later names such values "derived data" or persists them as a cache is a separate decision. The present invariant is simply that computation must not erase or compete with the meaning of its inputs.

## Stop when the design has protected what is known

A design is complete enough for its current phase when every confirmed requirement has a clear invariant and owner, consumers can depend on a small stable contract, and unresolved questions can remain unresolved without risking loss of meaning or contradictory truth.

At that point, adding more detail can reduce design quality rather than improve it. Extra concepts create vocabulary, dependencies, and implied commitments that future work must either honor or undo. Deliberate restraint keeps the assurance path short:

```text
requirement
  -> invariant
  -> authoritative owner
  -> minimal stable boundary
  -> observable behavior
```

When a later requirement appears, repeat the same reasoning from that new evidence. Do not treat the earlier design as a prediction that must be defended. A durable design is one that was precise about what was true at the time and intentionally left everything else available for reconsideration.
