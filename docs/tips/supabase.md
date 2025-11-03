# Development Tips - Supabase

## TypeScript Type Generation

Generate type-safe TypeScript definitions from your database schema using Supabase CLI (v1.8.1+).

### Workflow

```bash
# During development: generate types from local schema
pnpm supabase:types:gen

# Before deployment: verify production schema matches
pnpm supabase:types:verify
```

### How It Works

The CLI generates three types per table (Row, Insert, Update) from your database schema. During development, use `--local` to generate from migrations (source of truth). Before production deployment, use `--project-id` to verify no schema drift exists between local and remote.

Generated types are automatically applied to the Supabase client in `apps/api/src/lib/db.ts`, providing autocomplete for table names, column names, and type checking for queries.
