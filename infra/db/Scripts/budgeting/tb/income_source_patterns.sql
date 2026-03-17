CREATE TABLE IF NOT EXISTS budgeting.income_source_patterns (
    id                  bigserial   PRIMARY KEY,
    income_source_id    bigint      NOT NULL UNIQUE REFERENCES budgeting.income_sources(id) ON DELETE CASCADE,
    created_by_user_id  bigint      NOT NULL REFERENCES budgeting.users(id),
    created_at          timestamptz NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS budgeting.income_source_pattern_lines (
    id              bigserial       PRIMARY KEY,
    pattern_id      bigint          NOT NULL REFERENCES budgeting.income_source_patterns(id) ON DELETE CASCADE,
    bank_account_id bigint          NOT NULL REFERENCES budgeting.bank_accounts(id),
    share           numeric(6, 5)   NOT NULL CHECK (share > 0 AND share <= 1)
);
