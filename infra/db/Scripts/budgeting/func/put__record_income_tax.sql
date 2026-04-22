DROP FUNCTION IF EXISTS budgeting.put__record_income_tax(bigint, bigint, numeric, character, numeric, numeric, timestamptz);
DROP FUNCTION IF EXISTS budgeting.put__record_income_tax(bigint, bigint, numeric, character, numeric, numeric, timestamptz, bigint);
DROP FUNCTION IF EXISTS budgeting.put__record_income_tax(bigint, bigint, numeric, character, numeric, numeric, date);
DROP FUNCTION IF EXISTS budgeting.put__record_income_tax(bigint, bigint, numeric, character, numeric, numeric, date, bigint);
CREATE FUNCTION budgeting.put__record_income_tax(
    _user_id             bigint,
    _bank_account_id     bigint,
    _amount              numeric,
    _currency_code       char(3),
    _tax_cost_in_base    numeric,
    _tax_percent         numeric,
    _operated_at         date DEFAULT NULL,
    _income_source_id    bigint DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
AS $function$
DECLARE
    _operation_id                  bigint;
    _owner_type                    text;
    _owner_user_id                 bigint;
    _owner_family_id               bigint;
    _account_kind                  text;
    _base_currency_code            char(3);
    _unallocated_category_id       bigint;
    _bank_balance                  numeric(20, 8);
    _budget_balance                numeric(20, 2);
    _effective_tax_cost_in_base    numeric(20, 2);
    _remaining_to_consume          numeric(20, 8);
    _expense_cost_base             numeric(20, 2) := 0;
    _lot_ids                       bigint[]  := '{}';
    _lot_amounts                   numeric[] := '{}';
    _lot_costs                     numeric[] := '{}';
    _lot_idx                       integer;
    _consume_amount                numeric(20, 8);
    _consume_cost                  numeric(20, 2);
    _lot                           record;
    _tax_percent_label             text;
    _income_source_name            text;
    _tax_comment                   text;
BEGIN
    SET search_path TO budgeting;

    IF _amount <= 0 THEN
        RAISE EXCEPTION 'Income tax amount must be positive';
    END IF;

    IF _tax_percent IS NULL OR _tax_percent <= 0 OR _tax_percent >= 100 THEN
        RAISE EXCEPTION 'Tax percent must be greater than 0 and less than 100';
    END IF;

    SELECT owner_type, owner_user_id, owner_family_id, account_kind
    INTO _owner_type, _owner_user_id, _owner_family_id, _account_kind
    FROM bank_accounts
    WHERE id = _bank_account_id
      AND is_active;

    IF _owner_type IS NULL THEN
        RAISE EXCEPTION 'Unknown active bank account %', _bank_account_id;
    END IF;

    IF NOT budgeting.has__owner_access(_user_id, _owner_type, _owner_user_id, _owner_family_id) THEN
        RAISE EXCEPTION 'Access denied to bank account %', _bank_account_id;
    END IF;

    IF _account_kind <> 'cash' THEN
        RAISE EXCEPTION 'Income tax can only be recorded on cash accounts';
    END IF;

    _base_currency_code := budgeting.get__owner_base_currency(_owner_type, _owner_user_id, _owner_family_id);

    IF _base_currency_code IS NULL THEN
        RAISE EXCEPTION 'Base currency is missing for bank account owner %', _bank_account_id;
    END IF;

    _unallocated_category_id := budgeting.get__owner_system_category_id(
        _owner_type,
        _owner_user_id,
        _owner_family_id,
        'Unallocated'
    );

    IF _unallocated_category_id IS NULL THEN
        RAISE EXCEPTION 'System category Unallocated is missing for bank account owner %', _bank_account_id;
    END IF;

    IF _currency_code = _base_currency_code THEN
        _effective_tax_cost_in_base := round(_amount, 2);
    ELSE
        IF _tax_cost_in_base IS NULL OR _tax_cost_in_base <= 0 THEN
            RAISE EXCEPTION 'Historical base amount is required for non-base currency income tax';
        END IF;

        _effective_tax_cost_in_base := round(_tax_cost_in_base, 2);
    END IF;

    PERFORM 1
    FROM current_bank_balances
    WHERE bank_account_id = _bank_account_id
      AND currency_code = _currency_code
    FOR UPDATE;

    SELECT COALESCE(amount, 0)
    INTO _bank_balance
    FROM current_bank_balances
    WHERE bank_account_id = _bank_account_id
      AND currency_code = _currency_code;

    _bank_balance := COALESCE(_bank_balance, 0);

    IF _bank_balance < _amount THEN
        RAISE EXCEPTION 'Сумма превышает остаток';
    END IF;

    IF _currency_code <> _base_currency_code THEN
        _remaining_to_consume := _amount;

        FOR _lot IN
            SELECT id, amount_remaining, cost_base_remaining
            FROM fx_lots
            WHERE bank_account_id = _bank_account_id
              AND currency_code = _currency_code
              AND amount_remaining > 0
            ORDER BY created_at, id
        LOOP
            EXIT WHEN _remaining_to_consume <= 0;

            _consume_amount := LEAST(_remaining_to_consume, _lot.amount_remaining);
            IF _consume_amount = _lot.amount_remaining THEN
                _consume_cost := _lot.cost_base_remaining;
            ELSE
                _consume_cost := round(_lot.cost_base_remaining * _consume_amount / _lot.amount_remaining, 2);
            END IF;

            _lot_ids     := array_append(_lot_ids,     _lot.id);
            _lot_amounts := array_append(_lot_amounts, _consume_amount);
            _lot_costs   := array_append(_lot_costs,   _consume_cost);
            _expense_cost_base    := _expense_cost_base + _consume_cost;
            _remaining_to_consume := _remaining_to_consume - _consume_amount;
        END LOOP;

        IF _remaining_to_consume > 0 THEN
            RAISE EXCEPTION 'Сумма превышает остаток';
        END IF;
    ELSE
        _expense_cost_base := _effective_tax_cost_in_base;
    END IF;

    PERFORM 1
    FROM current_budget_balances
    WHERE category_id = _unallocated_category_id
      AND currency_code = _base_currency_code
    FOR UPDATE;

    SELECT COALESCE(amount, 0)
    INTO _budget_balance
    FROM current_budget_balances
    WHERE category_id = _unallocated_category_id
      AND currency_code = _base_currency_code;

    _budget_balance := COALESCE(_budget_balance, 0);

    IF _budget_balance < _expense_cost_base THEN
        RAISE EXCEPTION 'Сумма превышает остаток';
    END IF;

    _tax_percent_label := to_char(_tax_percent, 'FM999999990.########');
    IF _income_source_id IS NOT NULL THEN
        SELECT name
        INTO _income_source_name
        FROM income_sources
        WHERE id = _income_source_id
          AND user_id = _user_id
          AND is_active;
    END IF;

    _tax_comment := 'Налог на доход '
        || CASE WHEN _income_source_name IS NOT NULL THEN _income_source_name || ' ' ELSE '' END
        || _tax_percent_label || '%';

    INSERT INTO operations (
        actor_user_id,
        owner_type,
        owner_user_id,
        owner_family_id,
        type,
        comment,
        operated_on
    )
    VALUES (
        _user_id,
        _owner_type,
        _owner_user_id,
        _owner_family_id,
        'expense',
        _tax_comment,
        COALESCE(_operated_at::date, current_date)
    )
    RETURNING id
    INTO _operation_id;

    INSERT INTO bank_entries (operation_id, bank_account_id, currency_code, amount)
    VALUES (_operation_id, _bank_account_id, _currency_code, -_amount);

    IF array_length(_lot_ids, 1) IS NOT NULL THEN
        FOR _lot_idx IN 1..array_length(_lot_ids, 1) LOOP
            UPDATE fx_lots
            SET amount_remaining    = amount_remaining    - _lot_amounts[_lot_idx],
                cost_base_remaining = cost_base_remaining - _lot_costs[_lot_idx]
            WHERE id = _lot_ids[_lot_idx];

            INSERT INTO lot_consumptions (operation_id, lot_id, amount, cost_base)
            VALUES (_operation_id, _lot_ids[_lot_idx], _lot_amounts[_lot_idx], _lot_costs[_lot_idx]);
        END LOOP;
    END IF;

    INSERT INTO budget_entries (operation_id, category_id, currency_code, amount)
    VALUES (_operation_id, _unallocated_category_id, _base_currency_code, -_expense_cost_base);

    PERFORM budgeting.put__apply_current_bank_delta(
        _bank_account_id,
        _currency_code,
        -_amount,
        -_expense_cost_base
    );

    PERFORM budgeting.put__apply_current_budget_delta(
        _unallocated_category_id,
        _base_currency_code,
        -_expense_cost_base
    );

    RETURN jsonb_build_object(
        'operation_id',         _operation_id,
        'expense_cost_in_base', _expense_cost_base,
        'base_currency_code',   _base_currency_code
    );
END
$function$;
