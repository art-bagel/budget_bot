CREATE SCHEMA IF NOT EXISTS budgeting;

CREATE TABLE IF NOT EXISTS budgeting.operations (
    id bigserial PRIMARY KEY,
    actor_user_id bigint REFERENCES budgeting.users(id) ON DELETE SET NULL,
    owner_type varchar(20) NOT NULL CHECK (owner_type IN ('user', 'family')),
    owner_user_id bigint REFERENCES budgeting.users(id),
    owner_family_id bigint REFERENCES budgeting.families(id) ON DELETE CASCADE,
    income_source_id bigint REFERENCES budgeting.income_sources(id),
    type varchar(30) NOT NULL CHECK (type IN ('income', 'allocate', 'group_allocate', 'exchange', 'expense', 'account_transfer', 'reversal')),
    reversal_of_operation_id bigint REFERENCES budgeting.operations(id),
    comment text,
    created_at timestamptz NOT NULL DEFAULT current_timestamp,
    CONSTRAINT chk_operations_owner CHECK (
        (owner_type = 'user' AND owner_user_id IS NOT NULL AND owner_family_id IS NULL)
        OR
        (owner_type = 'family' AND owner_user_id IS NULL AND owner_family_id IS NOT NULL)
    )
);

ALTER TABLE budgeting.operations
    DROP CONSTRAINT IF EXISTS operations_type_check;

ALTER TABLE budgeting.operations
    DROP CONSTRAINT IF EXISTS chk_operations_type;

ALTER TABLE budgeting.operations
    ADD CONSTRAINT chk_operations_type
    CHECK (type IN ('income', 'allocate', 'group_allocate', 'exchange', 'expense', 'account_transfer', 'reversal'));

CREATE INDEX IF NOT EXISTS idx_operations_actor_created_at_id
    ON budgeting.operations (actor_user_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_operations_user_owner_type_created_at_id
    ON budgeting.operations (owner_user_id, type, created_at DESC, id DESC)
    WHERE owner_type = 'user';

CREATE INDEX IF NOT EXISTS idx_operations_family_owner_type_created_at_id
    ON budgeting.operations (owner_family_id, type, created_at DESC, id DESC)
    WHERE owner_type = 'family';

CREATE INDEX IF NOT EXISTS idx_operations_reversal_of_operation_id
    ON budgeting.operations (reversal_of_operation_id);
