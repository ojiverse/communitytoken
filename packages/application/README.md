# @communitytoken/application

The runtime-independent application layer of the Phase 2 CommunityToken service
(see docs/specification/README.md). It owns use-case orchestration, actor context, authorization, and
visibility policy. It owns **no** storage, no platform/runtime types, and no
economic rules — the economic decision boundary remains
`@communitytoken/economic-kernel`.

Trusted surfaces (`/api/v1/*` and `/api/v1/admin/*` in the authentication/delegation specification) resolve an
`Actor` and invoke `CommunityTokenApplication` methods or the exported
composable operations. Bearer-credential verification stays at the Worker
boundary; external-identity resolution and idempotency are composable
application ports (`IdentityBindingRepository`, `IdempotencyRepository`,
`executeIdempotent`) that run inside the caller's serialized section.

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

Every facade method opens its own section. The use-case operations are also
exported directly and take an already-open `TransactionContext`, so outer
orchestration owns the transaction and can extend the atomic unit — the idempotency specification
idempotency record or the Daily Reward specification Daily Reward claim row commits in the same
section as the economic mutation it protects. Sections do not nest: composed
operations share the one open context, and opening `transact` inside an open
section is a contract violation.

`executeIdempotent(ctx, keyInfo, execute)` is the composable idempotency
choreography for a protected mutation (the idempotency specification):
inside the caller's open section it looks up the record under
`(servicePrincipal, idempotencyKey)`, replays the stored result verbatim
when `fingerprintVersion` and `requestFingerprint` match, reports a
conflict when they differ, and otherwise runs `execute()`. A recordable
outcome (`record: true`) inserts the serialized result before returning;
an expected non-mutating failure (`record: false`) leaves the key
unconsumed and retryable. A throw — from `execute` or the record insert —
propagates and rolls the whole section back, so the record and the
mutation it guards commit atomically.

## Ports

- `Clock` — epoch-millisecond time authority consumed by the `UnitOfWork`
  implementation, which samples it exactly once per serialized transaction
  at entry and freezes the value on the `TransactionContext` (the temporal-authority specification).
  Tests inject fixed/stepping clocks.
- `UnitOfWork` — the atomic boundary described above.
- `TransactionScope` — the repositories valid inside a section:
  - `WalletRepository` — wallet lookup and absolute balance writes driven by
    kernel `EconomicEffect` deltas.
  - `OperationRepository` — `EconomicOperation` append plus the operation+ledger
    history join (newest-first, opaque cursor).
  - `LedgerRepository` — append-only `LedgerTransaction` writes.
  - `IdentityBindingRepository` — exact `(issuer, subject)` → `UserId`
    lookup (PR-3). Binding creation is registration-owned (PR-4); the port
    exposes no insert, unlink, or reassignment path.
  - `IdempotencyRepository` — `find`/`insert` of `IdempotencyRecord`s keyed
    by `(servicePrincipal, idempotencyKey)` (PR-3). Records are append-only;
    a duplicate insert throws so a second commit can never overwrite the
    first replay record.
- `TransactionContext` — a `TransactionScope` plus `nowMs`, the section's
  single frozen `now_ms` sampled once at entry before `work` runs (the temporal-authority specification). Context and repository handles are revoked permanently when their
  owning section closes: a captured handle cannot read or write after
  `transact` returns, and it never revives while a later section is open.
  Repository values are storage-owned immutable records — mutation only
  happens through repository mutation methods.

Record ids are allocated inside repository implementations — identifier
allocation is a persistence-boundary concern (the persistence specification), so no
`IdGenerator`/`RandomSource` port exists yet. For the same reason the only
raw-string-to-brand coercion is the explicitly named `rehydrate` namespace:
the visible unsafe boundary where persistence adapters and test support
turn stored strings into opaque ids. Application API consumes
already-branded values.

## Actor model

`Actor` is a discriminated union encoding the persisted `actor_kind` /
`actor_id` columns of the actor/visibility specification at compile time: `user` and `service`
actors carry an identifier, `system` carries none. The actor is attached when
the `EconomicOperation` is persisted; it is never an input to the economic
evaluator.

Use-case authorization:

- `issueToken`, `distributeToken` — require `AdminActor`: the `admin-api`
  service principal (the authentication/delegation specification). A call with any other principal — such as
  `discord-adapter` — is a compile error in typed code and a `forbidden`
  result at runtime.
- `transferToken`, `payTreasury` — require `UserActor`; the source wallet is
  the actor's own by construction. A user actor can never move another user's
  funds, and `discord-adapter` can never appear as the actor of a
  user-initiated operation.
- `getBalance`, `getTransactionHistory` — self-only (the actor/visibility specification): a user
  selector requires the matching `UserActor`, the treasury selector requires
  `AdminActor`. The overloads pair actor and selector so a mismatched call
  does not type-check.

## History semantics

Newest-first, opaque cursor pagination, default page size 50. A supplied
`limit` must be an integer in `1..100`; out-of-contract values are an
`invalid-input` failure carrying `code: "INVALID_LIMIT"`, never clamped
(the actor/visibility specification). `TOKEN_ISSUANCE`
never appears in a user's history — its movement touches only the treasury
wallet, so the wallet filter excludes it by construction. The treasury
selector is the administrative view and does show issuances. `direction` is
`"in"` when value arrives at the subject wallet, `"out"` when it leaves, and
`"self"` for a net-zero self-movement (a `P2P_TRANSFER` whose sides are the
same wallet); `counterparty` is `"treasury"` for the system side or the other
wallet's owning user id — the user's own id for a self-transfer (the actor/visibility specification).

## Deferred to later PRs (per the approved slicing)

| Port/capability | Arriving PR |
| --- | --- |
| `User`/`RegistrationIntent` repositories, `RandomSource`, OIDC RP port | PR-4 |
| `DailyRewardClaim` repository + `DAILY_REWARD` kind | PR-5 |
