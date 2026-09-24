# Domain Specifications

Domain specifications define the meaning of CommunityToken independently of runtime, storage,
transport, or provider implementation.

Read only what is relevant to the capability being changed.

- [Economic State](./economic-state.md) — economic entities, ownership, monetary domains, and supply.
- [Economic Transitions](./economic-transitions.md) — operation kinds, accepted transitions, and rejection.
- [Identity](./identity.md) — stable User identity and external identity bindings.
- [Actor and Visibility](./actor-and-visibility.md) — initiator semantics and who may observe which state.

## Shared scope

One deployment represents exactly one community.

There is no cross-community identity, wallet, transfer, or supply relation in the domain.

Domain identifiers are opaque. Their meaning comes from the entity they identify, not from their
textual representation or an external provider identifier.

Feature-specific eligibility, cadence, scheduling, campaign state, and business uniqueness are not
part of the CommunityToken core domain merely because they may cause an economic operation.
