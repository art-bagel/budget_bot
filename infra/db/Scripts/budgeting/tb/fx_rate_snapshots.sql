CREATE SCHEMA IF NOT EXISTS budgeting;

CREATE TABLE IF NOT EXISTS budgeting.fx_rate_snapshots (
    id bigserial PRIMARY KEY,
    base_currency_code char(3) NOT NULL REFERENCES budgeting.currencies(code),
    quote_currency_code char(3) NOT NULL REFERENCES budgeting.currencies(code),
    rate numeric(20, 8) NOT NULL CHECK (rate > 0),
    fetched_at timestamptz NOT NULL,
    source text,
    CONSTRAINT uq_fx_rate_pair_time UNIQUE (base_currency_code, quote_currency_code, fetched_at)
);
