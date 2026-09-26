# Community Token Platform for OJIverse

CommunityToken is a primitive integer-value ledger and a Discord-first product built on top of it.

The architecture is intentionally smaller than the product. The monetary core preserves only the
facts required to validate and commit value movement, while product features and economic simulation
own the reasons those movements occur.

## Architecture

Architecture authority is GitHub issue #17.

The primitive model contains three concepts:

- Principal: a stable internal owner of Accounts.
- Account: a non-negative integer balance container.
- Transaction: an immutable committed monetary fact.

There are exactly two monetary transaction kinds:

- ISSUE credits one Account and increases total supply by the same amount.
- TRANSFER moves existing value between Accounts and leaves total supply unchanged.

The core does not classify Principals as human, bot, agent, service, organization, community, or
system. It does not classify Accounts as user, treasury, reserve, escrow, or another institutional
role.

Distribution, peer-to-peer payment, treasury payment, Daily Reward, campaign reward, compensation,
and simulation events are higher-level meanings. When they move value, they ultimately request ISSUE
or TRANSFER through an authorized application boundary.

## Identity and current product

The beta product is Discord-first, but the internal identity model is provider-independent.

An ExternalIdentity is the exact issuer and subject pair. IdentityBinding associates that pair with a
Principal. A first successful registration creates a Principal and a product-default Account.

A Principal is not defined as a human. Future non-human or institutional subjects do not require a
new ledger model.

The current product also designates an ordinary community Principal and one ordinary Account owned by
it as the community reserve. The reserve is an application role, not an Account kind.

Initial supply is created explicitly with ISSUE to that reserve. Administrative distribution and
user-facing transfer are product use cases that perform TRANSFER.

## Simulation boundary

Economic simulation is a first-class future consumer of the same primitive ledger.

A simulation may define arbitrary Principals, Accounts, institutional roles, behavioral agents,
policies, schedules, initial conditions, and scenario events. Those rules produce ISSUE and TRANSFER
requests.

Transaction history is sufficient to reconstruct monetary state. Behavioral and policy provenance
belongs to the simulation layer and may reference Transaction identifiers.

This permits treasury, reserve, central-bank, market-maker, escrow, or other institutional models to
be introduced by scenarios without making them permanent ledger primitives.

## Roadmap

Current sequencing is:

1. Issue #24 rewrites normative documentation around the primitive architecture.
2. Issue #25 reconciles source, schema, application contracts, persistence, and tests.
3. Issue #21 implements the Discord interaction adapter over the reconciled HTTP boundary.
4. Issue #22 deploys and verifies the production stack.
5. Issue #5 stabilizes package boundaries, CI/CD, migrations, observability, and operations.

Issue #18 is the roadmap source of truth and issue #19 is the Phase 2 tracker.

The documentation on main describes the architecture that implementation must converge to. Until
issue #25 is merged, source and schema may still contain names from the superseded User, Wallet,
Treasury, EconomicOperation, LedgerTransaction, and four-operation model. Those names are migration
residue, not current design authority.

## Runtime

Production uses Cloudflare Workers and a singleton CommunityState Durable Object as the serialized
persistence authority.

Cloudflare is an implementation platform, not part of the primitive domain model.

Services may share one OJIverse Cloudflare account, but mutable resources remain service-owned.
Only CommunityToken receives direct access to CommunityToken persistence. Other services integrate
through explicit application or protocol boundaries.

See ADR-0003 for the Cloudflare topology rationale.

## Development

Requires Node.js 22 or newer and pnpm 10 or newer.

Install dependencies with pnpm install. Run repository tests with pnpm -r test and type checks with
pnpm -r check. Formatting and linting use Biome. Secret scanning uses secretlint.

## Documentation

- docs/specification contains normative semantics and technical invariants.
- docs/economic-model.md is the entry point into the primitive ledger model.
- docs/adr contains durable architectural rationale.
- docs/engineering-principles contains repository-wide reasoning rules.
- docs/design-policy contains recurring design guidance.

Normative specifications win over implementation issues for semantics and invariants. Implementation
work must reconcile the code when it disagrees with the current specification.

## License

MIT License. See LICENSE.
