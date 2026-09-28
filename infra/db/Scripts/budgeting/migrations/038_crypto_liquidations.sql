-- Extend the debt ledger without creating fictitious spot-wallet movements.
ALTER TABLE budgeting.crypto_liability_events
    ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;
DO $$
DECLARE c record;
BEGIN
    FOR c IN SELECT conname FROM pg_constraint
        WHERE conrelid='budgeting.crypto_liability_events'::regclass
          AND contype='c' AND pg_get_constraintdef(oid) LIKE '%event_kind%'
    LOOP
        EXECUTE format('ALTER TABLE budgeting.crypto_liability_events DROP CONSTRAINT %I', c.conname);
    END LOOP;
END $$;
ALTER TABLE budgeting.crypto_liability_events
    ADD CONSTRAINT crypto_liability_kind CHECK (event_kind IN
        ('borrow','principal_repayment','interest_accrual','repayment','liquidation')),
    ADD CONSTRAINT crypto_liability_direction CHECK (
        (event_kind IN ('borrow','interest_accrual') AND quantity>0 AND debt_basis_change_in_base>=0)
        OR (event_kind IN ('principal_repayment','repayment','liquidation') AND quantity<0 AND debt_basis_change_in_base<=0)),
    ADD CONSTRAINT crypto_liability_link CHECK (
        (event_kind IN ('interest_accrual','liquidation') AND external_id IS NOT NULL AND portfolio_event_id IS NULL)
        OR (event_kind NOT IN ('interest_accrual','liquidation') AND portfolio_event_id IS NOT NULL));
