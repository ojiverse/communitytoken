# @communitytoken/application

This package is the runtime-independent application orchestration layer.

It translates authenticated product actions into identity resolution, authorization, default-Account
selection, primitive ledger commands, projections, and application-level consistency work.

## Migration status

Issue #25 reconciles this package to Principal, Account, Transaction, ISSUE, and TRANSFER.

Until then, source may still expose superseded User, Wallet, treasury, actor, distribution, or
four-operation types.

## Responsibility boundary

The application layer owns ExternalIdentity resolution, technical-caller authorization,
default-Account designation and selection, product use-case mapping, visibility, registration,
idempotency, and transaction-scoped coordination.

The primitive economic layer owns monetary validity and the effects of ISSUE and TRANSFER.

## Default Account

A Principal may have at most one application-designated default Account.

The designation is application state, not a column or kind that changes primitive Account semantics.

Registration of a new external identity creates one Principal, creates one zero-balance Account, and
designates it as that Principal's default Account.

A Principal without a default Account cannot use product operations that require one.

## Product mappings

Administrative issuance resolves the target ExternalIdentity to its Principal and default Account,
then performs ISSUE.

The authenticated administrative authority maps to one stable internal Principal. That Principal is
stored as issuer provenance on the committed ISSUE Transaction.

User-facing transfer resolves sender and recipient external identities to default Accounts and
performs TRANSFER.

Balance and history project one default Account.

There is no administrative distribution or treasury/reserve product role after #25.

## Authorization

Technical caller identity and domain Principal are distinct.

Primitive monetary validity never grants permission. The application authorizes the use case before
invoking the primitive transition.

The current administrative caller is mapped to a stable internal Principal solely so ISSUE
Transactions retain who issued supply. This does not create a Principal kind.

## Idempotency

Administrative ISSUE, user TRANSFER, and registration-intent creation are protected against duplicate
delivery.

Successful replayable results include the committed Transaction identifier when a monetary mutation
occurred.

Idempotency provides request correlation and replay protection; it is not the authority for ISSUE
provenance because issuer Principal is stored on the Transaction itself.

## History

History is derived from primitive Transactions relative to the caller's default Account.

Internal Principal and Account identifiers are not exposed to the Discord adapter.

TRANSFER counterparty is the unique same-issuer ExternalIdentity of the other Principal when exactly
one such binding exists; otherwise it is absent.

Self-transfer uses the caller's exact ExternalIdentity. ISSUE has no counterparty.

## Runtime independence

This package must not depend on Durable Object APIs, SQLite implementation types, D1, R2, Queues,
Discord protocol types, or another runtime-specific persistence mechanism.
