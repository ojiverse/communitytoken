# Application Authority and Visibility

Primitive monetary validity does not encode actor, product reason, or visibility policy.

Those concerns belong to the application or higher-level consumer around the ledger.

## Authority is outside the Transaction

An Account owner is not necessarily the authority that caused a monetary transition.

Administrative ISSUE may be authorized by an administrative service while crediting a community
reserve Account.

A feature service may be authorized to request a TRANSFER from a reserve Account to a recipient
without becoming the owner of either Account.

A user-facing transfer may be authorized after resolving the invoking ExternalIdentity to a
Principal and selecting that Principal's product-default Account.

The primitive Transaction therefore does not carry an actor type merely to express application
authority.

Higher-level application, feature, or simulation records may retain provenance and reference the
resulting Transaction identifier.

## Technical caller and domain Principal

An authenticated technical caller and a domain Principal are distinct concepts.

An adapter credential proves which service is making a trusted request. An ExternalIdentity supplied
through that trusted boundary identifies the subject of a user-facing product action.

The application resolves that ExternalIdentity to a Principal and authorizes the requested use case.

Possession of a technical credential does not make that service the owner of a Principal's Account,
and knowledge of a Principal identifier is not an impersonation credential.

## Product visibility

The current user-facing product exposes self-only balance and history.

A caller acting for one registered external identity may observe the balance of that Principal's
product-default Account and Transaction history involving that Account.

The normal product surface does not permit selecting another Principal or Account merely by knowing
an internal identifier.

Inspection of the application-designated community reserve is an administrative capability.

These are application visibility rules, not primitive ledger invariants.

## History direction

History direction is a projection relative to the Account being viewed.

An ISSUE into the viewed Account is incoming.

A TRANSFER is incoming when value arrives, outgoing when value leaves, and self when source and
destination are the viewed Account.

A self-transfer appears once.

Direction is a projection over primitive facts. It must not be used to reconstruct semantic
Transaction kinds such as distribution, peer-to-peer payment, or treasury payment.

## Counterparty

For a TRANSFER involving the viewed Account, an application projection may expose the Principal that
owns the other Account when visibility policy allows it.

For self-transfer, the counterparty is the same Principal.

An ISSUE has no source counterparty.

The application may label a designated Account as a community reserve for presentation, but that
label is not stored as a primitive Account kind.
