CREATE OR REPLACE FUNCTION budgeting.put__repay_credit_account(
    _user_id bigint,
    _from_account_id bigint,
    _credit_account_id bigint,
    _currency_code char(3),
    _amount numeric,
    _comment text DEFAULT NULL,
    _payment_at timestamptz DEFAULT CURRENT_TIMESTAMP
)
RETURNS jsonb
LANGUAGE plpgsql
AS $function$
DECLARE
    _from_owner_type text;
    _from_owner_user_id bigint;
    _from_owner_family_id bigint;
    _from_account_kind text;
    _from_credit_limit numeric(20, 2);
    _credit_owner_type text;
    _credit_owner_user_id bigint;
    _credit_owner_family_id bigint;
    _credit_account_kind text;
    _credit_kind text;
    _credit_name text;
    _credit_interest_rate numeric(5, 2);
    _credit_started_at date;
    _credit_created_at date;
    _source_unallocated_id bigint;
    _base_currency_code char(3);
    _bank_balance numeric(20, 8);
    _cost_base numeric(20, 2) := 0;
    _principal_cost_base numeric(20, 2) := 0;
    _remaining numeric(20, 8);
    _lot_ids bigint[] := '{}';
    _lot_amounts numeric[] := '{}';
    _lot_costs numeric[] := '{}';
    _lot_idx integer;
    _consume_amount numeric(20, 8);
    _consume_cost numeric(20, 2);
    _lot record;
    _credit_currency_code char(3);
    _credit_balance numeric(20, 8);
    _principal_before numeric(20, 2);
    _last_accrual_date date;
    _payment_date date;
    _days_since_accrual integer;
    _interest_accrued numeric(20, 2);
    _interest_paid numeric(20, 2);
    _principal_paid numeric(20, 2);
    _principal_after numeric(20, 2);
    _operation_id bigint;
