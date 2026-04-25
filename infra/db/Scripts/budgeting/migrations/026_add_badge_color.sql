ALTER TABLE budgeting.bank_accounts
    ADD COLUMN IF NOT EXISTS badge_color VARCHAR(8) DEFAULT NULL;
