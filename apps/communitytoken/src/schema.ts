/**
 * The CommunityState SQLite schema (issue #4 PR-2 persistence): `users`,
 * `wallets`, `economic_operations`, `ledger_transactions`, plus the
 * append-only enforcement triggers.
 *
 * `economic_operations.kind` is created with all five Phase 2 literals —
 * including `DAILY_REWARD` — because SQLite cannot widen a CHECK without a
 * table rebuild. This is a storage floor only; it does not enable Daily
 * Reward semantics before their feature lands.
 *
 * `wallets` carries the kind/owner correlation CHECK: a `system` wallet has
 * no owner, a `user` wallet always has exactly one — the structural
 * constraint the persistence specification requires at the storage floor.
 * The treasury identity is fixed bidirectionally — `kind = 'system'` iff
 * `id = 'treasury'` — and a partial unique index admits at most one system
 * wallet per deployment.
 *
 * Monetary columns enforce their domains at the DB boundary itself, not
 * only in application code: `typeof(...) = 'integer'` rejects fractional
 * or non-numeric values and the BETWEEN bounds fix the
 * `0 <= balance <= 2^53-1` WalletBalance and `1 <= amount <= 2^53-1`
 * TokenAmount domains of the economic-state specification.
 *
 * `economic_operations` and `ledger_transactions` are bound by reciprocal
 * `DEFERRABLE INITIALLY DEFERRED` foreign keys: under the current model an
 * EconomicOperation and its LedgerTransaction are exactly 1:1, so neither
 * side may exist alone at commit — an orphan operation or an orphan ledger
 * fails when its transaction commits, and `operation_id`'s UNIQUE keeps the
 * pairing one-to-one.
 *
 * The treasury row is a permanent structural row: `treasury_no_delete` and
 * `treasury_identity_immutable` triggers make its `id` / `kind` /
 * `owner_user_id` immutable and the row itself undeletable, while
 * `balance` / `updated_at` stay mutable — the deployment's exactly-one
 * treasury holds for the whole object lifetime, not just at bootstrap.
 *
 * Both history tables are append-only as a hard storage-level constraint,
 * not application convention.
 */
export const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS wallets (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('system', 'user')),
  owner_user_id TEXT UNIQUE REFERENCES users(id),
  balance INTEGER NOT NULL DEFAULT 0
    CHECK (typeof(balance) = 'integer' AND balance BETWEEN 0 AND 9007199254740991),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK ((kind = 'system') = (owner_user_id IS NULL)),
  CHECK ((kind = 'system') = (id = 'treasury'))
);

CREATE UNIQUE INDEX IF NOT EXISTS one_system_wallet
  ON wallets(kind) WHERE kind = 'system';

CREATE TRIGGER IF NOT EXISTS treasury_no_delete
BEFORE DELETE ON wallets
WHEN OLD.id = 'treasury'
BEGIN
  SELECT RAISE(ABORT, 'treasury wallet cannot be deleted');
END;

CREATE TRIGGER IF NOT EXISTS treasury_identity_immutable
BEFORE UPDATE OF id, kind, owner_user_id ON wallets
WHEN OLD.id = 'treasury'
BEGIN
  SELECT RAISE(ABORT, 'treasury wallet identity is immutable');
END;

CREATE TABLE IF NOT EXISTS economic_operations (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN (
    'TOKEN_ISSUANCE', 'DISTRIBUTION', 'P2P_TRANSFER', 'TREASURY_PAYMENT',
    'DAILY_REWARD'
  )),
  metadata TEXT,
  actor_kind TEXT NOT NULL CHECK (actor_kind IN ('user', 'service', 'system')),
  actor_id TEXT,
  created_at INTEGER NOT NULL,
  CHECK (
    (actor_kind IN ('user', 'service') AND actor_id IS NOT NULL)
    OR (actor_kind = 'system' AND actor_id IS NULL)
  ),
  FOREIGN KEY (id) REFERENCES ledger_transactions(operation_id)
    DEFERRABLE INITIALLY DEFERRED
);

CREATE TABLE IF NOT EXISTS ledger_transactions (
  id TEXT PRIMARY KEY,
  operation_id TEXT NOT NULL UNIQUE,
  from_wallet_id TEXT NOT NULL REFERENCES wallets(id),
  to_wallet_id TEXT NOT NULL REFERENCES wallets(id),
  amount INTEGER NOT NULL
    CHECK (typeof(amount) = 'integer' AND amount BETWEEN 1 AND 9007199254740991),
  created_at INTEGER NOT NULL,
  FOREIGN KEY (operation_id) REFERENCES economic_operations(id)
    DEFERRABLE INITIALLY DEFERRED
);

CREATE TRIGGER IF NOT EXISTS economic_operations_immutable_update
BEFORE UPDATE ON economic_operations
BEGIN
  SELECT RAISE(ABORT, 'economic_operations is append-only');
END;

CREATE TRIGGER IF NOT EXISTS economic_operations_immutable_delete
BEFORE DELETE ON economic_operations
BEGIN
  SELECT RAISE(ABORT, 'economic_operations is append-only');
END;

CREATE TRIGGER IF NOT EXISTS ledger_immutable_update
BEFORE UPDATE ON ledger_transactions
BEGIN
  SELECT RAISE(ABORT, 'ledger_transactions is append-only');
END;

CREATE TRIGGER IF NOT EXISTS ledger_immutable_delete
BEFORE DELETE ON ledger_transactions
BEGIN
  SELECT RAISE(ABORT, 'ledger_transactions is append-only');
END;
`;
