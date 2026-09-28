-- NULL means unknown historical cost, never a free acquisition.
ALTER TABLE budgeting.crypto_protocol_positions ALTER COLUMN cost_basis_in_base DROP NOT NULL;
ALTER TABLE budgeting.crypto_protocol_positions ALTER COLUMN cost_basis_in_base DROP DEFAULT;
ALTER TABLE budgeting.crypto_liability_events ALTER COLUMN debt_basis_change_in_base DROP NOT NULL;
ALTER TABLE budgeting.crypto_liability_events ALTER COLUMN interest_basis_change_in_base DROP NOT NULL;
-- The extra source parameter replaces the old overload.
DROP FUNCTION IF EXISTS budgeting.put__swap_crypto_investment_asset(bigint,bigint,numeric,bigint,numeric,bigint,text,date,numeric);
