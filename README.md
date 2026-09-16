# Community Token Platform for ojiverse

A transfer-centric community token system for ojiverse, rebuilt on Cloudflare Workers and
Durable Objects.

## Status

The legacy Supabase/Deno implementation has been removed from the tree
([issue #4](https://github.com/ojiverse/communitytoken/issues/4) §20); git history preserves it.
The repository currently contains the Phase 1 deliverables of the rebuild:

- `packages/economic-kernel` — runtime-independent pure economic evaluator
  (`@communitytoken/economic-kernel`)
- `packages/economic-contract` — executable economic contract suite
  (`@communitytoken/economic-contract`)
- `poc/community-state` — Cloudflare Durable Object + SQLite persistence proof of concept
- `docs/economic-model.md` — normative economic specification

Phase 2 ([issue #4](https://github.com/ojiverse/communitytoken/issues/4)) builds the production
service on top of these under `apps/` and `packages/application`.

## Development

Requires Node.js >= 22 and pnpm >= 10.

```bash
pnpm install        # install workspace dependencies
pnpm -r test        # run package tests
pnpm -r check       # typecheck all packages
```

Formatting and linting use Biome; secrets scanning uses secretlint. Both run on staged files via
simple-git-hooks + lint-staged.

## Documentation

- [Economic Model](./docs/economic-model.md) — normative economic specification
- [Engineering Principles](./docs/engineering-principles/README.md)
- [Design Policies](./docs/design-policy/README.md)

## LICENSE

MIT License, see [./LICENSE](./LICENSE)
