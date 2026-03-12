CREATE SCHEMA IF NOT EXISTS budgeting;

CREATE TABLE IF NOT EXISTS budgeting.family_members (
    family_id bigint NOT NULL REFERENCES budgeting.families(id) ON DELETE CASCADE,
    user_id bigint NOT NULL REFERENCES budgeting.users(id) ON DELETE CASCADE,
    role varchar(20) NOT NULL CHECK (role IN ('owner', 'member')),
    joined_at timestamptz NOT NULL DEFAULT current_timestamp,
    PRIMARY KEY (family_id, user_id),
    CONSTRAINT uq_family_members_user UNIQUE (user_id)
);
