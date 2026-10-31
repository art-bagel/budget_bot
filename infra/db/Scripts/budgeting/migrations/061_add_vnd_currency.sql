-- The dong has no minor units, so it is shown and entered without decimals.
INSERT INTO budgeting.currencies (code, name, scale)
VALUES ('VND', 'Vietnamese Dong', 0)
ON CONFLICT (code) DO NOTHING;
