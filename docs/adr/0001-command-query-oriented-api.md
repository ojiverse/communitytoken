# ADR-0001: Prefer command/query-oriented application APIs over resource-oriented CRUD APIs

- Status: Accepted
- Date: 2026-09-21
- Scope: CommunityToken trusted core API

## Context

CommunityToken persists resources and entities such as Users, Wallets, IdentityBindings,
EconomicOperations, LedgerTransactions, idempotency records, and feature state.

Those resources are not, however, the primary abstraction that callers are allowed to mutate.
CommunityToken's primary responsibility is to validate and execute a small set of domain-defined
state transitions while preserving economic, identity, authorization, idempotency, and transactional
invariants.

Examples include token issuance, treasury distribution, user transfer, treasury payment,
registration, and Daily Reward claim. A wallet balance, ledger row, or identity binding changes only
as a consequence of an allowed operation; callers do not submit an arbitrary desired representation
of those resources.

The Phase 2 design also requires an adapter to present an ExternalIdentity and execute the delegated
user action in one trusted request. Splitting identity resolution from execution would create an
unwanted resolve-then-act-as protocol and would weaken the boundary between external identity and
internal User authority.

Earlier Phase 2 design discussion therefore described the trusted boundary in terms of delegated
use-case endpoints and route-facing Durable Object orchestration rather than generic resource
manipulation. See issue #4 comments
[#5696687006](https://github.com/ojiverse/communitytoken/issues/4#issuecomment-5696687006),
[#5696910043](https://github.com/ojiverse/communitytoken/issues/4#issuecomment-5696910043), and
[#5724094688](https://github.com/ojiverse/communitytoken/issues/4#issuecomment-5724094688).

## Decision

The CommunityToken trusted core API is a command/query-oriented application API.

The API exposes meaningful application operations rather than a generic CRUD surface over persisted
resources.

Commands request a domain-defined state transition, for example:

- issue tokens;
- distribute treasury reserve;
- transfer tokens between Users;
- claim Daily Reward;
- initiate or complete registration.

Queries request an application-defined observation, for example:

- read the requesting User's balance;
- read the requesting User's history;
- inspect treasury balance or history with administrative authority.

HTTP is the transport and boundary protocol for these operations. Endpoint paths and methods are not
required to model a REST resource hierarchy or expose a uniform CRUD interface.

Persistent resources remain part of the domain and storage models, but they are not independently
mutable through the trusted API. In particular, the API must not expose operations equivalent to
setting a Wallet balance, inserting ledger history, moving an IdentityBinding, or otherwise
constructing a desired persisted state directly.

The authoritative mutation shape is:

```text
authenticated principal
  + command
  + current state
  + domain and authorization invariants
  -> accepted state transition
     or explicit rejection
```

The authoritative read shape is:

```text
authenticated principal
  + query
  + visibility rules
  -> application-defined projection
```

The URL namespace does not define resource ownership or security authority. Authentication and
authorization of the asserted principal remain authoritative. The concrete HTTP namespace is defined
separately by ADR-0002 so this decision remains about the application API model rather than a
particular path layout.

## Rationale

### State transitions carry the domain meaning

A balance changing from 100 to 90 is not sufficient domain information. The important fact is which
valid operation caused that transition, who acted, which invariant checks succeeded, and which
operation and ledger records were committed with it.

Commands preserve that meaning at the API boundary. Generic resource updates would force the core to
reconstruct intent from a desired state or would permit callers to bypass the operation semantics
entirely.

### Invalid intermediate states should not be expressible

Economic and identity state is constrained across multiple persisted records. A valid operation may
need to update balances, append an EconomicOperation and LedgerTransaction, record idempotency state,
or create User, Wallet, and IdentityBinding state atomically.

Exposing those records as independently mutable resources would make invalid partial transitions
part of the API model. A procedural command can instead own the complete atomic transition.

### Audit history is operation-centric

CommunityToken's ledger and EconomicOperation history explain why current state exists. The
semantically meaningful operation is therefore a first-class input, not merely an implementation
detail behind a resource update.

### Delegation should remain one trusted operation

An authenticated adapter may assert an ExternalIdentity for a user action, but the core resolves that
identity to the User and executes the action in the same trusted request and serialized boundary.
A generic identity-resolution resource followed by a second act-as request is deliberately absent.

### Idempotency belongs to operations

Retry protection is naturally scoped to a logical mutation command. Recording and replaying the
result of the protected operation in the same transaction is clearer than attaching idempotency
semantics to arbitrary resource replacement.

## Consequences

- API endpoints may look procedural or RPC-like rather than conventionally RESTful.
- Reads may use route shapes chosen for the delegation/query contract rather than for resource
  retrieval aesthetics.
- Adding a persisted entity does not imply adding CRUD endpoints for it.
- New mutation endpoints should name a meaningful domain/application operation and delegate to one
  authoritative transition path.
- New query endpoints should expose only projections allowed by visibility and authorization policy.
- HTTP semantics still matter: authentication, authorization, media types, status codes,
  idempotency, and error contracts remain explicit and stable.
- A future external or resource-oriented API may be added as another adapter, but it must translate
  requests into the same commands and queries rather than gaining direct mutation authority over
  persistence.
- RESTful design remains appropriate for a subsystem whose actual responsibility is resource
  lifecycle management; this ADR applies because CommunityToken's trusted core is primarily a
  constrained state-transition system.

## Rejected alternative: generic resource-oriented CRUD API

A generic resource-oriented API would expose persisted state such as Wallets, bindings, or ledger
records as the primary mutable interface.

That shape is rejected for the trusted core because it places storage representation ahead of domain
operations, makes authorization and invariant ownership less explicit, and creates mutation forms
that CommunityToken should never permit directly.

This does not mean resources are absent from the model. It means resource representation is not the
authority for changing domain state.
