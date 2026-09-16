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
| `balance` | Non-negative integer token balance. |
| `created_at` | Creation timestamp in epoch milliseconds. |

Exactly one `system` wallet exists per deployment: the treasury. The treasury has no user owner.
Every `user` wallet is referenced by exactly one user.

### EconomicOperation

The semantic record of why a movement occurred. Every balance mutation is explained by exactly one
operation, and every operation is recorded even when it would later be superseded by corrections.

| Field | Meaning |
| --- | --- |
| `id` | Opaque, unique identifier. |
| `kind` | One of the operation kinds in §3. |
| `actor_wallet` | The wallet that initiated the operation — the debit side of the transfer. |
| `metadata` | Optional opaque context supplied by the triggering feature. The core does not interpret it. |
| `created_at` | Commit timestamp in epoch milliseconds. |

### LedgerTransaction

The auditable fact of a single transfer. Ledger entries reference the operation that caused them;
they are the authoritative movement history.

| Field | Meaning |
| --- | --- |
| `id` | Opaque, unique identifier. |
| `operation` | Reference to the owning EconomicOperation. Immutable. |
| `from_wallet` | Debit side. |
| `to_wallet` | Credit side. |
| `amount` | Positive integer amount moved. |
| `created_at` | Commit timestamp in epoch milliseconds. |

In Phase 1 every operation produces exactly one ledger entry. The operation/ledger split exists so
that future kinds may record richer structure without changing the movement contract.

## 3. Operation kinds and transfer semantics

Four kinds. No others exist until the feature that requires them is implemented.

| Kind | From | To | Balance effect | Supply effect |
| --- | --- | --- | --- | --- |
| `TOKEN_ISSUANCE` | treasury | treasury | treasury `+amount`; no debit | supply `+amount` |
| `DISTRIBUTION` | treasury | user | treasury `-amount`, user `+amount` | unchanged |
| `P2P_TRANSFER` | user | user | sender `-amount`, recipient `+amount` | unchanged |
| `TREASURY_PAYMENT` | user | treasury | user `-amount`, treasury `+amount` | unchanged |

Rules applying to every kind:

- `amount` must be a positive safe integer. Zero, negative, and fractional amounts are rejected
  before any state is touched.
- Issuance is a self-transfer on the treasury: it credits without debiting. Every other kind
  requires `from.balance >= amount` and is rejected otherwise.
- For each accepted operation, the balance updates, the EconomicOperation record, and the ledger
  entry commit atomically. A failure at any point leaves all state untouched.
- Wallet-kind direction is enforced per the table: a kind used with any other direction is
  rejected.

## 4. Invariants

Named normative statements. Storage-independent contract tests reference them by name.

- **Single community scope** — all economic state belongs to one community. The model has no
  cross-community movement or reference.
- **One wallet per user** — each user owns exactly one wallet, and exactly one system wallet (the
  treasury) exists per deployment.
- **Positive integer amounts** — every ledger amount is a positive integer.
- **Non-negative balances** — no wallet balance may become negative. An operation that would
  violate this is rejected atomically.
- **Direction discipline** — each operation kind admits exactly the wallet-kind direction defined
  in §3.
- **Atomic mutation** — balance updates, the operation record, and ledger entries commit together
  or not at all. No partially-applied operation is observable.
- **Append-only ledger** — ledger entries are never updated or deleted. Corrections are expressed
  as new operations.
- **Issuance-only supply growth** — only `TOKEN_ISSUANCE` increases total supply. Every other kind
  preserves it exactly.
- **Supply accounting** — at every committed state, total issued amount equals the sum of all
  wallet balances (circulating user balances plus treasury balance).
- **Serialized mutation** — all mutations pass through the deployment's single serialization
  authority. Concurrent operations cannot double-spend or lose updates.

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

- **Domain kernel** — owns the rules of §3 and the invariants of §4. Depends on no Cloudflare
  runtime types. Time and identifier generation are injected ports, so `Date.now` and
  `crypto.randomUUID` never appear inside domain code.
- **Durable Object** — one named instance per deployment serializes all mutation. It applies the
  kernel's decision inside a storage transaction; it holds no economic policy.
- **SQLite storage** — persists state and enforces structural floors: non-negative balances,
  positive amounts, foreign keys, ledger immutability. It never contains policy such as reward
  amounts, prices, or issuance strategy.

## 7. Deliberate absences

The following existed in the legacy implementation or are plausible future features. Each is
absent on purpose; the record explains what would own the concern if it returns.

- **Wallet freeze** — no Phase 1 requirement. When needed, freezing is domain policy evaluated at
  operation time by the kernel, not a storage flag.
- **Soft delete** — no entity is deletable in Phase 1, and ledger immutability already forbids
  removing history. Deletion semantics wait for a concrete requirement.
- **Multiple system accounts** — a single treasury covers every Phase 1 flow. Additional system
  wallets arrive only with a demonstrated need.
- **Additional operation kinds** — a kind is added only by the feature that requires it (for
  example, a reward kind when Daily Reward is implemented). No speculative kinds.
- **Reversal or correction kinds** — corrections are ordinary new operations; the incorrect entry
  remains as history. No special reversal semantics in Phase 1.
- **External identity binding** — OIDC `iss`/`sub` binding is Phase 2. A user is currently only an
  internal anchor for wallet ownership.

## 8. Evidence

- Storage-independent contract tests exercise each invariant of §4 by name. They are the
  compatibility contract for any storage backend.
- The merged proof of concept validated the Cloudflare consistency model end to end: atomic commit
  of balances, operation, and ledger; serialization under concurrent transfers; rollback on
  rejection; append-only enforcement at the storage layer; and persistence across Durable Object
  eviction.
