CREATE SCHEMA IF NOT EXISTS budgeting;

CREATE TABLE IF NOT EXISTS budgeting.categories (
    id bigserial PRIMARY KEY,
    owner_type varchar(20) NOT NULL CHECK (owner_type IN ('user', 'family')),
    owner_user_id bigint REFERENCES budgeting.users(id),
    owner_family_id bigint REFERENCES budgeting.families(id) ON DELETE CASCADE,
    name varchar(100) NOT NULL,
    kind varchar(20) NOT NULL CHECK (kind IN ('regular', 'group', 'system')),
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT current_timestamp,
    CONSTRAINT chk_categories_owner CHECK (
        (owner_type = 'user' AND owner_user_id IS NOT NULL AND owner_family_id IS NULL)
        OR
        (owner_type = 'family' AND owner_user_id IS NULL AND owner_family_id IS NOT NULL)
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_categories_user_name
    ON budgeting.categories (owner_user_id, name)
    WHERE owner_type = 'user';

CREATE UNIQUE INDEX IF NOT EXISTS uq_categories_family_name
    ON budgeting.categories (owner_family_id, name)
    WHERE owner_type = 'family';

CREATE INDEX IF NOT EXISTS idx_categories_user_active_id
    ON budgeting.categories (owner_user_id, is_active, id)
    WHERE owner_type = 'user';

CREATE INDEX IF NOT EXISTS idx_categories_user_kind_active_id
    ON budgeting.categories (owner_user_id, kind, is_active, id)
    WHERE owner_type = 'user';

CREATE INDEX IF NOT EXISTS idx_categories_family_active_id
    ON budgeting.categories (owner_family_id, is_active, id)
    WHERE owner_type = 'family';

CREATE INDEX IF NOT EXISTS idx_categories_family_kind_active_id
    ON budgeting.categories (owner_family_id, kind, is_active, id)
    WHERE owner_type = 'family';
