# Getting Started with Supabase Edge Functions

This guide walks you through setting up and running the Community Token API locally using Supabase Edge Functions.

## Prerequisites

- Supabase CLI installed
- Deno runtime (comes with Supabase CLI)
- pnpm installed (for running workspace scripts)

## Architecture Overview

The API is built with:
- **Runtime**: Deno (via Supabase Edge Functions)
- **Framework**: Hono (lightweight web framework)
- **Package Management**: JSR/npm imports via Deno import maps
- **Database**: PostgreSQL (via Supabase local stack)

## Directory Structure

```
apps/api/
|-- deno.json                    # Deno configuration and import map
|-- supabase/
|   |-- config.toml              # Supabase local configuration
|   |-- functions/
|   |   `-- api/
|   |       `-- index.ts         # Edge Function entrypoint
|   |-- migrations/
|   |   `-- 20251026103039_initial_schema.sql
|   `-- seed.sql
`-- src/
    |-- app.ts                   # Hono app configuration
    |-- routes/
    |   `-- users.ts             # User endpoints
    `-- lib/
        `-- types.ts             # TypeScript types
```

## Step-by-Step Setup

### Step 1: Navigate to Project Root

```bash
cd /path/to/communitytoken
```

### Step 2: Start Supabase Local Stack (Optional)

If you need database access, start the full Supabase stack:

```bash
pnpm supabase:start
```

This starts:
- PostgreSQL on port 54322
- Supabase Studio on http://localhost:54323
- API Gateway on http://localhost:54321

**Note**: For API-only testing, you can skip this step.

### Step 3: Start Edge Functions Server

```bash
pnpm supabase:serve
```

This command:
- Runs `supabase functions serve --workdir apps/api --no-verify-jwt`
- Serves functions at http://localhost:54321/functions/v1/
- Uses import map from `apps/api/deno.json`
- Disables JWT verification for local testing

Expected output:
```
Using workdir apps/api
Setting up Edge Functions runtime...
Serving functions on http://127.0.0.1:54321/functions/v1/<function-name>
 - http://127.0.0.1:54321/functions/v1/api
Using supabase-edge-runtime-1.69.15 (compatible with Deno v2.1.4)
```

### Step 4: Test Health Endpoint

In a new terminal:

```bash
curl http://localhost:54321/functions/v1/api/health
```

Expected response:
```json
{"status":"ok"}
```

### Step 5: Test User Endpoints

Test the mock user endpoint:

```bash
curl http://localhost:54321/functions/v1/api/v1/users/@me
```

Expected response:
```json
{"id":"mock-user-id","username":"mock-user"}
```

Test the mock wallet endpoint:

```bash
curl http://localhost:54321/functions/v1/api/v1/users/@me/wallet
```

Expected response:
```json
{"id":"mock-wallet-id","balance":0}
```

## URL Routing Architecture

The request flow works as follows:

1. **Client Request**: `http://localhost:54321/functions/v1/api/health`
2. **Edge Functions Gateway**: Strips `/functions/v1/` prefix
3. **Function Handler**: Receives `/api/health` (apps/api/supabase/functions/api/index.ts:8-12)
4. **Path Transformation**: Strips `/api` prefix to get `/health`
5. **Hono Router**: Matches route in apps/api/src/app.ts:15
6. **Response**: Returns JSON

## Configuration Files

### apps/api/supabase/config.toml

Key configuration for the `api` function:

```toml
[functions.api]
verify_jwt = false          # Disable JWT verification for local testing
import_map = "../deno.json" # Path to import map (relative to supabase/ directory)
```

### apps/api/deno.json

Import map for dependencies:

```json
{
  "imports": {
    "hono": "jsr:@hono/hono@^4",
    "@hono/zod-openapi": "jsr:@hono/zod-openapi@^0.16",
    "zod": "npm:zod@^3.22.4",
    "@supabase/supabase-js": "jsr:@supabase/supabase-js@^2"
  }
}
```

## Development Workflow

### Hot Reload

The Edge Functions runtime is configured with `policy = "oneshot"` (apps/api/supabase/config.toml:248), which enables hot reload:

1. Edit source files in `apps/api/src/`
2. Save changes
3. Next request automatically reloads the function

No manual restart required.

### Alternative: Deno Direct Mode

For faster iteration without Supabase overhead:

```bash
cd apps/api
deno task dev
```

This runs the Hono app directly on http://localhost:8000 (see apps/api/deno.json:10).

**Note**: This mode doesn't include the `/api` prefix, so URLs are:
- http://localhost:8000/health
- http://localhost:8000/v1/users/@me

## Troubleshooting

### Error: "failed to load import map"

**Symptom**: `open supabase/deno.json: no such file or directory`

**Solution**: Check that `apps/api/supabase/config.toml:263` has `import_map = "../deno.json"` (not `"./deno.json"`)

### Error: "Relative import path 'hono' not prefixed"

**Symptom**: Worker boot error about import paths

**Solution**: Ensure `[functions.api]` section exists in `apps/api/supabase/config.toml` with the import map configured.

### 404 Not Found on /health

**Symptom**: Function starts but all routes return 404

**Solution**: Verify the path transformation handler in `apps/api/supabase/functions/api/index.ts:8-12` strips the `/api` prefix correctly.

## Next Steps

Now that the infrastructure is validated, you can proceed with:

1. **JWT Authentication** - Integrate Supabase Auth JWT verification
2. **Zod OpenAPI** - Replace plain Hono with OpenAPIHono for type-safe API spec
3. **Database Integration** - Connect to PostgreSQL via Supabase client
4. **Business Logic** - Implement actual user and wallet endpoints

Refer to `apps/api/CLAUDE.investigation.md` for detailed implementation roadmap.

## Verification Checklist

- [ ] Server starts without errors
- [ ] Health endpoint returns `{"status":"ok"}`
- [ ] User endpoint returns mock data
- [ ] Wallet endpoint returns mock data
- [ ] Hot reload works (edit source, see changes on next request)

If all items are checked, your local development environment is ready.
