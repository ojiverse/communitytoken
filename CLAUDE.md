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

Until issue #25 is complete, source and schema may still contain superseded User, Wallet, Treasury,
EconomicOperation, LedgerTransaction, distribution, or four-operation terminology. Do not extend
those concepts merely because they remain in code.

The current implementation sequence is #25, #21, #22, then Phase 3 issue #5.
