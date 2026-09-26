# @communitytoken/application

This package is the runtime-independent application orchestration layer.

It translates authenticated product actions into identity resolution, authorization, primitive
ledger commands, projections, and application-level consistency work. It owns no Cloudflare runtime
types and no primitive monetary rules.

Architecture authority is GitHub issue #17.

## Migration status

The package is being reconciled to the Principal, Account, and Transaction model in issue #25.

Until that work merges, source files may still expose superseded User, Wallet, actor, treasury, or
four-operation types. This README describes the target boundary and should be used when deciding
whether existing code is migration residue.

## Responsibility boundary

The application layer owns external-identity resolution, selection of application-designated
Accounts, caller authorization, product use-case mapping, visibility, registration orchestration,
idempotency composition, and transaction-scoped coordination with persistence.

The primitive economic layer owns only monetary validity and the effects of ISSUE and TRANSFER.

The application layer must not recreate ledger arithmetic, supply rules, or balance invariants.

## Product mappings

Administrative issuance maps to ISSUE into the community reserve Account.

Administrative distribution maps to TRANSFER from the reserve to the recipient's product-default
Account.

User-facing transfer maps to TRANSFER from the sender's default Account to the recipient's default
Account.

Balance is a projection of one Account.

History is a projection of primitive Transactions touching one Account.

Distribution and treasury are application vocabulary, not primitive Transaction or Account kinds.

## Identity

IdentityBinding maps the exact ExternalIdentity pair of issuer and subject to a Principal.

Registration creates one Principal and one product-default Account when the external identity is not
already bound.

The primitive model permits multiple Accounts per Principal, but Phase 2 does not introduce generic
Account-management behavior.

The current Discord-first product does not constrain Principal to human subjects.

## Authorization

Technical caller identity and domain Principal are distinct concepts.

An adapter credential may assert the ExternalIdentity associated with a product action. The
application resolves that identity and authorizes the requested use case inside one trusted boundary.

Administrative authority is separate from adapter authority.

Primitive economic validity never grants permission. A structurally valid TRANSFER is not authorized
merely because the source Account contains sufficient funds.

## Unit of work

Every state-changing application operation executes in one serialized atomic section supplied by the
UnitOfWork boundary.

Repository capabilities are scoped to that section and must not remain usable afterward.

External I/O completes before entering the synchronous critical section.

An outer orchestration may compose identity, idempotency, application records, and one primitive
ledger mutation in the same atomic section when correctness requires it.

## Idempotency

Idempotency protects one logical mutation request from duplicate delivery within the authenticated
technical-caller namespace.

A successful replayable result and its protected mutation commit together.

Expected non-mutating failure leaves no successful replay record.

Idempotency does not encode feature eligibility, campaign uniqueness, or simulation-event
equivalence.

## Persistence ports

After issue #25, application-facing persistence contracts should expose the smallest capabilities
required for Principal, Account, IdentityBinding, Transaction, registration, and idempotency
orchestration.

Do not preserve separate EconomicOperation and LedgerTransaction repositories or Account-kind
contracts solely for compatibility with the superseded model.

Identifier allocation remains a persistence-boundary responsibility unless a concrete requirement
moves it elsewhere.

## History

History is derived from primitive Transactions relative to an Account.

A projection may describe direction as incoming, outgoing, or self and may identify a counterparty
Principal when application visibility permits it.

The projection must not reconstruct semantic Transaction kinds such as distribution, peer-to-peer
payment, or treasury payment from direction alone.

## Runtime independence

This package must not depend on Durable Object APIs, SQLite implementation types, D1, R2, Queues,
Discord protocol types, or another runtime-specific persistence mechanism.

Runtime adapters implement application ports; they do not redefine primitive semantics.
