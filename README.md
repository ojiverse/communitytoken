# Community Token Platform for ojiverse

A simple, transfer-centric community token system designed for ojiverse.

## Overview

Community Token is an economic platform where all activities are modeled as wallet-to-wallet transfers. The system automatically issues new tokens when needed, maintains transaction immutability through database triggers, and provides a clear audit trail of all economic activities.

**Key Characteristics**:
- Transfer-centric architecture: All transactions are wallet transfers
- Automatic token issuance: System auto-issues tokens during distribution
- 1:1 User-Wallet relationship: Each user has exactly one wallet
- Database-enforced immutability: Transactions cannot be modified or deleted
- OAuth-based authentication: External identity provider integration

## Features

### MVP (Minimum Viable Product)

- **Token Issuance & Distribution**: System account can issue and distribute tokens to users
- **P2P Transfers**: Users can transfer tokens to each other
- **Balance Inquiry**: Real-time wallet balance and transaction history
- **Transaction History**: Complete audit trail of all transfers with immutability guarantees
- **OAuth Authentication**: JWT-based authentication with external identity providers
- **Type-safe API**: OpenAPI specification with automatic validation

### Beyond MVP

- **Wallet Freezing**: Ability to freeze user wallets for security or compliance
- **Advanced Analytics**: Economic metrics and supply tracking
- **Batch Operations**: Efficient bulk token distribution

For detailed feature specifications, see [docs/features.md](./docs/features.md).

## Tech Stack

- **Runtime**: Deno (via Supabase Edge Functions)
- **Framework**: Hono with Zod OpenAPI for type-safe APIs
- **Database**: PostgreSQL 15+ (hosted on Supabase)
- **Authentication**: Supabase Auth with OAuth provider support
- **Validation**: Zod for schema validation and type inference
- **Logging**: Structured logging with console output
- **Infrastructure**: Supabase (Database + Auth + Edge Functions)

### Technology Decisions

All technology choices are documented in [docs/tech.md](./docs/tech.md) with rationale and evaluation status.

## Quick Start

### Prerequisites

- Supabase CLI installed
- Deno runtime (comes with Supabase CLI)
- pnpm installed

### Local Development

1. **Clone the repository**:
   ```bash
   git clone <repository-url>
   cd communitytoken
   ```

2. **Start Supabase local stack** (optional, for database access):
   ```bash
   pnpm supabase:start
   ```

3. **Start API server**:
   ```bash
   pnpm supabase:serve
   ```

4. **Test the API**:
   ```bash
   curl http://localhost:54321/functions/v1/api/health
   ```

For detailed setup instructions, see [apps/api/getting-started.md](./apps/api/getting-started.md).

### Project Structure

```
communitytoken/
|-- apps/
|   `-- api/              # API implementation (Deno + Hono)
|       |-- src/          # Application source code
|       |-- supabase/     # Supabase configuration and migrations
|       `-- deno.json     # Deno configuration and import map
|-- docs/                 # Design and technical documentation
|   |-- design.md         # System design and architecture
|   |-- features.md       # Feature specifications
|   |-- tech.md           # Technology stack decisions
|   `-- database.md       # Database schema and implementation
`-- README.md             # This file
```

## Infrastructure

### Database Schema

The database uses a transfer-centric design with four core tables:

- **wallets**: Balance tracking with row-level locking for concurrency
- **users**: User accounts linked 1:1 with wallets
- **system_accounts**: Special accounts with token issuance authority
- **transactions**: Immutable transaction records with automatic validation

**Key Features**:
- UUID-based identifiers (application-generated, not database-generated)
- Database triggers for balance validation and transaction immutability
- Atomic operations with row-level locking (FOR UPDATE)
- Automatic token issuance detection via self-transfers

For complete schema details, see [docs/database.md](./docs/database.md).

### Deployment

**Local Development**:
- Supabase CLI with Docker-based local stack
- Hot reload enabled for Edge Functions
- Local PostgreSQL on port 54322

**Production** (Planned):

TBD

## Documentation

- [Design Document](./docs/design.md) - System architecture and transaction semantics
- [Features](./docs/features.md) - Feature specifications and use cases
- [Technology Stack](./docs/tech.md) - Technology decisions and rationale
- [Database Design](./docs/database.md) - Schema design and implementation
- [Getting Started](./apps/api/getting-started.md) - Local development setup

## LICENSE

MIT License, see [./LICENSE](./LICENSE)