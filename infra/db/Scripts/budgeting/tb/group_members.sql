CREATE SCHEMA IF NOT EXISTS budgeting;

CREATE TABLE IF NOT EXISTS budgeting.group_members (
    group_id bigint NOT NULL REFERENCES budgeting.categories(id) ON DELETE CASCADE,
    child_category_id bigint NOT NULL REFERENCES budgeting.categories(id) ON DELETE CASCADE,
    share numeric(7, 6) NOT NULL CHECK (share > 0 AND share <= 1),
    PRIMARY KEY (group_id, child_category_id),
    CONSTRAINT chk_group_members_not_self CHECK (group_id <> child_category_id)
);
