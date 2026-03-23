-- Clean up legacy overloaded credit/transfer functions that remained on older DBs.
-- They cause ambiguous resolution for loan/mortgage creation.

DROP FUNCTION IF EXISTS budgeting.put__create_credit_account(
    bigint,
    text,
    text,
    char(3),
    numeric,
    text,
    numeric,
    smallint,
    date,
    date,
    text,
    text
);

DROP FUNCTION IF EXISTS budgeting.put__transfer_between_accounts(
    bigint,
    bigint,
    bigint,
    char(3),
    numeric,
    text
);
