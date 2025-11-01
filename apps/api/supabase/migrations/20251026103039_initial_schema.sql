-- Community Token System - Initial Schema Migration
-- Generated: 2025-10-26
-- Description: Creates all tables, triggers, functions, and views for the Community Token System

-- =============================================================================
-- TABLES
-- =============================================================================

-- Table 1: wallets (created first as it's referenced by users and system_accounts)
CREATE TABLE wallets (
    id UUID PRIMARY KEY,
    balance BIGINT NOT NULL DEFAULT 0,
    is_frozen BOOLEAN NOT NULL DEFAULT FALSE,
    created_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL,

    CONSTRAINT balance_non_negative CHECK (balance >= 0),
    CONSTRAINT created_at_positive CHECK (created_at > 0),
    CONSTRAINT updated_at_after_created CHECK (updated_at >= created_at)
);

COMMENT ON TABLE wallets IS 'Token wallets - conceptually independent entities referenced by users/system_accounts';
COMMENT ON COLUMN wallets.id IS 'Primary key (UUID v4)';
COMMENT ON COLUMN wallets.balance IS 'Current token balance (integer, no decimals)';
COMMENT ON COLUMN wallets.is_frozen IS 'Frozen wallets cannot send/receive tokens (system wallets cannot be frozen - enforced by trigger). Beyond MVP feature - included in schema from start for consistency';
COMMENT ON COLUMN wallets.created_at IS 'Unix timestamp in milliseconds';
COMMENT ON COLUMN wallets.updated_at IS 'Unix timestamp in milliseconds';

-- Auto-vacuum settings for high-update table
ALTER TABLE wallets SET (
    autovacuum_vacuum_scale_factor = 0.05,
    autovacuum_analyze_scale_factor = 0.02,
    autovacuum_vacuum_cost_limit = 1000
);

-- Table 2: users
CREATE TABLE users (
    id UUID PRIMARY KEY,
    wallet_id UUID NOT NULL UNIQUE,
    username VARCHAR(255) NOT NULL,
    created_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL,
    deleted_at BIGINT,

    CONSTRAINT username_not_empty CHECK (LENGTH(TRIM(username)) > 0),
    CONSTRAINT username_valid_chars CHECK (username ~ '^[a-zA-Z0-9_-]+$'),
    CONSTRAINT username_length CHECK (LENGTH(username) BETWEEN 3 AND 255),
    CONSTRAINT created_at_positive CHECK (created_at > 0),
    CONSTRAINT updated_at_after_created CHECK (updated_at >= created_at),
    CONSTRAINT deleted_at_after_created CHECK (deleted_at IS NULL OR deleted_at >= created_at),
    CONSTRAINT fk_wallet FOREIGN KEY (wallet_id)
        REFERENCES wallets(id) ON DELETE RESTRICT
);

CREATE INDEX idx_users_wallet_id ON users(wallet_id);
CREATE INDEX idx_users_deleted_at ON users(deleted_at) WHERE deleted_at IS NOT NULL;

COMMENT ON TABLE users IS 'Regular user identity (excludes system accounts for clean migration to external ID providers)';
COMMENT ON COLUMN users.id IS 'Primary key (UUID v4 for regular users)';
COMMENT ON COLUMN users.wallet_id IS 'Reference to owned wallet (one-to-one relationship)';
COMMENT ON COLUMN users.username IS 'Display name (3-255 chars, alphanumeric + underscore/hyphen, not unique - users identified by external OAuth ID)';
COMMENT ON COLUMN users.created_at IS 'Unix timestamp in milliseconds';
COMMENT ON COLUMN users.updated_at IS 'Unix timestamp in milliseconds';
COMMENT ON COLUMN users.deleted_at IS 'Soft delete Unix timestamp in milliseconds (NULL = active)';

-- Table 3: system_accounts
CREATE TABLE system_accounts (
    id UUID PRIMARY KEY,
    wallet_id UUID NOT NULL UNIQUE,
    name VARCHAR(255) NOT NULL UNIQUE,
    created_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL,

    CONSTRAINT name_not_empty CHECK (LENGTH(TRIM(name)) > 0),
    CONSTRAINT name_valid_chars CHECK (name ~ '^[a-z0-9_]+$'),
    CONSTRAINT name_length CHECK (LENGTH(name) BETWEEN 3 AND 255),
    CONSTRAINT created_at_positive CHECK (created_at > 0),
    CONSTRAINT updated_at_after_created CHECK (updated_at >= created_at),
    CONSTRAINT fk_wallet FOREIGN KEY (wallet_id)
        REFERENCES wallets(id) ON DELETE RESTRICT
);

CREATE INDEX idx_system_accounts_wallet_id ON system_accounts(wallet_id);

COMMENT ON TABLE system_accounts IS 'System accounts with token issuance authority (separated from users for migration flexibility)';
COMMENT ON COLUMN system_accounts.id IS 'Primary key (UUID v4)';
COMMENT ON COLUMN system_accounts.wallet_id IS 'Reference to owned wallet (one-to-one relationship)';
COMMENT ON COLUMN system_accounts.name IS 'Unique identifier (lowercase alphanumeric + underscore only, e.g., system_account_communitytoken)';
COMMENT ON COLUMN system_accounts.created_at IS 'Unix timestamp in milliseconds';
COMMENT ON COLUMN system_accounts.updated_at IS 'Unix timestamp in milliseconds';

-- Table 4: transactions
CREATE TABLE transactions (
    id UUID PRIMARY KEY,
    from_wallet_id UUID NOT NULL,
    to_wallet_id UUID NOT NULL,
    amount BIGINT NOT NULL,
    transaction_type INTEGER NOT NULL,
    created_at BIGINT NOT NULL,

    CONSTRAINT amount_positive CHECK (amount > 0),
    CONSTRAINT transaction_type_valid CHECK (transaction_type >= 1 AND transaction_type < 100),
    CONSTRAINT created_at_positive CHECK (created_at > 0),
    CONSTRAINT fk_from_wallet FOREIGN KEY (from_wallet_id)
        REFERENCES wallets(id) ON DELETE RESTRICT,
    CONSTRAINT fk_to_wallet FOREIGN KEY (to_wallet_id)
        REFERENCES wallets(id) ON DELETE RESTRICT
);

CREATE INDEX idx_transactions_created_at ON transactions(created_at DESC);
CREATE INDEX idx_transactions_transaction_type ON transactions(transaction_type, created_at DESC);
CREATE INDEX idx_transactions_self_transfer ON transactions(from_wallet_id, to_wallet_id)
    WHERE from_wallet_id = to_wallet_id;

COMMENT ON TABLE transactions IS 'All token transactions including issuance, distribution, and transfers (immutable)';
COMMENT ON COLUMN transactions.id IS 'Primary key (UUID v4)';
COMMENT ON COLUMN transactions.from_wallet_id IS 'Sender wallet ID';
COMMENT ON COLUMN transactions.to_wallet_id IS 'Recipient wallet ID';
COMMENT ON COLUMN transactions.amount IS 'Transfer amount in integer tokens (must be positive)';
COMMENT ON COLUMN transactions.transaction_type IS 'Transaction type code (1-99). Application layer defines constants: 1=transfer, others TBD';
COMMENT ON COLUMN transactions.created_at IS 'Unix timestamp in milliseconds';

-- Auto-vacuum settings for insert-only table
ALTER TABLE transactions SET (
    autovacuum_enabled = on,
    autovacuum_vacuum_insert_scale_factor = 0.1
);

-- =============================================================================
-- TRIGGER FUNCTIONS
-- =============================================================================

-- Automatic timestamp updates
CREATE OR REPLACE FUNCTION update_updated_at_unix()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Transaction immutability enforcement
CREATE OR REPLACE FUNCTION prevent_transaction_modification()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'Transactions are immutable and cannot be modified or deleted';
END;
$$ LANGUAGE plpgsql;

-- Balance validation with concurrency control
CREATE OR REPLACE FUNCTION validate_transaction_balance()
RETURNS TRIGGER AS $$
DECLARE
    sender_balance BIGINT;
    sender_frozen BOOLEAN;
    recipient_frozen BOOLEAN;
    is_system_wallet BOOLEAN;
    is_self_transfer BOOLEAN;
BEGIN
    -- Check if this is a self-transfer (new issuance)
    is_self_transfer := (NEW.from_wallet_id = NEW.to_wallet_id);

    -- Lock sender wallet row to prevent race conditions
    SELECT balance, is_frozen
    INTO sender_balance, sender_frozen
    FROM wallets
    WHERE id = NEW.from_wallet_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Sender wallet not found';
    END IF;

    -- Check if sender wallet is frozen (Beyond MVP feature)
    IF sender_frozen THEN
        RAISE EXCEPTION 'Sender wallet is frozen';
    END IF;

    -- New issuance: only system accounts can issue to themselves
    IF is_self_transfer THEN
        -- Check if wallet is owned by a system account (reverse lookup)
        SELECT EXISTS(
            SELECT 1 FROM system_accounts WHERE wallet_id = NEW.from_wallet_id
        ) INTO is_system_wallet;

        IF NOT is_system_wallet THEN
            RAISE EXCEPTION 'Only system account wallets can perform self-transfers (issuance)';
        END IF;
        -- No balance check for issuance
        RETURN NEW;
    END IF;

    -- Lock recipient wallet to check frozen status (Beyond MVP feature)
    SELECT is_frozen INTO recipient_frozen
    FROM wallets
    WHERE id = NEW.to_wallet_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Recipient wallet not found';
    END IF;

    -- Check if recipient wallet is frozen (Beyond MVP feature)
    IF recipient_frozen THEN
        RAISE EXCEPTION 'Recipient wallet is frozen';
    END IF;

    -- Regular transfer: check sufficient balance
    IF sender_balance < NEW.amount THEN
        RAISE EXCEPTION 'Insufficient balance: has %, needs %',
            sender_balance, NEW.amount;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION validate_transaction_balance() IS 'Validates transaction balance and prevents double-spending via row-level locking. Also checks frozen status for both sender and recipient wallets (Beyond MVP feature). Uses reverse lookup to verify system account ownership.';

-- Balance update after transaction
CREATE OR REPLACE FUNCTION update_wallet_balances()
RETURNS TRIGGER AS $$
DECLARE
    current_time_ms BIGINT;
BEGIN
    current_time_ms := (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT;

    -- Decrease sender balance (skip for self-transfers/issuance)
    IF NEW.from_wallet_id != NEW.to_wallet_id THEN
        UPDATE wallets
        SET balance = balance - NEW.amount,
            updated_at = current_time_ms
        WHERE id = NEW.from_wallet_id;
    END IF;

    -- Increase recipient balance
    UPDATE wallets
    SET balance = balance + NEW.amount,
        updated_at = current_time_ms
    WHERE id = NEW.to_wallet_id;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- System wallet protection (Beyond MVP feature)
CREATE OR REPLACE FUNCTION prevent_system_wallet_freeze()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.is_frozen = TRUE THEN
        -- Check if wallet is owned by a system account (reverse lookup)
        IF EXISTS (
            SELECT 1 FROM system_accounts
            WHERE wallet_id = NEW.id
        ) THEN
            RAISE EXCEPTION 'System wallets cannot be frozen';
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION prevent_system_wallet_freeze() IS 'Prevents freezing system wallets via reverse lookup to system_accounts table. Beyond MVP feature - included in schema from start for consistency';

-- =============================================================================
-- TRIGGERS
-- =============================================================================

-- Automatic timestamp updates
CREATE TRIGGER update_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_unix();

CREATE TRIGGER update_system_accounts_updated_at
    BEFORE UPDATE ON system_accounts
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_unix();

CREATE TRIGGER update_wallets_updated_at
    BEFORE UPDATE ON wallets
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_unix();

-- Transaction immutability
CREATE TRIGGER prevent_transaction_update
    BEFORE UPDATE ON transactions
    FOR EACH ROW EXECUTE FUNCTION prevent_transaction_modification();

CREATE TRIGGER prevent_transaction_delete
    BEFORE DELETE ON transactions
    FOR EACH ROW EXECUTE FUNCTION prevent_transaction_modification();

-- Transaction validation and balance updates
CREATE TRIGGER check_transaction_balance
    BEFORE INSERT ON transactions
    FOR EACH ROW EXECUTE FUNCTION validate_transaction_balance();

CREATE TRIGGER update_balances_after_transaction
    AFTER INSERT ON transactions
    FOR EACH ROW EXECUTE FUNCTION update_wallet_balances();

-- System wallet protection (Beyond MVP feature)
CREATE TRIGGER check_system_wallet_freeze
    BEFORE INSERT OR UPDATE OF is_frozen ON wallets
    FOR EACH ROW EXECUTE FUNCTION prevent_system_wallet_freeze();

-- =============================================================================
-- HELPER FUNCTIONS
-- =============================================================================

-- Unix timestamp conversion helpers
CREATE OR REPLACE FUNCTION unix_to_timestamp(unix_ms BIGINT)
RETURNS TIMESTAMP WITH TIME ZONE AS $$
BEGIN
    RETURN TO_TIMESTAMP(unix_ms / 1000.0);
END;
$$ LANGUAGE plpgsql IMMUTABLE;

CREATE OR REPLACE FUNCTION timestamp_to_unix(ts TIMESTAMP WITH TIME ZONE)
RETURNS BIGINT AS $$
BEGIN
    RETURN (EXTRACT(EPOCH FROM ts) * 1000)::BIGINT;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

CREATE OR REPLACE FUNCTION current_unix_ms()
RETURNS BIGINT AS $$
BEGIN
    RETURN (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT;
END;
$$ LANGUAGE plpgsql VOLATILE;

COMMENT ON FUNCTION unix_to_timestamp(BIGINT) IS 'Convert Unix timestamp (ms) to TIMESTAMPTZ for readability';
COMMENT ON FUNCTION timestamp_to_unix(TIMESTAMP WITH TIME ZONE) IS 'Convert TIMESTAMPTZ to Unix timestamp (ms)';
COMMENT ON FUNCTION current_unix_ms() IS 'Get current time as Unix timestamp (ms)';

-- Soft delete user function
CREATE OR REPLACE FUNCTION soft_delete_user(user_uuid UUID)
RETURNS BOOLEAN AS $$
DECLARE
    current_time_ms BIGINT;
BEGIN
    current_time_ms := (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT;

    UPDATE users
    SET deleted_at = current_time_ms,
        updated_at = current_time_ms
    WHERE id = user_uuid
      AND deleted_at IS NULL;

    RETURN FOUND;
END;
$$ LANGUAGE plpgsql;

-- Orphan wallet detection function
CREATE OR REPLACE FUNCTION check_orphan_wallets()
RETURNS TABLE(wallet_id UUID, balance BIGINT) AS $$
BEGIN
    RETURN QUERY
    SELECT w.id, w.balance
    FROM wallets w
    WHERE NOT EXISTS (SELECT 1 FROM users WHERE wallet_id = w.id)
      AND NOT EXISTS (SELECT 1 FROM system_accounts WHERE wallet_id = w.id);
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION check_orphan_wallets() IS 'Returns wallets not referenced by any user or system_account. Should return empty result in normal operation.';

-- =============================================================================
-- VIEWS
-- =============================================================================

-- Wallet ownership lookup view
CREATE VIEW wallet_owners AS
SELECT
    wallet_id,
    'user' as owner_type,
    id as owner_id,
    username as owner_name
FROM users
WHERE deleted_at IS NULL
UNION ALL
SELECT
    wallet_id,
    'system_account' as owner_type,
    id as owner_id,
    name as owner_name
FROM system_accounts;

COMMENT ON VIEW wallet_owners IS 'Unified view for reverse wallet ownership lookup. Combines users and system_accounts for simplified queries.';
