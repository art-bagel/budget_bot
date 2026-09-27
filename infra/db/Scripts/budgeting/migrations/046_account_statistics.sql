ALTER TABLE budgeting.bank_accounts ADD COLUMN IF NOT EXISTS include_in_statistics boolean NOT NULL DEFAULT true;
\ir ../func/set__account_statistics.sql
\ir ../func/get__bank_accounts.sql
\ir ../func/get__portfolio_summary.sql
\ir ../func/get__portfolio_analytics.sql
