# Economic Model Specification

Normative specification of the CommunityToken economic core for the Cloudflare rebuild.

- Phase 1 deliverable of the rebuild roadmap; tracking issue #3.
- Issue #2 is the architectural source of truth. Where this document and #2 disagree, #2 wins.
- Legacy documents (`design.md`, `database.md`, `features.md`, `tech.md`) describe the
  Supabase/PostgreSQL implementation and are retained as reference material only. They are not
  normative for the rebuild.

## 1. Scope

This specification fixes the economic semantics that any storage backend must preserve. It is
normative for the Phase 2 economic kernel and for the storage-independent invariant tests.

In scope:

- the entity model and its ownership relationships;
- the four operation kinds and their transfer semantics;
- the invariants that every implementation must preserve;
- the responsibility boundary between domain policy, serialization, and storage.

Out of scope for Phase 1 (each has its own phase in issue #2): external identity and OIDC
bindings, the HTTP product API, interaction-surface adapters, reward features, game features, and
economic simulation. Nothing in this document prevents them; they simply are not fixed yet.

Two structural commitments frame everything below:

- One deployment serves exactly one community. The model contains no cross-community concept.
- One user owns exactly one wallet.

## 2. Entities

Field tables define the semantic contract. Storage may add bookkeeping columns; it may not weaken
or contradict these fields.

### User

The internal identity anchor. In Phase 1 a user exists only to anchor wallet ownership; external
identity bindings arrive with Phase 2.

| Field | Meaning |
| --- | --- |
| `id` | Opaque, unique, stable internal identifier. Never derived from an external provider. |
| `wallet` | Reference to the user's single wallet. Established at creation; immutable. |
| `created_at` | Creation timestamp in epoch milliseconds. |

### Wallet

The balance-holding entity. Wallets are conceptually independent: a user references its wallet,
not vice versa.

| Field | Meaning |
| --- | --- |
| `id` | Opaque, unique identifier. |
| `kind` | `user` or `system`. |
| `balance` | WalletBalance — integer in `0 .. 2^53 - 1`. `0` is a valid state. |
| `created_at` | Creation timestamp in epoch milliseconds. |

Exactly one `system` wallet exists per deployment: the treasury. The treasury has no user owner.
Every `user` wallet is referenced by exactly one user.

### EconomicOperation

The semantic record of why a movement occurred. Every balance mutation is explained by exactly one
operation, and every operation is recorded even when it would later be superseded by corrections.

The operation and its ledger entries have different responsibilities: the operation preserves the
semantic reason (kind, feature context), while ledger entries preserve the mechanical movement.
Neither alone is the authoritative economic meaning — the pair is.

| Field | Meaning |
| --- | --- |
| `id` | Opaque, unique identifier. |
| `kind` | One of the operation kinds in §3. |
| `metadata` | Optional opaque context supplied by the triggering feature. The core does not interpret it. |
| `created_at` | Commit timestamp in epoch milliseconds. |

The operation's initiator (the user or system process that caused it) is deliberately not modeled
yet — it is a distinct concept from the ledger's source wallet and is deferred per §7.

### LedgerTransaction

The auditable fact of a single transfer. Ledger entries reference the operation that caused them;
they are the authoritative movement history.

| Field | Meaning |
| --- | --- |
| `id` | Opaque, unique identifier. |
| `operation` | Reference to the owning EconomicOperation. Immutable. |
| `from_wallet` | Source wallet reference. |
| `to_wallet` | Destination wallet reference. |
| `amount` | TokenAmount moved. |
| `created_at` | Commit timestamp in epoch milliseconds. |

`from_wallet` and `to_wallet` are references, not balance instructions. Their effect on balances is
defined by the owning operation's kind (§3): for `DISTRIBUTION`, `P2P_TRANSFER`, and
`TREASURY_PAYMENT` the source wallet is debited and the destination credited; for `TOKEN_ISSUANCE`
both references are the treasury and the credit is applied with no debit.

In Phase 1 every operation produces exactly one ledger entry. The operation/ledger split exists so
that future kinds may record richer structure without changing the movement contract.

## 3. Operation kinds and transfer semantics

Four kinds. No others exist until the feature that requires them is implemented.

| Kind | From | To | Balance effect | Supply effect |
| --- | --- | --- | --- | --- |
| `TOKEN_ISSUANCE` | treasury | treasury | credit-only: treasury `+amount`, no debit | supply `+amount` |
| `DISTRIBUTION` | treasury | user | treasury `-amount`, user `+amount` | unchanged |
| `P2P_TRANSFER` | user | user | sender `-amount`, recipient `+amount` | unchanged |
| `TREASURY_PAYMENT` | user | treasury | user `-amount`, treasury `+amount` | unchanged |

**Monetary value domains.** Three bounded integer domains apply, all measured in the same token
unit:

| Domain | Range | Applies to |
| --- | --- | --- |
| `TokenAmount` | `1 .. 2^53 - 1` | every operation `amount` |
| `WalletBalance` | `0 .. 2^53 - 1` | every wallet `balance`; `0` is a valid state |
| `TotalSupply` | `0 .. 2^53 - 1` | total issued amount, equivalently the sum of all wallet balances |

These intentionally narrow the legacy PostgreSQL `BIGINT` domain: the production store returns SQL
numbers through the JavaScript number type, whose 52-bit mantissa cannot represent large int64
values exactly. Bounding every monetary value to the safe range prevents silent precision loss at
the storage boundary. The full signed 64-bit range is deliberately not preserved.

**Overflow rejection.** An accepted operation must keep every resulting monetary value in range.
If a credit — including `TOKEN_ISSUANCE`'s treasury credit — would push a wallet balance or the
total supply above `2^53 - 1`, the operation is rejected before any state is touched, per
**Rejection leaves no trace** in §4.

Rules applying to every kind:

- `amount` must be a valid TokenAmount. Zero, negative, fractional, and out-of-range amounts are
  rejected before any state is touched.
- `TOKEN_ISSUANCE` credits the treasury without debiting any wallet — the ledger row records
  source and destination as the treasury, and the credit-only semantics come from the kind, not
  from the row. Every other kind requires `from.balance >= amount` and is rejected otherwise.
- For each accepted operation, the balance updates, the EconomicOperation record, and the ledger
  entry commit atomically. A failure at any point leaves all state untouched.
- Wallet-kind direction is enforced per the table: a kind used with any other direction is
  rejected.

## 4. Invariants and consistency guarantees

Two distinct categories. **Economic invariants** are properties of the domain model itself: they
hold for any conforming implementation on any storage backend, and storage-independent contract
tests verify them by name. **Persistence consistency guarantees** are properties of the production
Cloudflare architecture; they are verified by Durable Object / SQLite integration tests, not by
kernel-level tests.

### Economic invariants (storage-independent)

- **Single community scope** — all economic state belongs to one community. The model has no
  cross-community movement or reference.
- **One wallet per user** — each user owns exactly one wallet, and exactly one system wallet (the
  treasury) exists per deployment.
- **Token amounts are in range** — every amount is a valid TokenAmount (§3).
- **Balances stay in range** — every wallet balance remains a valid WalletBalance (§3), with `0` a
  legitimate state. A credit that would push a balance above the range is rejected.
- **Direction discipline** — each operation kind admits exactly the wallet-kind direction defined
  in §3.
- **Rejection leaves no trace** — a rejected operation produces no change to resulting economic
  state: no balance movement, no operation record, no ledger entry.
- **Append-only ledger semantics** — ledger entries are never updated or deleted as a matter of
  application semantics. Corrections are expressed as new operations.
- **Issuance-only supply growth** — only `TOKEN_ISSUANCE` increases total supply. Every other kind
  preserves it exactly.
- **Supply accounting** — in every state produced by accepted operations, total issued amount
  equals the sum of all wallet balances (circulating user balances plus treasury balance), and the
  total remains within the TotalSupply range of §3. An issuance that would push it out of range is
  rejected.

### Persistence consistency guarantees (production architecture)

- **Serialized mutation** — all mutations pass through the deployment's single serialization
  authority (the named `CommunityState` Durable Object). Concurrent operations cannot double-spend
  or lose updates.
- **Durable atomic commit** — balance updates, the operation record, and ledger entries commit as
  one durable transaction or not at all. No partially-applied operation is persisted.
- **Storage-enforced append-only** — the storage layer rejects updates and deletes on ledger
  entries independent of application behavior.
- **Persistence across eviction** — committed state survives Durable Object eviction and restart
  because it lives in storage, not instance memory.

## 5. Preserve versus replace

The rebuild preserves the economic semantics of the Supabase/PostgreSQL implementation while
replacing every mechanism that enforced them.

| Legacy mechanism | Preserved semantics | Replacement |
| --- | --- | --- |
| Transfer-centric transaction model | all economic activity is a wallet-to-wallet transfer | unchanged; now expressed as the four kinds |
| Integer `transaction_type` with direction-derived meaning | direction rules per kind | semantic `EconomicOperation.kind` |
| `FOR UPDATE` row locking | mutation serialization, no double-spend | single Durable Object as serialization authority |
| Balance-check trigger | non-negative balances | domain invariant evaluation, plus storage CHECK as a floor |
| Ledger immutability triggers | append-only ledger | storage-level constraint retained as a hard floor |
| Multi-statement SQL transaction | atomic commit of balances + operation + ledger | the storage transaction of the owning Durable Object |
| `BIGINT` amount domain | positive integer amounts | `TokenAmount` range of §3 — an intentional narrowing, documented there |
| Supabase Auth, Edge Functions, PostgREST | none — platform mechanics | Worker entrypoint and Phase 2 OIDC relying party |

Economic policy — issuance strategy, amounts, prices, rewards — was never legitimate trigger
content and remains domain-owned. Storage constraints express structure only.

## 6. Responsibility boundaries

```text
domain kernel            economic policy + invariant evaluation
  |                      (runtime-independent; no platform types)
  v
Durable Object           serialization authority; ordering only
  |
  v
SQLite storage           persistence + structural constraints
```

- **Domain kernel** — owns the rules of §3 and the economic invariants of §4. Depends on no
  Cloudflare runtime types. Time and identifier generation are injected ports, so `Date.now` and
  `crypto.randomUUID` never appear inside domain code.
- **Durable Object** — one named instance per deployment serializes all mutation. It applies the
  kernel's decision inside a storage transaction; it holds no economic policy.
- **SQLite storage** — persists state and enforces structural floors: non-negative balances,
  positive amounts, foreign keys, ledger immutability. It never contains policy such as reward
  amounts, prices, or issuance strategy.

## 7. Deliberate absences

The following existed in the legacy implementation or are plausible future features. Each is
absent on purpose; the record explains what would own the concern if it returns.

- **Wallet freeze** — out of scope for Phase 1. If reintroduced, enforcement belongs to
  domain/application policy; whether frozen-ness is persisted state is intentionally deferred until
  a concrete requirement exists.
- **Soft delete** — no entity is deletable in Phase 1, and ledger immutability already forbids
  removing history. Deletion semantics wait for a concrete requirement.
- **Operation initiator (actor)** — the user or system process that caused an operation is a
  distinct concept from the ledger's source wallet (an admin distributing to Alice has actor admin
  and source treasury). Phase 1 fixes no actor representation; when required, it is a user- or
  system-level reference on the operation, never an alias for `from_wallet`.
