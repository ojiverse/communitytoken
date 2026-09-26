# Domain Specifications

Domain specifications define CommunityToken meaning independently of runtime, storage, transport, or
identity-provider implementation.

The primitive model contains Principal, Account, and Transaction.

Economic State defines those entities, monetary domains, supply, and ISSUE issuer provenance.

Economic Transitions defines ISSUE, TRANSFER, acceptance, rejection, and self-transfer.

Identity defines stable Principal identity and exact external identity bindings.

Application Authority and Visibility defines authorization and product visibility around the
primitive ledger.

## Shared scope

One deployment represents one community.

Domain identifiers are opaque.

A Principal may represent a human or non-human subject. The domain does not define Principal kinds.

An Account is only a balance container owned by a Principal. Product designations such as default
Account are application state and do not alter primitive Account semantics.

Feature eligibility, campaign state, business uniqueness, and simulation policy are outside primitive
monetary validity.
