# Getting Started - Local Development Setup

## Prerequisites

- Node.js >= 22.0.0
- pnpm >= 10.0.0
- Docker and Docker Compose (for local Supabase services)
- Git
- PostgreSQL client tools (psql) - for database inspection

## System Requirements

- Operating System: Ubuntu 22.04 LTS (or compatible Linux distribution)
- Memory: At least 7GB RAM for running Supabase local services
- Disk: At least 10GB free space

## Step 1: Configure pnpm for Supabase CLI

pnpm v8+ disables postinstall scripts by default for security. The Supabase CLI package requires postinstall to download platform-specific binaries.

Create `.npmrc` in the project root:

```bash
cat > .npmrc << 'EOF'
# Enable postinstall scripts for packages like Supabase CLI
enable-pre-post-scripts=true

# Use hoisted node_modules for better compatibility
node-linker=hoisted
EOF
```

## Step 2: Install Supabase CLI

The Supabase CLI is installed as a workspace dev dependency for version consistency across the team.

### Installation

```bash
pnpm add -ED -w supabase
```

After installation, manually run the postinstall script to download the binary:

```bash
cd node_modules/supabase && node scripts/postinstall.js && cd ../..
```

### Verify installation

```bash
pnpm supabase --version
```

Expected output: `2.53.6` (or current version)

## Step 3: Install Project Dependencies

From the project root directory:

```bash
pnpm install
```

This will install all workspace dependencies including the API service.

## Step 4: Supabase Project Structure

The Supabase project has already been initialized in `apps/api/` with the complete Community Token System schema.

Directory structure:

```
apps/api/
├── supabase/
│   ├── config.toml                              # Supabase configuration
│   ├── seed.sql                                 # Initial data seeding (empty for MVP)
│   ├── migrations/
│   │   └── 20251026103039_initial_schema.sql   # Complete database schema
│   └── functions/                               # Edge Functions directory (Deno runtime)
│       ├── _shared/                             # Shared utilities
│       ├── transfers/                           # P2P transfer endpoint (future)
│       ├── wallet/                              # Wallet inquiry endpoint (future)
│       └── transactions/                        # Transaction history endpoint (future)
└── .vscode/
    └── settings.json                            # Deno configuration for VS Code
```

The initial migration `20251026103039_initial_schema.sql` includes:
- All tables: wallets, users, system_accounts, transactions
- All triggers and functions for balance validation and concurrency control
- Transaction immutability enforcement
- Wallet freezing protection (Beyond MVP feature, included for schema completeness)
- Helper functions for Unix timestamp conversion
- View: wallet_owners for ownership lookup

## Step 5: Start Local Supabase Services

Start all Supabase services locally using Docker:

```bash
pnpm supabase start --workdir /home/oji/work_dir/communitytoken/apps/api
```

Note: Use absolute path for --workdir flag.

This command will:
- Pull required Docker images (PostgreSQL, Auth, Storage, Edge Runtime, etc.)
- Start all services on localhost
- Apply database migrations automatically
- Run seed.sql if present
- Display connection strings and API keys

Expected services:
- PostgreSQL Database: 127.0.0.1:54322
- API Gateway: http://127.0.0.1:54321
- Studio (Admin UI): http://127.0.0.1:54323
- Mailpit (Email testing): http://127.0.0.1:54324

Example output connection details:

```
API URL: http://127.0.0.1:54321
Database URL: postgresql://postgres:postgres@127.0.0.1:54322/postgres
Studio URL: http://127.0.0.1:54323
Publishable key: sb_publishable_<generated>
Secret key: sb_secret_<generated>
```

Save these values for the next step.

## Step 6: Configure Environment Variables

Create environment file for the API service:

```bash
cp apps/api/.env.example apps/api/.env.local
```

Update `apps/api/.env.local` with the connection details from `supabase start` output:

```
SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_ANON_KEY=<publishable-key-from-supabase-start>
SUPABASE_SERVICE_ROLE_KEY=<secret-key-from-supabase-start>
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres
```

## Step 7: Verify Local Setup

### Check Supabase services status

```bash
pnpm supabase status --workdir /home/oji/work_dir/communitytoken/apps/api
```

