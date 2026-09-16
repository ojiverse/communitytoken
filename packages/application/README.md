# @communitytoken/application

The runtime-independent application layer of the Phase 2 CommunityToken service
(issue #4). It owns use-case orchestration, actor context, authorization, and
visibility policy. It owns **no** storage, no platform/runtime types, and no
economic rules — the economic decision boundary remains
`@communitytoken/economic-kernel`.

Trusted surfaces (`/internal/*` and `/admin/*` in issue #4 §11) resolve an
`Actor` and invoke `CommunityTokenApplication` methods. External-identity
resolution, credential checks, and idempotency are boundary concerns owned by
later PRs and deliberately absent here.

## Boundary invariant

Every method runs inside `UnitOfWork.transact`, the single atomic commit
section:

```text
Atomic mutation sections contain no await / external I/O.
Repository operations used inside that boundary are synchronous.
Async network work must complete before entering the serialized commit section.
```

The invariant is enforced twice: `Synchronous<R>` rejects promise-returning
work at compile time, and conforming `UnitOfWork` implementations throw at
runtime when `work` returns a `PromiseLike`. The production adapter maps
`transact` onto the CommunityState Durable Object's synchronous storage
transaction; this package depends on no Cloudflare types.

## Ports

- `Clock` — epoch-millisecond time authority. The production implementation
  samples `Date.now()` once per serialized transaction and serves that frozen
  value; tests inject fixed/stepping clocks (issue #4 §8).
- `UnitOfWork` — the atomic boundary described above.
- `TransactionScope` — the repositories valid inside a section:
  - `WalletRepository` — wallet lookup and absolute balance writes driven by
    kernel `EconomicEffect` deltas.
  - `OperationRepository` — `EconomicOperation` append plus the operation+ledger
    history join (newest-first, opaque cursor).
  - `LedgerRepository` — append-only `LedgerTransaction` writes.

Record ids are allocated inside repository implementations — identifier
allocation is a persistence-boundary concern (issue #4 §22), so no
`IdGenerator`/`RandomSource` port exists yet.

## Actor model

`Actor` is a discriminated union encoding the persisted `actor_kind` /
`actor_id` columns of issue #4 §13 at compile time: `user` and `service`
actors carry an identifier, `system` carries none. The actor is attached when
the `EconomicOperation` is persisted; it is never an input to the economic
evaluator.

Use-case authorization:

- `issueToken`, `distributeToken` — require `actor.kind === "service"`. Any
  service principal is accepted at this layer; the `/admin/*` boundary binds
  the concrete principal.
- `transferToken`, `payTreasury` — require `actor.kind === "user"`; the source
  wallet is the actor's own by construction. A user actor can never move
  another user's funds, and `discord-adapter` can never appear as the actor of
  a user-initiated operation.
- `getBalance`, `getTransactionHistory` — self-only (issue #4 §17): user
  selectors require the matching user actor, the treasury selector requires a
  service actor.

## History semantics

Newest-first, opaque cursor pagination, default page size 50 capped at 100.
`TOKEN_ISSUANCE` never appears in a user's history — its movement touches only
the treasury wallet, so the wallet filter excludes it by construction. The
treasury selector is the administrative view and does show issuances.
`direction` is `"in"` iff the subject wallet is the movement destination (a
self-transfer is `"in"`); `counterparty` is `"treasury"` for the system side
or the other wallet's owning user id.

## Deferred to later PRs (per the approved slicing)

| Port/capability | Arriving PR |
| --- | --- |
| `IdentityBinding` repository + external-identity resolution | PR-3 |
| `IdempotencyRecord` repository + fingerprint v1 | PR-3 |
| `User`/`RegistrationIntent` repositories, `RandomSource`, OIDC RP port | PR-4 |
| `DailyRewardClaim` repository + `DAILY_REWARD` kind | PR-5 |
