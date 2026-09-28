ALTER TABLE budgeting.bank_accounts ADD COLUMN IF NOT EXISTS is_archived boolean NOT NULL DEFAULT false;
ALTER TABLE budgeting.bank_accounts ADD COLUMN IF NOT EXISTS wallet_address varchar(256);
