-- Widens stored quantities only; cannot recover already rounded historical data.
ALTER TABLE budgeting.portfolio_positions ALTER COLUMN quantity TYPE numeric(50,18);
ALTER TABLE budgeting.portfolio_events ALTER COLUMN quantity TYPE numeric(50,18);
ALTER TABLE budgeting.crypto_protocol_positions
    ALTER COLUMN quantity TYPE numeric(50,18),
    ALTER COLUMN current_quantity TYPE numeric(50,18);
ALTER TABLE budgeting.crypto_liability_events ALTER COLUMN quantity TYPE numeric(50,18);
