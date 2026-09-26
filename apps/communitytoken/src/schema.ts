/**
 * The CommunityState SQLite schema: the primitive ledger — `principals`,
 * `accounts`, `transactions` — plus the application-owned state composed
 * around it — `default_accounts`, `administrative_issuer`,
 * `identity_bindings`, `idempotency_records`, and `registration_intents`.
 *
 * Primitive tables carry no product columns: a Principal has no kind, an
 * Account has no kind, role, default, reserve, or treasury flag. Product
 * designations live in their own narrow application tables.
 *
 * `accounts.owner_principal_id` references an existing Principal and is
 * immutable, as is the Account id; Accounts are never deleted. The
 * `UNIQUE (id, owner_principal_id)` key exists so `default_accounts` can
 * reference the (Account, owner) pair.
 *
 * `default_accounts` is the application's `Principal -> default Account`
 * designation: the `principal_id` primary key admits zero or one
 * designation per Principal; the composite foreign key
 * `(account_id, principal_id) -> accounts(id, owner_principal_id)` admits
 * only an Account owned by that same Principal; `account_id UNIQUE` keeps
 * one Account from being another Principal's default. Designations are
 * immutable — no re-designation transition is defined.
 *
 * `administrative_issuer` is the single-row mapping from the one
 * administrative technical authority to its stable issuer Principal
 * (authentication/delegation specification). The `singleton = 1` key
 * admits at most one row, and the row is immutable.
 *
 * `transactions` replaces the superseded operation + ledger pair with one
 * immutable record per primitive ISSUE or TRANSFER. The shape CHECK binds
 * kind to its references: an ISSUE carries an issuer Principal and no
 * source Account; a TRANSFER carries a source Account and no issuer. There
 * is no metadata, reason, or actor column. The table is append-only.
 *
 * Monetary columns enforce their domains at the DB boundary itself:
 * `typeof(...) = 'integer'` rejects fractional or non-numeric values and
 * the BETWEEN bounds fix `0 <= balance <= 2^53-1` and
 * `1 <= amount <= 2^53-1` (economic-state specification).
 *
 * `identity_bindings` maps each exact `(issuer, subject)` to one Principal
 * and is append-only (no unlink, disable, or reassignment). The
 * `(principal_id, issuer)` index serves the unique same-issuer
 * counterparty projection. `idempotency_records` is the durable replay
 * table keyed by `(technical_caller, idempotency_key)` and is append-only.
 *
 * `registration_intents` is the one-shot registration state of the
 * registration specification: the `expires_at = created_at + 600000` CHECK
 * pins the 600-second lifetime, `(status = 'consumed') = (consumed_at IS
 * NOT NULL)` binds the lifecycle to its terminal timestamp, the partial
 * unique index admits at most one status-active intent per identity, and
 * triggers make identity/proof columns immutable and admit only
 * `active -> consumed` and `active -> superseded`. There is deliberately
 * no DELETE trigger: the normative model permits future lazy deletion of
 * expired intents.
 */
export const SCHEMA = `
CREATE TABLE IF NOT EXISTS principals (
  id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL
);

CREATE TRIGGER IF NOT EXISTS principals_immutable_update
BEFORE UPDATE ON principals
BEGIN
  SELECT RAISE(ABORT, 'principals is append-only');
END;

CREATE TRIGGER IF NOT EXISTS principals_immutable_delete
BEFORE DELETE ON principals
BEGIN
  SELECT RAISE(ABORT, 'principals is append-only');
END;

CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  owner_principal_id TEXT NOT NULL REFERENCES principals(id),
  balance INTEGER NOT NULL DEFAULT 0
    CHECK (typeof(balance) = 'integer' AND balance BETWEEN 0 AND 9007199254740991),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (id, owner_principal_id)
);

CREATE TRIGGER IF NOT EXISTS accounts_identity_immutable
BEFORE UPDATE OF id, owner_principal_id, created_at ON accounts
BEGIN
  SELECT RAISE(ABORT, 'account identity is immutable');
END;

CREATE TRIGGER IF NOT EXISTS accounts_no_delete
BEFORE DELETE ON accounts
BEGIN
  SELECT RAISE(ABORT, 'accounts cannot be deleted');
END;

CREATE TABLE IF NOT EXISTS default_accounts (
  principal_id TEXT PRIMARY KEY REFERENCES principals(id),
  account_id TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (account_id, principal_id)
    REFERENCES accounts(id, owner_principal_id)
);

CREATE TRIGGER IF NOT EXISTS default_accounts_immutable_update
BEFORE UPDATE ON default_accounts
BEGIN
  SELECT RAISE(ABORT, 'default_accounts designations are immutable');
END;

CREATE TRIGGER IF NOT EXISTS default_accounts_immutable_delete
BEFORE DELETE ON default_accounts
BEGIN
  SELECT RAISE(ABORT, 'default_accounts designations are immutable');
END;

CREATE TABLE IF NOT EXISTS administrative_issuer (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  principal_id TEXT NOT NULL UNIQUE REFERENCES principals(id),
  created_at INTEGER NOT NULL
);

CREATE TRIGGER IF NOT EXISTS administrative_issuer_immutable_update
BEFORE UPDATE ON administrative_issuer
BEGIN
  SELECT RAISE(ABORT, 'administrative_issuer is immutable');
END;

CREATE TRIGGER IF NOT EXISTS administrative_issuer_immutable_delete
BEFORE DELETE ON administrative_issuer
BEGIN
  SELECT RAISE(ABORT, 'administrative_issuer is immutable');
END;

CREATE TABLE IF NOT EXISTS transactions (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('ISSUE', 'TRANSFER')),
  issuer_principal_id TEXT REFERENCES principals(id),
  source_account_id TEXT REFERENCES accounts(id),
  destination_account_id TEXT NOT NULL REFERENCES accounts(id),
  amount INTEGER NOT NULL
    CHECK (typeof(amount) = 'integer' AND amount BETWEEN 1 AND 9007199254740991),
  committed_at INTEGER NOT NULL,
  CHECK (
    (kind = 'ISSUE' AND issuer_principal_id IS NOT NULL AND source_account_id IS NULL)
    OR (kind = 'TRANSFER' AND source_account_id IS NOT NULL AND issuer_principal_id IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS transactions_by_source
  ON transactions(source_account_id);

CREATE INDEX IF NOT EXISTS transactions_by_destination
  ON transactions(destination_account_id);

CREATE TRIGGER IF NOT EXISTS transactions_immutable_update
BEFORE UPDATE ON transactions
BEGIN
  SELECT RAISE(ABORT, 'transactions is append-only');
END;

CREATE TRIGGER IF NOT EXISTS transactions_immutable_delete
BEFORE DELETE ON transactions
BEGIN
  SELECT RAISE(ABORT, 'transactions is append-only');
END;

CREATE TABLE IF NOT EXISTS identity_bindings (
  issuer TEXT NOT NULL,
  subject TEXT NOT NULL,
  principal_id TEXT NOT NULL REFERENCES principals(id),
  created_at INTEGER NOT NULL,
  UNIQUE (issuer, subject)
);

CREATE INDEX IF NOT EXISTS identity_bindings_by_principal
  ON identity_bindings(principal_id, issuer);

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
  technical_caller TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  fingerprint_version TEXT NOT NULL,
  request_fingerprint TEXT NOT NULL,
  stored_result TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (technical_caller, idempotency_key)
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