Expected output should show all services as running.

### Verify database schema

Check that all tables were created:

```bash
psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -c "\dt"
```

Expected tables:
- system_accounts
- transactions
- users
- wallets

Check functions:

```bash
psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -c "SELECT routine_name FROM information_schema.routines WHERE routine_schema = 'public' ORDER BY routine_name;"
```

Expected functions (10 total):
- check_orphan_wallets
- current_unix_ms
- prevent_system_wallet_freeze
- prevent_transaction_modification
- soft_delete_user
- timestamp_to_unix
- unix_to_timestamp
- update_updated_at_unix
- update_wallet_balances
- validate_transaction_balance

### Access Supabase Studio

Open http://127.0.0.1:54323 in your browser to access the Supabase Studio admin UI.

You can inspect:
- Tables and their schemas
- Run SQL queries
- View table data
- Test Edge Functions

## Next Steps

Now that your local Supabase environment is running with the complete schema:

1. **Create Edge Functions** - Implement the API endpoints for:
   - POST /transfers - P2P token transfers
   - GET /wallet - Wallet balance inquiry
   - GET /transactions - Transaction history

2. **Set up system account** - Create the initial system account via SQL:
   ```sql
   -- Will be documented in separate setup guide
   ```

3. **Write tests** - Unit and integration tests for Edge Functions

4. **Implement authentication** - JWT validation middleware

## Troubleshooting

### Docker not running

If you see "Cannot connect to Docker daemon":

```bash
sudo systemctl start docker
```

### Port conflicts

If ports 54321-54324 are already in use, you can modify ports in `apps/api/supabase/config.toml`.

### Permission issues

If you encounter permission errors with Docker:

```bash
sudo usermod -aG docker $USER
newgrp docker
```

### Postinstall script failed

If Supabase CLI binary was not downloaded:

```bash
cd node_modules/supabase
node scripts/postinstall.js
cd ../..
```

### Migration errors

If migrations fail to apply:

```bash
# Stop services
pnpm supabase stop --workdir /home/oji/work_dir/communitytoken/apps/api --no-backup

# Start fresh
pnpm supabase start --workdir /home/oji/work_dir/communitytoken/apps/api
```

## Useful Commands

### Supabase commands

Note: All commands require --workdir flag with absolute path

```bash
# Check status
pnpm supabase status --workdir /home/oji/work_dir/communitytoken/apps/api

# Stop all services
pnpm supabase stop --workdir /home/oji/work_dir/communitytoken/apps/api

# Stop without backup (faster, for development)
pnpm supabase stop --workdir /home/oji/work_dir/communitytoken/apps/api --no-backup

# Reset database (WARNING: destroys all data)
pnpm supabase db reset --workdir /home/oji/work_dir/communitytoken/apps/api

# View logs
pnpm supabase logs --workdir /home/oji/work_dir/communitytoken/apps/api

# Create new migration
pnpm supabase migration new <migration_name> --workdir /home/oji/work_dir/communitytoken/apps/api
```

### Database commands

```bash
# Access PostgreSQL directly
psql postgresql://postgres:postgres@127.0.0.1:54322/postgres

# Run SQL file
psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -f script.sql

# Execute single query
psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -c "SELECT * FROM users;"
```

### Workspace commands

```bash
# Run command in api workspace
pnpm api <command>

# Examples:
pnpm api exec pwd                    # Check working directory
pnpm api exec supabase status        # (Note: won't work, use root pnpm supabase with --workdir)
```

## Development Workflow

1. Start Supabase services:
   ```bash
   pnpm supabase start --workdir /home/oji/work_dir/communitytoken/apps/api
   ```

2. Develop Edge Functions in `apps/api/supabase/functions/`

3. Test locally using Supabase Studio or curl

4. When done, stop services:
   ```bash
   pnpm supabase stop --workdir /home/oji/work_dir/communitytoken/apps/api --no-backup
   ```

## References

- Supabase CLI Documentation: https://supabase.com/docs/reference/cli
- Edge Functions Guide: https://supabase.com/docs/guides/functions
- PostgreSQL Documentation: https://www.postgresql.org/docs/