- **Multiple system accounts** — a single treasury covers every Phase 1 flow. Additional system
  wallets arrive only with a demonstrated need.
- **Additional operation kinds** — a kind is added only by the feature that requires it (for
  example, a reward kind when Daily Reward is implemented). No speculative kinds.
- **Reversal or correction kinds** — corrections are ordinary new operations; the incorrect entry
  remains as history. No special reversal semantics in Phase 1.
- **External identity binding** — OIDC `iss`/`sub` binding is Phase 2. A user is currently only an
  internal anchor for wallet ownership.

## 8. Evidence

This section distinguishes what is already verified from what remains as Phase 1 work.

### Validated

The merged proof of concept exercised the production architecture end to end and verified the
persistence consistency guarantees of §4:

- durable atomic commit of balances, operation record, and ledger entry in one transaction;
- serialization of concurrent transfers without double-spend or lost updates;
- full rollback of rejected operations;
- storage-enforced append-only ledger;
- persistence across Durable Object eviction.

### Pending Phase 1 evidence

- Storage-independent contract tests that verify each economic invariant of §4 by name, including
  the domain boundaries and overflow rejection of §3. They are the compatibility contract for any
  storage backend.
- The minimal runtime-independent kernel those tests run against.

When the contract-test work lands, its entries move from pending to validated.
