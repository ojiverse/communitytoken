# Community Token Platform for OJIverse

CommunityToken is a primitive integer-value ledger and a Discord-first product built on top of it.

The monetary core preserves only the facts required to validate and commit value movement. Product
features and economic simulations own the reasons those movements occur.

## Architecture

Architecture authority is GitHub issue #17.

The primitive model contains:

- Principal: a stable internal subject that may own Accounts.
- Account: a non-negative integer balance container owned by one Principal.
- Transaction: an immutable committed monetary fact.

There are exactly two monetary transaction kinds.

ISSUE creates supply. It records the Principal under whose authority supply was issued, the
destination Account, and the amount.

TRANSFER moves existing value between Accounts and leaves total supply unchanged.

The core does not classify Principals as human, bot, agent, service, organization, community, or
system. It does not classify Accounts by product or institutional role.

Distribution, peer-to-peer payment, rewards, campaigns, and simulation events are higher-level
meanings. When they move value, they ultimately request ISSUE or TRANSFER through an authorized
application boundary.

## Identity and default Account

The beta product is Discord-first, but internal identity is provider-independent.

An ExternalIdentity is the exact issuer and subject pair. IdentityBinding associates that pair with a
Principal.

The application may designate at most one default Account for a Principal. A first successful
registration creates a Principal, creates one zero-balance Account, and designates that Account as
the Principal's default.

The primitive model does not require every Principal to have a default Account.

## Current product

Administrative issuance directly credits the target registered Principal's default Account.

The current administrative authority maps to a stable internal Principal, and that Principal is
recorded on every ISSUE it authorizes.

User-facing transfer resolves sender and recipient external identities to their Principals and
default Accounts, then performs TRANSFER.

There is no CommunityToken reserve or treasury Account concept in the current product.

## Simulation boundary

Economic simulation is a first-class future consumer of the same primitive ledger.

A simulation may define arbitrary Principals, Accounts, institutions, behavioral agents, policies,
schedules, initial conditions, and scenario events. Those rules produce ISSUE and TRANSFER requests.

Transaction history is sufficient to reconstruct monetary state. Higher-level behavioral or policy
provenance remains owned by the simulation layer.

## Roadmap

Current sequencing is:

1. #25 reconciles source, schema, application contracts, persistence, and tests.
2. #21 implements the Discord interaction adapter over the reconciled HTTP boundary.
3. #22 deploys and verifies the production stack.
4. #5 stabilizes package boundaries, CI/CD, migrations, observability, and operations.

Issue #18 is the roadmap source of truth and issue #19 is the Phase 2 tracker.

Documentation describes the architecture implementation must converge to. Until #25 is merged, code
may contain superseded names and routes. Those are migration residue, not current design authority.

## Runtime

Production uses Cloudflare Workers and a singleton CommunityState Durable Object as the serialized
persistence authority.

Cloudflare is an implementation platform, not part of the primitive domain model.

Only CommunityToken receives direct access to CommunityToken persistence. Other services integrate
through explicit application or protocol boundaries.

See ADR-0003 for the Cloudflare topology rationale.

## Development

Requires Node.js 22 or newer and pnpm 10 or newer.

Use pnpm install, pnpm -r test, and pnpm -r check for the normal repository workflow. Formatting and
linting use Biome. Secret scanning uses secretlint.

## Documentation

Normative semantics live under docs/specification. Architecture rationale lives under docs/adr.
Engineering principles and design policies describe repository-wide reasoning rules.

Normative specifications win over implementation issues for semantics and invariants.

## License

MIT License. See LICENSE.
