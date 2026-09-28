-- Preserve TON/EVM quantities at the banking/investment boundary.
ALTER TABLE budgeting.crypto_lots ALTER COLUMN amount_initial TYPE numeric(50,18);
ALTER TABLE budgeting.crypto_lots ALTER COLUMN amount_remaining TYPE numeric(50,18);
ALTER TABLE budgeting.crypto_lot_consumptions ALTER COLUMN amount TYPE numeric(50,18);
ALTER TABLE budgeting.crypto_bank_entries ALTER COLUMN amount TYPE numeric(50,18);
ALTER TABLE budgeting.current_crypto_balances ALTER COLUMN amount TYPE numeric(50,18);
