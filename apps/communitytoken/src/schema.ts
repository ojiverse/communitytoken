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
 *
 * PR-3 adds `identity_bindings` — mapping each exact `(issuer, subject)`
 * external identity to one internal User — and `idempotency_records` — the
 * durable replay table keyed by `(service_principal, idempotency_key)` of
 * the idempotency specification. Both are storage-level append-only: an
 * IdentityBinding has no unlink/disable/reassignment transition and an
 * IdempotencyRecord has no expiry or deletion path in Phase 2, so UPDATE
 * and DELETE are rejected outright on both tables.
 *
 * PR-4 adds `registration_intents` — the one-shot registration
 * transaction state of the registration specification. The fixed
 * `expires_at = created_at + 600000` CHECK pins the exact 600-second
 * lifetime and `(status = 'consumed') = (consumed_at IS NOT NULL)` binds
 * the lifecycle status to its terminal timestamp. The partial unique
 * index `one_active_intent_per_identity` admits at most one status-active
 * intent per external identity while consumed and superseded rows coexist
 * freely. Triggers enforce the lifecycle at the storage floor: identity
 * and proof columns (`id`, expected issuer/subject, `state`, `nonce`,
 * `pkce_verifier`, creation time, expiry) are immutable, and the only
 * legal transitions are `active -> consumed` with a non-null
 * `consumed_at` and `active -> superseded` with a null `consumed_at` —
 * every transition out of a terminal status, every no-op `active ->
 * active` write, and every `consumed_at` rewrite after consumption is
 * rejected. There is deliberately no DELETE trigger: the normative model
 * permits future lazy deletion of expired intents even though PR-4
 * exposes no delete path.
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

CREATE TABLE IF NOT EXISTS identity_bindings (
  issuer TEXT NOT NULL,
  subject TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL,
  UNIQUE (issuer, subject)
);

CREATE TRIGGER IF NOT EXISTS identity_bindings_immutable_update
BEFORE UPDATE ON identity_bindings
BEGIN
  SELECT RAISE(ABORT, 'identity_bindings is append-only');
END;

CREATE TRIGGER IF NOT EXISTS identity_bindings_immutable_delete
BEFORE DELETE ON identity_bindings
BEGIN
  SELECT RAISE(ABORT, 'identity_bindings is append-only');
END;

CREATE TABLE IF NOT EXISTS idempotency_records (
  service_principal TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  fingerprint_version TEXT NOT NULL,
  request_fingerprint TEXT NOT NULL,
  stored_result TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (service_principal, idempotency_key)
);

CREATE TRIGGER IF NOT EXISTS idempotency_records_immutable_update
BEFORE UPDATE ON idempotency_records
BEGIN
  SELECT RAISE(ABORT, 'idempotency_records is append-only');
END;

CREATE TRIGGER IF NOT EXISTS idempotency_records_immutable_delete
BEFORE DELETE ON idempotency_records
BEGIN
  SELECT RAISE(ABORT, 'idempotency_records is append-only');
END;

CREATE TABLE IF NOT EXISTS registration_intents (
  id TEXT PRIMARY KEY,
  expected_issuer TEXT NOT NULL,
  expected_subject TEXT NOT NULL,
  state TEXT NOT NULL UNIQUE,
  nonce TEXT NOT NULL,
  pkce_verifier TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('active','consumed','superseded')),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER,
  CHECK (expires_at = created_at + 600000),
  CHECK ((status = 'consumed') = (consumed_at IS NOT NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS one_active_intent_per_identity
  ON registration_intents(expected_issuer, expected_subject)
  WHERE status = 'active';

CREATE TRIGGER IF NOT EXISTS registration_intents_immutable_identity
BEFORE UPDATE OF id, expected_issuer, expected_subject, state, nonce,
  pkce_verifier, created_at, expires_at ON registration_intents
BEGIN
  SELECT RAISE(ABORT, 'registration intent identity is immutable');
END;

CREATE TRIGGER IF NOT EXISTS registration_intents_lifecycle
BEFORE UPDATE OF status, consumed_at ON registration_intents
BEGIN
  SELECT RAISE(ABORT, 'illegal registration intent lifecycle transition')
  WHERE NOT (
    OLD.status = 'active' AND (
      (NEW.status = 'consumed' AND NEW.consumed_at IS NOT NULL)
      OR (NEW.status = 'superseded' AND NEW.consumed_at IS NULL)
    )
  );
END;
`;
