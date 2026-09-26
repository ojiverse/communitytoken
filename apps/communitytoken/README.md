# CommunityToken production application

This application is the production HTTP and persistence realization of CommunityToken.

Architecture authority is GitHub issue #17. Phase 2 sequencing is owned by issue #19.

## Model

The production model is Principal, Account, and Transaction with ISSUE and TRANSFER as the only
primitive monetary kinds. ISSUE additionally records the issuing Principal.

Issue #25 removed the superseded User, Wallet, Treasury, EconomicOperation, LedgerTransaction,
distribution, and four-operation implementation. Unshipped tables were replaced without migration
machinery because no production economic state existed.

## Product surface

Registration creates or resolves a Principal and ensures that a newly registered Principal has one
application-designated default Account.

A Principal may have at most one default Account designation. The primitive ledger does not require a
default for every Principal.

Self balance and history operate on the resolved Principal's default Account.

User-facing transfer resolves sender and recipient ExternalIdentities to their Principals and default
Accounts, then performs one TRANSFER.

Administrative issuance resolves a target ExternalIdentity to a Principal and default Account, then
performs one ISSUE. The Transaction records the stable Principal corresponding to the authenticated
administrative authority as issuer.

The superseded administrative distribution and treasury inspection routes were removed in #25 and
answer 404 not_found. No reserve or treasury Account is part of the current product model.

## Authentication and authorization

The adapter credential and administrative credential are distinct technical authorities.

Technical caller identity is not the same concept as domain Principal. The application maps the
current administrative authority to one stable Principal used as ISSUE provenance.

Authorization remains outside primitive monetary validity.

OIDC validation proves ExternalIdentity during registration. The public OIDC callback does not use
bearer authentication.

## History projection

User-facing history exposes primitive Transaction facts without leaking internal Principal or Account
identifiers.

Direction is incoming, outgoing, or self relative to the viewed default Account.

For TRANSFER, counterparty may be exposed as the unique ExternalIdentity bound to the other Principal
under the same issuer as the caller. If that identity cannot be resolved uniquely, counterparty is
absent.

For self-transfer, the caller's exact ExternalIdentity is the counterparty.

ISSUE has no counterparty. Issuer Principal provenance remains persisted even when the user-facing
projection does not expose the internal issuer identifier.

## Atomicity and idempotency

Every durable mutation executes in one serialized atomic section.

Transfer, registration-intent creation, and administrative issuance are idempotency-protected
mutations.

A successful protected mutation and its replay record commit atomically. Successful monetary results
include the committed Transaction identifier.

## Persistence

Durable state represents Principal, Account, optional default-Account designation,
IdentityBinding, Transaction, registration intent state, and idempotency/application records.

A Transaction is either ISSUE or TRANSFER. An ISSUE stores issuer Principal, destination Account,
amount, and commit time.

There is no EconomicOperation wrapper and no Account role or reserve designation.

## Runtime responsibility

The Worker owns transport ingress, authentication, authorization, and request validation.

CommunityState owns serialized durable orchestration.

Persistence modules own durable representation. Runtime-independent packages own application and
primitive monetary contracts.

Discord interaction ingress belongs to the separate Discord adapter Worker.
