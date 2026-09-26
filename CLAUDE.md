# CommunityToken contributor context

Before changing CommunityToken, read the current architecture and specifications rather than inferring
the domain from existing source names.

The architecture source of truth is GitHub issue #17. The current primitive monetary model contains
Principal, Account, and Transaction, with ISSUE and TRANSFER as the only monetary transaction kinds.

Normative semantics live under docs/specification. ADRs explain durable architectural choices.
GitHub issues own sequencing and implementation work.

Until Phase 2.2 issue #25 is complete, source and schema may still contain superseded User, Wallet,
Treasury, EconomicOperation, LedgerTransaction, and four-operation terminology. Do not extend those
concepts merely because they remain in code.

Application roles such as community reserve, administrative distribution, and Discord registration
must remain outside primitive monetary validity.

The current implementation sequence is #24, #25, #21, #22, then Phase 3 issue #5.
