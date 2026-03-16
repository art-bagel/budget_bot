-- Migration 003: add scheduled_expenses table
-- bank_account_id is not stored: primary account for the category's owner
-- is resolved automatically at execution time by the scheduler.
DROP TABLE IF EXISTS budgeting.scheduled_expenses;
CREATE TABLE IF NOT EXISTS budgeting.scheduled_expenses (
    id                  bigserial       PRIMARY KEY,
    category_id         bigint          NOT NULL REFERENCES budgeting.categories(id),
    owner_type          varchar(20)     NOT NULL CHECK (owner_type IN ('user', 'family')),
    owner_user_id       bigint          REFERENCES budgeting.users(id),
    owner_family_id     bigint          REFERENCES budgeting.families(id) ON DELETE CASCADE,
    created_by_user_id  bigint          NOT NULL REFERENCES budgeting.users(id),
    amount              numeric(20, 8)  NOT NULL CHECK (amount > 0),
    currency_code       char(3)         NOT NULL REFERENCES budgeting.currencies(code),
    comment             text,
    frequency           varchar(10)     NOT NULL CHECK (frequency IN ('weekly', 'monthly')),
    day_of_week         smallint        CHECK (day_of_week BETWEEN 1 AND 7),
    day_of_month        smallint        CHECK (day_of_month BETWEEN 1 AND 31),
    next_run_at         date            NOT NULL,
    last_run_at         date,
    last_error          text,
    is_active           boolean         NOT NULL DEFAULT TRUE,
    created_at          timestamptz     NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_scheduled_expenses_owner CHECK (
        (owner_type = 'user'   AND owner_user_id   IS NOT NULL AND owner_family_id IS NULL)
        OR
        (owner_type = 'family' AND owner_user_id   IS NULL     AND owner_family_id IS NOT NULL)
    ),
    CONSTRAINT chk_scheduled_expenses_weekly  CHECK (frequency <> 'weekly'  OR day_of_week  IS NOT NULL),
    CONSTRAINT chk_scheduled_expenses_monthly CHECK (frequency <> 'monthly' OR day_of_month IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_scheduled_expenses_next_run
    ON budgeting.scheduled_expenses (next_run_at)
    WHERE is_active = TRUE;

CREATE INDEX IF NOT EXISTS idx_scheduled_expenses_category
    ON budgeting.scheduled_expenses (category_id);
