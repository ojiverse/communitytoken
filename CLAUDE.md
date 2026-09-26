# CommunityToken contributor context

Read the current architecture and specifications before inferring the domain from source names.

Architecture authority is GitHub issue #17. The primitive monetary model contains Principal,
Account, and Transaction, with ISSUE and TRANSFER as the only monetary transaction kinds.

An ISSUE records both the Principal that issued new supply and the destination Account. This issuer
provenance is part of the committed Transaction; it is not a generic actor model.

A Principal may have at most one application-designated default Account. The primitive ledger itself
does not define a default Account, treasury, reserve, or other Account role.

Normative semantics live under docs/specification. ADRs explain durable architectural choices.
GitHub issues own sequencing and implementation work.

Issue #25 reconciled production source and schema with this model. Superseded User, Wallet,
Treasury, EconomicOperation, LedgerTransaction, distribution, or four-operation terminology remains
only in the historical poc/community-state package; do not reintroduce or extend it.

The remaining implementation sequence is #21, #22, then Phase 3 issue #5.
