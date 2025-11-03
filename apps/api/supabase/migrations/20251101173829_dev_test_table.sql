-- Verification table (temporary, will be dropped after validation)
CREATE TABLE dev_test_items (
    id UUID PRIMARY KEY,
    name TEXT NOT NULL,
    value INTEGER NOT NULL,
    created_at BIGINT NOT NULL,

    CONSTRAINT name_not_empty CHECK (LENGTH(TRIM(name)) > 0),
    CONSTRAINT value_non_negative CHECK (value >= 0),
    CONSTRAINT created_at_positive CHECK (created_at > 0)
);

COMMENT ON TABLE dev_test_items IS 'Temporary table for database operation verification. DELETE after validation complete.';
