# Community Token Platform for OJIverse

A feature-agnostic, transfer-centric community economic substrate for OJIverse, implemented on
Cloudflare Workers and Durable Objects.

## Status

The legacy Supabase/Deno implementation has been removed from the tree; Git history preserves it.

The current architecture deliberately keeps feature policy outside CommunityToken core:

- [Architecture #17](https://github.com/ojiverse/communitytoken/issues/17) — feature-agnostic core boundary
- [Roadmap #18](https://github.com/ojiverse/communitytoken/issues/18) — current sequencing and gates
- [Phase 2 #19](https://github.com/ojiverse/communitytoken/issues/19) — minimal core + supported Discord surface
- [Phase 3 #5](https://github.com/ojiverse/communitytoken/issues/5) — monorepo, CI/CD, and operational stabilization

The core economic operation set is intentionally small:

```text
TOKEN_ISSUANCE
DISTRIBUTION
P2P_TRANSFER
TREASURY_PAYMENT
```

Feature-specific eligibility, cadence, scheduling, campaign state, and business uniqueness are not
core economic concepts merely because they may cause one of those movements.

Production services may share one OJIverse Cloudflare account, but mutable resources and bindings are
owned per service/plugin. Only CommunityToken core receives direct access to CommunityToken economic
persistence; cross-service integration uses explicit application/protocol boundaries. See
[ADR-0003](./docs/adr/0003-cloudflare-ingress-topology.md).

The repository currently contains the runtime-independent economic core, executable contract suite,
application boundary, Cloudflare persistence implementation, trusted API boundary, and OIDC
registration flow. Phase 2 cleanup #20 reconciles remaining source/schema comments and code with the
feature-agnostic specification.

## Development

Requires Node.js >= 22 and pnpm >= 10.

```bash
pnpm install
pnpm -r test
pnpm -r check
```

Formatting and linting use Biome; secrets scanning uses secretlint.

## Documentation

- [Specifications](./docs/specification/README.md) — normative domain and technical invariants
- [Economic Model](./docs/economic-model.md) — compatibility entry point into economic specifications
- [Engineering Principles](./docs/engineering-principles/README.md)
- [Design Policies](./docs/design-policy/README.md)
- [Architecture Decision Records](./docs/adr/README.md)

Normative semantics and invariants live in the specifications. ADRs preserve architectural rationale
that should remain discoverable beyond a design thread. The current high-level responsibility
boundary is #17. Implementation sequencing, concrete runtime choices, deployment facts, and feature
delivery details live in the relevant GitHub issues.

## License

MIT License, see [./LICENSE](./LICENSE).
