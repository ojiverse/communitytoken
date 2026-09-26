# Domain Specifications

Domain specifications define CommunityToken meaning independently of runtime, storage, transport, or
identity-provider implementation.

The primitive economic model is intentionally small.

- Economic State defines Principal, Account, Transaction, monetary domains, and supply.
- Economic Transitions defines ISSUE, TRANSFER, acceptance, rejection, and self-transfer.
- Identity defines stable Principal identity and exact external identity bindings.
- Application Authority and Visibility defines authorization and product visibility around the
  primitive ledger.

## Shared scope

One deployment represents one community.

Domain identifiers are opaque. Their meaning comes from the entity they identify, not from their
textual representation or an external provider identifier.

A Principal may represent a human or non-human subject. The domain does not define Principal kinds.

An Account is only a balance container owned by a Principal. Treasury, reserve, escrow, user,
community, bot, and similar classifications are roles assigned by an application or simulation, not
Account kinds.

Feature eligibility, cadence, campaign state, business uniqueness, provenance, and simulation policy
are outside primitive monetary validity.

When higher-level policy causes value movement, it ultimately requests ISSUE or TRANSFER through an
authorized application boundary.
