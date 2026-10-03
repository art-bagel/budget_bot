INSERT INTO budgeting.currencies (code, name, scale)
VALUES
    ('EGP', 'Egyptian Pound', 2),
    ('TRY', 'Turkish Lira', 2)
ON CONFLICT (code) DO NOTHING;
