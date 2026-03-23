CREATE SCHEMA IF NOT EXISTS budgeting;

CREATE TABLE IF NOT EXISTS budgeting.credit_payment_events (
    id bigserial PRIMARY KEY,
    operation_id bigint NOT NULL UNIQUE REFERENCES budgeting.operations(id) ON DELETE CASCADE,
    credit_account_id bigint NOT NULL REFERENCES budgeting.bank_accounts(id),
    currency_code char(3) NOT NULL REFERENCES budgeting.currencies(code),
    payment_amount numeric(20, 2) NOT NULL,
    payment_at timestamptz NOT NULL,
    accrual_from date NOT NULL,
    accrual_to date NOT NULL,
    annual_rate numeric(5, 2),
    principal_before numeric(20, 2) NOT NULL,
    interest_accrued numeric(20, 2) NOT NULL DEFAULT 0,
    principal_paid numeric(20, 2) NOT NULL DEFAULT 0,
    interest_paid numeric(20, 2) NOT NULL DEFAULT 0,
    principal_after numeric(20, 2) NOT NULL,
    created_by_user_id bigint REFERENCES budgeting.users(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT current_timestamp,
    CONSTRAINT chk_credit_payment_events_amounts CHECK (
        payment_amount >= 0
        AND principal_before >= 0
        AND interest_accrued >= 0
        AND principal_paid >= 0
        AND interest_paid >= 0
        AND principal_after >= 0
    ),
    CONSTRAINT chk_credit_payment_events_split CHECK (
        round(payment_amount, 2) = round(principal_paid + interest_paid, 2)
    ),
    CONSTRAINT chk_credit_payment_events_principal CHECK (
        round(principal_before - principal_paid, 2) = round(principal_after, 2)
    )
);

CREATE INDEX IF NOT EXISTS idx_credit_payment_events_credit_payment_at
    ON budgeting.credit_payment_events (credit_account_id, payment_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_credit_payment_events_credit_accrual_to
    ON budgeting.credit_payment_events (credit_account_id, accrual_to DESC, id DESC);
