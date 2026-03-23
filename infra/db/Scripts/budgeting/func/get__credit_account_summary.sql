CREATE OR REPLACE FUNCTION budgeting.get__credit_account_summary(
    _user_id bigint,
    _credit_account_id bigint,
    _as_of date DEFAULT CURRENT_DATE
)
RETURNS jsonb
LANGUAGE plpgsql
AS $function$
DECLARE
    _effective_as_of date := COALESCE(_as_of, CURRENT_DATE);
    _owner_type text;
    _owner_user_id bigint;
    _owner_family_id bigint;
    _account_kind text;
    _credit_kind text;
    _account_name text;
    _interest_rate numeric(5, 2);
    _payment_day smallint;
    _credit_started_at date;
    _credit_ends_at date;
    _credit_limit numeric(20, 2);
    _account_created_at date;
    _currency_code char(3);
    _raw_balance numeric(20, 8);
    _principal_outstanding numeric(20, 2) := 0;
    _last_accrual_date date;
    _last_payment_at timestamptz;
    _payments_count integer := 0;
    _paid_principal_total numeric(20, 2) := 0;
    _paid_interest_total numeric(20, 2) := 0;
    _days_since_accrual integer := 0;
    _accrued_interest numeric(20, 2) := 0;
BEGIN
    SET search_path TO budgeting;

    SELECT
        ba.owner_type,
        ba.owner_user_id,
        ba.owner_family_id,
        ba.account_kind,
        ba.credit_kind,
        ba.name,
        ba.interest_rate,
        ba.payment_day,
        ba.credit_started_at,
        ba.credit_ends_at,
        ba.credit_limit,
        ba.created_at::date
    INTO
        _owner_type,
        _owner_user_id,
        _owner_family_id,
        _account_kind,
        _credit_kind,
        _account_name,
        _interest_rate,
        _payment_day,
        _credit_started_at,
        _credit_ends_at,
        _credit_limit,
        _account_created_at
    FROM bank_accounts ba
    WHERE ba.id = _credit_account_id
      AND ba.is_active;

    IF _owner_type IS NULL THEN
        RAISE EXCEPTION 'Unknown active bank account %', _credit_account_id;
    END IF;

    IF NOT budgeting.has__owner_access(_user_id, _owner_type, _owner_user_id, _owner_family_id) THEN
        RAISE EXCEPTION 'Access denied to bank account %', _credit_account_id;
    END IF;

    IF _account_kind <> 'credit' THEN
        RAISE EXCEPTION 'Bank account % is not a credit account', _credit_account_id;
    END IF;

    SELECT currency_code, amount
    INTO _currency_code, _raw_balance
    FROM current_bank_balances
    WHERE bank_account_id = _credit_account_id
      AND amount <> 0
    ORDER BY abs(amount) DESC, currency_code
    LIMIT 1;

    IF _currency_code IS NULL THEN
        _currency_code := budgeting.get__owner_base_currency(_owner_type, _owner_user_id, _owner_family_id);
        _raw_balance := 0;
    END IF;

    _principal_outstanding := round(GREATEST(0, -COALESCE(_raw_balance, 0)), 2);

    SELECT
        MAX(accrual_to),
        MAX(payment_at),
        COUNT(*),
        COALESCE(SUM(principal_paid), 0),
        COALESCE(SUM(interest_paid), 0)
    INTO
        _last_accrual_date,
        _last_payment_at,
        _payments_count,
        _paid_principal_total,
        _paid_interest_total
    FROM credit_payment_events
    WHERE credit_account_id = _credit_account_id;

    _last_accrual_date := COALESCE(_last_accrual_date, _credit_started_at, _account_created_at, _effective_as_of);

    IF _effective_as_of < _last_accrual_date THEN
        _days_since_accrual := 0;
    ELSE
        _days_since_accrual := _effective_as_of - _last_accrual_date;
    END IF;

    IF COALESCE(_interest_rate, 0) > 0 AND _principal_outstanding > 0 THEN
        _accrued_interest := round(_principal_outstanding * _interest_rate * _days_since_accrual / 36500.0, 2);
    END IF;

    RETURN jsonb_build_object(
        'bank_account_id', _credit_account_id,
        'name', _account_name,
        'credit_kind', _credit_kind,
        'currency_code', _currency_code,
        'principal_outstanding', _principal_outstanding,
        'accrued_interest', _accrued_interest,
        'total_due_as_of', round(_principal_outstanding + _accrued_interest, 2),
        'annual_rate', _interest_rate,
        'payment_day', _payment_day,
        'credit_started_at', _credit_started_at,
        'credit_ends_at', _credit_ends_at,
        'credit_limit', _credit_limit,
        'last_accrual_date', _last_accrual_date,
        'last_payment_at', _last_payment_at,
        'payments_count', _payments_count,
        'paid_principal_total', round(_paid_principal_total, 2),
        'paid_interest_total', round(_paid_interest_total, 2),
        'as_of_date', _effective_as_of
    );
END
$function$;
