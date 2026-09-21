# Community Token Platform for ojiverse

A transfer-centric community token system for ojiverse, rebuilt on Cloudflare Workers and
Durable Objects.

## Status

The legacy Supabase/Deno implementation has been removed from the tree
([issue #4](https://github.com/ojiverse/communitytoken/issues/4)); git history preserves it.

The repository contains the runtime-independent economic core, executable contract suite,
application boundary, and persistence proof used by the current rebuild.

Phase 2 is tracked by
[issue #4](https://github.com/ojiverse/communitytoken/issues/4).

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
- [Economic Model](./docs/economic-model.md) — compatibility entry point into the economic specifications
- [Engineering Principles](./docs/engineering-principles/README.md)
- [Design Policies](./docs/design-policy/README.md)
- [Architecture Decision Records](./docs/adr/README.md) — durable rationale for architectural choices

Normative semantics and invariants live in the specifications. ADRs preserve architectural rationale
that should remain discoverable beyond a design thread. Implementation sequencing, concrete runtime
choices, deployment facts, and feature delivery details remain in the relevant GitHub issues.

## LICENSE

MIT License, see [./LICENSE](./LICENSE)
