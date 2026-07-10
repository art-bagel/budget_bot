-- Contractual monthly payment for term credits (loan/mortgage) and
-- scheduled vs early classification of repayment events.
--
-- monthly_payment changes ONLY at explicit points: account creation,
-- early repayment with "reduce payment" option, or manual edit. Regular
-- (possibly partial) scheduled payments never touch it, so the payment
-- schedule stays stable.

ALTER TABLE budgeting.bank_accounts
    ADD COLUMN IF NOT EXISTS monthly_payment numeric(20, 2);

ALTER TABLE budgeting.bank_accounts
    DROP CONSTRAINT IF EXISTS chk_bank_accounts_monthly_payment;

ALTER TABLE budgeting.bank_accounts
    ADD CONSTRAINT chk_bank_accounts_monthly_payment CHECK (
        monthly_payment IS NULL
        OR (monthly_payment > 0 AND account_kind = 'credit' AND credit_kind IN ('loan', 'mortgage'))
    );

ALTER TABLE budgeting.credit_payment_events
    ADD COLUMN IF NOT EXISTS payment_kind text NOT NULL DEFAULT 'scheduled';

ALTER TABLE budgeting.credit_payment_events
    DROP CONSTRAINT IF EXISTS chk_credit_payment_events_kind;

ALTER TABLE budgeting.credit_payment_events
    ADD CONSTRAINT chk_credit_payment_events_kind CHECK (
        payment_kind IN ('scheduled', 'early')
    );

-- Backfill payment_kind: payments landing on the account's payment day
-- (capped to month length) are scheduled, everything else is early.
UPDATE budgeting.credit_payment_events cpe
SET payment_kind = 'early'
FROM budgeting.bank_accounts ba
WHERE ba.id = cpe.credit_account_id
  AND ba.payment_day IS NOT NULL
  AND extract(day FROM cpe.payment_at)::integer <> LEAST(
      ba.payment_day::integer,
      extract(day FROM (date_trunc('month', cpe.payment_at) + interval '1 month - 1 day'))::integer
  );

-- Backfill monthly_payment for existing loans/mortgages: the contractual
-- payment is the amount seen at least twice among full scheduled payments
-- (principal and interest both > 0) that was used most recently — the
-- annuity may have been recalculated over the loan's life, so recency
-- matters more than overall frequency.
UPDATE budgeting.bank_accounts ba
SET monthly_payment = sub.payment_amount
FROM (
    SELECT DISTINCT ON (cpe.credit_account_id)
        cpe.credit_account_id,
        cpe.payment_amount
    FROM budgeting.credit_payment_events cpe
    WHERE cpe.payment_kind = 'scheduled'
      AND cpe.principal_paid > 0
      AND cpe.interest_paid > 0
    GROUP BY cpe.credit_account_id, cpe.payment_amount
    HAVING COUNT(*) >= 2
    ORDER BY cpe.credit_account_id, MAX(cpe.payment_at) DESC
) sub
WHERE ba.id = sub.credit_account_id
  AND ba.account_kind = 'credit'
  AND ba.credit_kind IN ('loan', 'mortgage')
  AND ba.monthly_payment IS NULL;
