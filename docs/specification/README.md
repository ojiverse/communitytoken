# CommunityToken Specifications

This directory contains the normative specifications of CommunityToken.

Specifications define semantics and invariants that implementation must preserve. They do not
prescribe source layout, database DDL, runtime products, package names, deployment commands, or
rollout steps.

## Authority

Within the roadmap scope, these documents are the semantic source of truth.

Architecture issue #17 fixes the current primitive boundary: Principal, Account, Transaction, ISSUE,
and TRANSFER.

When current implementation disagrees with a specification, the implementation is migration residue
or a defect unless an explicit architecture decision changes the specification first.

Discussion threads and implementation issues are decision history and work planning. A semantic
decision becomes normative when it is incorporated into the owning specification here.

## Progressive disclosure

Read only the smallest layer required by the change.

Start with the domain index. Read the domain document that owns the concept being changed. Read the
technical index when the change crosses persistence, authentication, registration, time, idempotency,
or transaction boundaries. Consult ADRs for architectural rationale after the invariant is clear.

A feature or simulation consumer should not need to understand storage internals.

## Domain and technical scope

Domain specifications define runtime-independent concepts, valid states, monetary transitions,
identity, authorization boundaries, and product visibility semantics.

Technical specifications define guarantees across trust or component boundaries, including
serialization, persistence, authentication, registration, idempotency, and authoritative time.

The primitive economic domain deliberately stops before product or simulation policy. A useful
higher-level concept does not become a ledger primitive unless ISSUE or TRANSFER is insufficient to
state a required monetary invariant.

## Current migration

The specification has moved to the primitive model before implementation migration #25.

Source and schema on main may therefore temporarily contain superseded User, Wallet, Treasury,
EconomicOperation, LedgerTransaction, or four-operation names. They have no normative authority.

Do not extend those concepts while reconciling implementation.

## Change discipline

A behavioral change that alters a normative invariant must update the owning specification in the
same change that introduces the new semantics.

Implementation-only work should not modify these documents merely to describe mechanics.

Specifications state enduring invariants, not instructions for a particular runtime.
