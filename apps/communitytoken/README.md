# CommunityToken production application

This application is the production HTTP and persistence realization of CommunityToken.

Architecture authority is GitHub issue #17. Phase 2 sequencing is owned by issue #19.

## Current migration state

The normative target is Principal, Account, and Transaction with ISSUE and TRANSFER as the only
primitive monetary transaction kinds.

Documentation has moved to that model before production source and schema. Until issue #25 is merged,
files in this application may still contain superseded User, Wallet, Treasury, EconomicOperation,
LedgerTransaction, and four-operation terminology.

Those names are implementation migration residue. Do not extend the superseded model while performing
unrelated work.

## Runtime responsibility

The Worker owns transport ingress, authentication, authorization, request validation, and
protocol-facing orchestration.

CommunityState owns the single serialized durable mutation boundary. Durable state is currently
implemented on Cloudflare SQLite storage.

Cloudflare-specific mechanics remain outside the primitive domain contract.

## Primitive monetary model

The economic layer must converge to exactly two transitions.

ISSUE credits one destination Account and increases total supply by the same amount.

TRANSFER debits one source Account and credits one destination Account without changing total supply.

Account roles do not participate in primitive monetary validity.

The application may designate one Account as the community reserve and may expose product use cases
named issuance, distribution, transfer, or treasury inspection. Those names do not create additional
Transaction kinds.

## Identity

An ExternalIdentity is the exact issuer and subject pair.

IdentityBinding associates an ExternalIdentity with one Principal. The current Discord-backed OIDC
registration flow creates one Principal and one product-default Account on first successful
registration.

Principal is not synonymous with a human or Discord user.

## HTTP product surface

The application currently exposes registration, self balance, self history, user transfer,
administrative issuance, administrative distribution, and administrative reserve inspection.

The existing routes under the treasury namespace may remain during Phase 2 for product compatibility.
Their spelling describes an application role only. It does not imply a treasury Account kind in the
primitive model.

Discord interaction ingress belongs to the separate Discord adapter Worker.

## Authentication and authorization

The adapter credential and administrative credential are distinct technical authorities.

The adapter may use the supported non-administrative product surface. Administrative issuance,
distribution, and reserve inspection require administrative authority.

Authorization is an application concern. The primitive ledger does not infer authority from a
Principal subtype, Account kind, source Account, or transaction direction.

OIDC validation proves ExternalIdentity during registration. The public OIDC callback does not use
bearer authentication.

## Atomicity and idempotency

Every durable mutation executes in one serialized atomic section.

A successful protected mutation and its replay record commit atomically. A rejected primitive
transition creates neither a Transaction nor a balance change.

Idempotency protects duplicate delivery of one logical application request. It does not decide
whether independently identified product or feature actions are business-domain duplicates.

## Persistence target

After issue #25, the durable model must represent at least Principal, Account, IdentityBinding,
Transaction, registration intent state, and idempotency or application records.

EconomicOperation and a separate one-to-one LedgerTransaction are not part of the target model.

Fresh application initialization creates the designated community Principal and reserve Account at
zero balance without creating supply. Initial supply is a later explicit ISSUE.

## Source responsibilities

The current source tree remains the implementation surface while issue #25 performs the migration.

Transport code owns ingress. HTTP modules own routing, validation, authentication, and authorization.
CommunityState owns serialized durable orchestration. Persistence modules own durable representation.
OIDC modules own relying-party protocol mechanics. Runtime-independent packages own application and
primitive monetary contracts.

Do not preserve an obsolete type, table, or repository solely because it exists today.

## Verification

Tests must ultimately demonstrate primitive monetary invariants, identity binding, atomicity,
idempotency, and supported product behavior.

Cloudflare deployment topology and the separate Discord adapter are described by ADR-0003 and the
Phase 2 rollout issues.
