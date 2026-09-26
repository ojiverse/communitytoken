# Application Authority and Visibility

Primitive monetary validity does not encode generic actor, product reason, or visibility policy.

One deliberate exception is ISSUE issuer provenance: every ISSUE records the Principal under whose
authority new supply was created.

That issuer is a structural fact of supply creation, not a generic actor model for all Transactions.

## Technical caller and issuer Principal

An authenticated technical caller and a domain Principal are distinct concepts.

The application authorizes administrative issuance and maps the authenticated administrative
authority to one stable Principal. That Principal is supplied to ISSUE and persisted as issuer
provenance.

Knowledge of a Principal identifier is not an authorization credential.

TRANSFER authorization remains entirely application-owned and does not add an actor field to the
primitive Transaction.

## User-facing visibility

The current product exposes self-only balance and history for the Principal resolved from the
caller's ExternalIdentity.

Those operations use the Principal's application-designated default Account.

Internal Principal and Account identifiers are not exposed through the Discord-facing boundary.

## History direction

Direction is relative to the viewed Account.

ISSUE into the viewed Account is incoming.

TRANSFER is incoming when value arrives, outgoing when value leaves, and self when source and
destination are the viewed Account.

A self-transfer appears once.

## Counterparty projection

ISSUE has no counterparty.

For TRANSFER, the application may expose the counterparty as an ExternalIdentity when the other
Principal has exactly one binding under the same issuer as the caller.

If no such binding exists, or more than one binding exists under that issuer, counterparty is absent.

For self-transfer, counterparty is the caller's exact ExternalIdentity.

This projection intentionally avoids exposing internal Principal or Account identifiers and avoids
inventing an arbitrary choice among multiple identity bindings.

Whether a future non-Discord surface uses another projection is an application-contract decision.
