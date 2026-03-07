CREATE SCHEMA IF NOT EXISTS budgeting;

CREATE TABLE IF NOT EXISTS budgeting.currencies (
    code char(3) PRIMARY KEY,
    name text NOT NULL,
    scale smallint NOT NULL DEFAULT 2 CHECK (scale >= 0)
);

INSERT INTO budgeting.currencies (code, name, scale)
VALUES
    ('RUB', 'Russian Ruble', 2),
    ('USD', 'US Dollar', 2),
    ('EUR', 'Euro', 2),
    ('CNY', 'Chinese Yuan', 2),
    ('KZT', 'Kazakhstani Tenge', 2),
    ('TRY', 'Turkish Lira', 2)
ON CONFLICT (code) DO NOTHING;
