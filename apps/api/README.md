# Community Token API Service

Supabase Edge Functions implementation for the Community Token System.

## Architecture

- **Runtime**: Deno (via Supabase Edge Runtime)
- **Database**: PostgreSQL (via Supabase)
- **Authentication**: Supabase Auth (JWT)
- **Package Management**: Deno native (not npm/pnpm - this is NOT a Node.js workspace)

## Directory Structure

```
apps/api/
├── supabase/
│   ├── config.toml                              # Supabase configuration
│   ├── seed.sql                                 # Initial data seeding
│   ├── migrations/
│   │   └── 20251026103039_initial_schema.sql   # Complete database schema
│   └── functions/                               # Edge Functions (Deno runtime)
│       ├── deno.json                            # Deno configuration
│       ├── _shared/                             # Shared utilities
│       ├── hello/                               # Test function
│       ├── transfers/                           # P2P transfer endpoint
│       ├── wallet/                              # Wallet inquiry endpoint
│       └── transactions/                        # Transaction history endpoint
└── README.md                                    # This file
```

Note: This directory is NOT part of the pnpm workspace. It uses Deno's native package management.

## Development

### Start Supabase services

```bash
cd /home/oji/work_dir/communitytoken
pnpm supabase start --workdir apps/api
```

### Serve Edge Functions locally

From project root:

```bash
# Serve all functions (no JWT verification for development)
pnpm supabase functions serve --workdir apps/api --no-verify-jwt

# Serve specific function with JWT verification
pnpm supabase functions serve hello --workdir apps/api
```

Or use Supabase CLI directly:

```bash
cd apps/api
supabase functions serve --no-verify-jwt
```

### Access services

- API Gateway: http://127.0.0.1:54321
- Studio (Admin UI): http://127.0.0.1:54323
- Edge Functions: http://127.0.0.1:54321/functions/v1/<function-name>

## Edge Functions

### Implemented

- `hello` - Test function to verify Deno environment

### TODO (MVP)

- `transfers` - POST /functions/v1/transfers - P2P token transfers
- `wallet` - GET /functions/v1/wallet - Wallet balance inquiry
- `transactions` - GET /functions/v1/transactions - Transaction history

## Database Schema

The database schema is defined in `supabase/migrations/20251026103039_initial_schema.sql`.

Tables:
- `wallets` - Token wallets
- `users` - Regular user accounts
- `system_accounts` - System accounts with issuance authority
- `transactions` - Immutable transaction records

See `../../docs/database.md` for detailed schema documentation.

## Testing

```bash
# Test hello function
curl http://127.0.0.1:54321/functions/v1/hello
```

## References

- [Supabase Edge Functions Documentation](https://supabase.com/docs/guides/functions)
- [Deno Documentation](https://deno.land/manual)
- [Design Document](../../docs/design.md)
- [Tech Stack](../../docs/tech.md)