BEGIN
    SET search_path TO budgeting;

    IF _amount IS NULL OR _amount <= 0 THEN
        RAISE EXCEPTION 'Transfer amount must be positive';
    END IF;

    IF _from_account_id = _credit_account_id THEN
        RAISE EXCEPTION 'Source and target accounts must be different';
    END IF;

    _payment_date := COALESCE(_payment_at::date, CURRENT_DATE);

    SELECT owner_type, owner_user_id, owner_family_id, account_kind, credit_limit
    INTO _from_owner_type, _from_owner_user_id, _from_owner_family_id, _from_account_kind, _from_credit_limit
    FROM bank_accounts
    WHERE id = _from_account_id AND is_active;

    IF _from_owner_type IS NULL THEN
        RAISE EXCEPTION 'Unknown active bank account %', _from_account_id;
    END IF;

    IF NOT budgeting.has__owner_access(_user_id, _from_owner_type, _from_owner_user_id, _from_owner_family_id) THEN
        RAISE EXCEPTION 'Access denied to source bank account %', _from_account_id;
    END IF;

    IF _from_account_kind <> 'cash' THEN
        RAISE EXCEPTION 'Credit repayment is supported only from cash accounts';
    END IF;

    SELECT
        owner_type,
        owner_user_id,
        owner_family_id,
        account_kind,
        credit_kind,
        name,
        interest_rate,
        credit_started_at,
        created_at::date
    INTO
        _credit_owner_type,
        _credit_owner_user_id,
        _credit_owner_family_id,
        _credit_account_kind,
        _credit_kind,
        _credit_name,
        _credit_interest_rate,
        _credit_started_at,
        _credit_created_at
    FROM bank_accounts
    WHERE id = _credit_account_id AND is_active;

    IF _credit_owner_type IS NULL THEN
        RAISE EXCEPTION 'Unknown active bank account %', _credit_account_id;
    END IF;

    IF NOT budgeting.has__owner_access(_user_id, _credit_owner_type, _credit_owner_user_id, _credit_owner_family_id) THEN
        RAISE EXCEPTION 'Access denied to target bank account %', _credit_account_id;
    END IF;

    IF _credit_account_kind <> 'credit' THEN
        RAISE EXCEPTION 'Target bank account % is not a credit account', _credit_account_id;
    END IF;

    IF _credit_kind NOT IN ('loan', 'mortgage') THEN
        RAISE EXCEPTION 'Use a regular account transfer to repay credit cards';
    END IF;

    _base_currency_code := budgeting.get__owner_base_currency(
        _from_owner_type, _from_owner_user_id, _from_owner_family_id
    );

    _source_unallocated_id := budgeting.get__owner_system_category_id(
        _from_owner_type, _from_owner_user_id, _from_owner_family_id, 'Unallocated'
    );
    IF _source_unallocated_id IS NULL THEN
        RAISE EXCEPTION 'Unallocated category missing for source account %', _from_account_id;
    END IF;

    PERFORM 1
    FROM current_bank_balances
    WHERE bank_account_id = _from_account_id
      AND currency_code = _currency_code
    FOR UPDATE;

    SELECT COALESCE((
        SELECT amount
        FROM current_bank_balances
        WHERE bank_account_id = _from_account_id
          AND currency_code = _currency_code
    ), 0)
    INTO _bank_balance;

    IF _bank_balance < _amount THEN
        RAISE EXCEPTION 'Сумма превышает остаток';
    END IF;

    IF _currency_code = _base_currency_code THEN
        _cost_base := round(_amount, 2);
    ELSE
        _remaining := _amount;

        FOR _lot IN
            SELECT id, amount_remaining, cost_base_remaining
            FROM fx_lots
            WHERE bank_account_id = _from_account_id
              AND currency_code = _currency_code
              AND amount_remaining > 0
            ORDER BY created_at, id
        LOOP
            EXIT WHEN _remaining <= 0;

            _consume_amount := LEAST(_remaining, _lot.amount_remaining);
            IF _consume_amount = _lot.amount_remaining THEN
                _consume_cost := _lot.cost_base_remaining;
            ELSE
                _consume_cost := round(_lot.cost_base_remaining * _consume_amount / _lot.amount_remaining, 2);
            END IF;

            _lot_ids := array_append(_lot_ids, _lot.id);
            _lot_amounts := array_append(_lot_amounts, _consume_amount);
            _lot_costs := array_append(_lot_costs, _consume_cost);
            _cost_base := _cost_base + _consume_cost;
            _remaining := _remaining - _consume_amount;
        END LOOP;

        IF _remaining > 0 THEN
            RAISE EXCEPTION 'Сумма превышает остаток';
        END IF;
    END IF;

    SELECT currency_code, amount
    INTO _credit_currency_code, _credit_balance
    FROM current_bank_balances
    WHERE bank_account_id = _credit_account_id
      AND amount <> 0
    ORDER BY abs(amount) DESC, currency_code
    LIMIT 1;

    IF _credit_currency_code IS NULL THEN
        _credit_currency_code := _currency_code;
        _credit_balance := 0;
    END IF;

    IF _credit_currency_code <> _currency_code THEN
        RAISE EXCEPTION 'Currency mismatch for credit repayment. Expected %, got %', _credit_currency_code, _currency_code;
    END IF;

    _principal_before := round(GREATEST(0, -COALESCE(_credit_balance, 0)), 2);

    SELECT COALESCE(MAX(accrual_to), _credit_started_at, _credit_created_at, _payment_date)
    INTO _last_accrual_date
    FROM credit_payment_events
    WHERE credit_account_id = _credit_account_id;

    IF _payment_date < _last_accrual_date THEN
        RAISE EXCEPTION 'Payment date cannot be earlier than the last repayment date';
    END IF;

    _days_since_accrual := _payment_date - _last_accrual_date;
    _interest_accrued := CASE
        WHEN COALESCE(_credit_interest_rate, 0) > 0 AND _principal_before > 0
            THEN round(_principal_before * _credit_interest_rate * _days_since_accrual / 36500.0, 2)
        ELSE 0
    END;

    IF round(_principal_before + _interest_accrued, 2) <= 0 THEN
        RAISE EXCEPTION 'Credit account is already fully repaid';
    END IF;

    IF round(_amount, 2) > round(_principal_before + _interest_accrued, 2) THEN
        RAISE EXCEPTION 'Payment exceeds current total due';
    END IF;

    _interest_paid := LEAST(round(_amount, 2), _interest_accrued);
    _principal_paid := round(_amount, 2) - _interest_paid;
    _principal_after := round(_principal_before - _principal_paid, 2);

    IF _principal_after < 0 THEN
        RAISE EXCEPTION 'Payment exceeds current principal balance';
    END IF;

    IF round(_amount, 2) = 0 THEN
        RAISE EXCEPTION 'Payment amount must be positive';
    END IF;

    _principal_cost_base := CASE
        WHEN _principal_paid <= 0 THEN 0
        WHEN round(_amount, 2) = 0 THEN 0
        ELSE round(_cost_base * _principal_paid / round(_amount, 2), 2)
    END;

    INSERT INTO operations (
        actor_user_id,
        owner_type,
        owner_user_id,
        owner_family_id,
        type,
        comment,
        created_at
    )
    VALUES (
        _user_id,
        _from_owner_type,
        _from_owner_user_id,
        _from_owner_family_id,
        'account_transfer',
        COALESCE(NULLIF(btrim(_comment), ''), 'Платёж по кредиту · ' || _credit_name),
        COALESCE(_payment_at, CURRENT_TIMESTAMP)
    )
    RETURNING id INTO _operation_id;

    INSERT INTO bank_entries (operation_id, bank_account_id, currency_code, amount)
    VALUES (_operation_id, _from_account_id, _currency_code, -_amount);

    IF _principal_paid > 0 THEN
        INSERT INTO bank_entries (operation_id, bank_account_id, currency_code, amount)
        VALUES (_operation_id, _credit_account_id, _currency_code, _principal_paid);
    END IF;

    INSERT INTO budget_entries (operation_id, category_id, currency_code, amount)
    VALUES (_operation_id, _source_unallocated_id, _base_currency_code, -_cost_base);

    PERFORM budgeting.put__apply_current_bank_delta(
        _from_account_id,
        _currency_code,
        -_amount,
        -_cost_base
    );

    IF _principal_paid > 0 THEN
        PERFORM budgeting.put__apply_current_bank_delta(
            _credit_account_id,
            _currency_code,
            _principal_paid,
            _principal_cost_base
        );
    END IF;

    PERFORM budgeting.put__apply_current_budget_delta(
        _source_unallocated_id,
        _base_currency_code,
        -_cost_base
    );

    IF _currency_code <> _base_currency_code THEN
        IF array_length(_lot_ids, 1) IS NOT NULL THEN
            FOR _lot_idx IN 1..array_length(_lot_ids, 1) LOOP
                UPDATE fx_lots
                SET amount_remaining = amount_remaining - _lot_amounts[_lot_idx],
                    cost_base_remaining = cost_base_remaining - _lot_costs[_lot_idx]
                WHERE id = _lot_ids[_lot_idx];

                INSERT INTO lot_consumptions (operation_id, lot_id, amount, cost_base)
                VALUES (_operation_id, _lot_ids[_lot_idx], _lot_amounts[_lot_idx], _lot_costs[_lot_idx]);
            END LOOP;
        END IF;

        IF _principal_paid > 0 THEN
            INSERT INTO fx_lots (
                bank_account_id,
                currency_code,
                amount_initial,
                amount_remaining,
                buy_rate_in_base,
                cost_base_initial,
                cost_base_remaining,
                opened_by_operation_id
            )
            VALUES (
                _credit_account_id,
                _currency_code,
                _principal_paid,
                _principal_paid,
                _principal_cost_base / _principal_paid,
                _principal_cost_base,
                _principal_cost_base,
                _operation_id
            );
        END IF;
    END IF;

    INSERT INTO credit_payment_events (
        operation_id,
        credit_account_id,
        currency_code,
        payment_amount,
        payment_at,
        accrual_from,
        accrual_to,
        annual_rate,
        principal_before,
        interest_accrued,
        principal_paid,
        interest_paid,
        principal_after,
        created_by_user_id
    )
    VALUES (
        _operation_id,
        _credit_account_id,
        _currency_code,
        round(_amount, 2),
        COALESCE(_payment_at, CURRENT_TIMESTAMP),
        _last_accrual_date,
        _payment_date,
        _credit_interest_rate,
        _principal_before,
        _interest_accrued,
        _principal_paid,
        _interest_paid,
        _principal_after,
        _user_id
    );

    RETURN jsonb_build_object(
        'operation_id', _operation_id,
        'payment_amount', round(_amount, 2),
        'principal_paid', _principal_paid,
        'interest_paid', _interest_paid,
        'principal_before', _principal_before,
        'principal_after', _principal_after,
        'accrued_interest', _interest_accrued,
        'amount_in_base', _cost_base,
        'base_currency_code', _base_currency_code
    );
END
$function$;
