# Domain Specifications

Domain specifications define the meaning of CommunityToken independently of runtime, storage,
transport, or provider implementation.

Read only what is relevant to the feature being changed.

- [Economic State](./economic-state.md) — economic entities, ownership, monetary domains, and supply.
- [Economic Transitions](./economic-transitions.md) — operation kinds, accepted transitions, and rejection.
- [Identity](./identity.md) — stable User identity and external identity bindings.
- [Actor and Visibility](./actor-and-visibility.md) — initiator semantics and who may observe which state.
- [Daily Reward](./daily-reward.md) — reward eligibility and treasury-funded reward semantics.

## Shared scope

One deployment represents exactly one community.

There is no cross-community identity, wallet, transfer, or supply relation in the domain.

Domain identifiers are opaque. Their meaning comes from the entity they identify, not from their
textual representation or an external provider identifier.
