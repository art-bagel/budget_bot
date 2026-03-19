CREATE OR REPLACE FUNCTION budgeting.put__record_expense(
    _user_id         bigint,
    _bank_account_id bigint,
    _category_id     bigint,
    _amount          numeric,
    _currency_code   char(3),
    _comment         text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
AS $function$
DECLARE
    _base_currency_code       char(3);
    _category_kind            text;
    _bank_balance             numeric(20, 8);
    _bank_credit_limit        numeric(20, 2);
    _category_balance         numeric(20, 2);
    _operation_id             bigint;
    _remaining_to_consume     numeric(20, 8);
    _expense_cost_base        numeric(20, 2) := 0;
    _lot_ids                  bigint[]  := '{}';
    _lot_amounts              numeric[] := '{}';
    _lot_costs                numeric[] := '{}';
    _lot_idx                  integer;
    _consume_amount           numeric(20, 8);
    _consume_cost             numeric(20, 2);
    _lot                      record;
    _category_owner_type      text;
    _category_owner_user_id   bigint;
    _category_owner_family_id bigint;
    _bank_owner_type          text;
    _bank_owner_user_id       bigint;
    _bank_owner_family_id     bigint;
    _bank_account_kind        text;
BEGIN
    SET search_path TO budgeting;

    IF _amount <= 0 THEN
        RAISE EXCEPTION 'Expense amount must be positive';
    END IF;

    SELECT kind, owner_type, owner_user_id, owner_family_id
    INTO _category_kind, _category_owner_type, _category_owner_user_id, _category_owner_family_id
    FROM categories
    WHERE id = _category_id AND is_active;

    IF _category_kind IS NULL THEN
        RAISE EXCEPTION 'Unknown active category %', _category_id;
    END IF;

    IF NOT budgeting.has__owner_access(
        _user_id, _category_owner_type, _category_owner_user_id, _category_owner_family_id
    ) THEN
        RAISE EXCEPTION 'Access denied to category %', _category_id;
    END IF;

    IF _category_kind <> 'regular' THEN
        RAISE EXCEPTION 'Expense category % must be of kind regular', _category_id;
    END IF;

    SELECT owner_type, owner_user_id, owner_family_id, account_kind, credit_limit
    INTO _bank_owner_type, _bank_owner_user_id, _bank_owner_family_id, _bank_account_kind, _bank_credit_limit
    FROM bank_accounts
    WHERE id = _bank_account_id AND is_active;

    IF _bank_owner_type IS NULL THEN
        RAISE EXCEPTION 'Unknown active bank account %', _bank_account_id;
    END IF;

    IF NOT budgeting.has__owner_access(
        _user_id, _bank_owner_type, _bank_owner_user_id, _bank_owner_family_id
    ) THEN
        RAISE EXCEPTION 'Access denied to bank account %', _bank_account_id;
    END IF;

    IF _bank_account_kind NOT IN ('cash', 'credit') THEN
        RAISE EXCEPTION 'Expenses can only be recorded from cash or credit accounts';
    END IF;

    IF _category_owner_type <> _bank_owner_type
       OR COALESCE(_category_owner_user_id,   0) <> COALESCE(_bank_owner_user_id,   0)
       OR COALESCE(_category_owner_family_id, 0) <> COALESCE(_bank_owner_family_id, 0) THEN
        RAISE EXCEPTION 'Expense category and bank account must have the same owner';
    END IF;

    _base_currency_code := budgeting.get__owner_base_currency(
        _category_owner_type, _category_owner_user_id, _category_owner_family_id
    );

    -- Credit accounts only support base-currency expenses (no FX lot tracking for credit).
    IF _bank_account_kind = 'credit' AND _currency_code <> _base_currency_code THEN
        RAISE EXCEPTION 'Credit account expenses must be in base currency';
    END IF;

    -- Lock the balance row to prevent concurrent over-spend.
    PERFORM 1 FROM current_bank_balances
    WHERE bank_account_id = _bank_account_id AND currency_code = _currency_code
    FOR UPDATE;

    SELECT COALESCE(amount, 0) INTO _bank_balance
    FROM current_bank_balances
    WHERE bank_account_id = _bank_account_id AND currency_code = _currency_code;

    IF _bank_account_kind = 'credit' THEN
        -- Enforce credit limit: balance cannot drop below -credit_limit.
        IF _bank_credit_limit IS NOT NULL AND (_bank_balance - _amount) < -_bank_credit_limit THEN
            RAISE EXCEPTION 'Credit limit exceeded';
        END IF;
        _expense_cost_base := round(_amount, 2);
    ELSIF _currency_code = _base_currency_code THEN
        IF _bank_balance < _amount THEN
            RAISE EXCEPTION 'Сумма превышает остаток';
        END IF;
        _expense_cost_base := round(_amount, 2);
    ELSE
        IF _bank_balance < _amount THEN
            RAISE EXCEPTION 'Сумма превышает остаток';
        END IF;
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
    END IF;

    -- Lock the budget row to prevent concurrent over-spend.
    PERFORM 1 FROM current_budget_balances
    WHERE category_id = _category_id AND currency_code = _base_currency_code
    FOR UPDATE;

    SELECT COALESCE(amount, 0) INTO _category_balance
    FROM current_budget_balances
    WHERE category_id = _category_id AND currency_code = _base_currency_code;

    IF _category_balance < _expense_cost_base THEN
        RAISE EXCEPTION 'Сумма превышает остаток';
    END IF;

    INSERT INTO operations (actor_user_id, owner_type, owner_user_id, owner_family_id, type, comment)
    VALUES (_user_id, _category_owner_type, _category_owner_user_id, _category_owner_family_id, 'expense', _comment)
    RETURNING id INTO _operation_id;

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
    VALUES (_operation_id, _category_id, _base_currency_code, -_expense_cost_base);

    PERFORM budgeting.put__apply_current_bank_delta(
        _bank_account_id, _currency_code, -_amount, -_expense_cost_base
    );

    PERFORM budgeting.put__apply_current_budget_delta(
        _category_id, _base_currency_code, -_expense_cost_base
    );

    RETURN jsonb_build_object(
        'operation_id',         _operation_id,
        'expense_cost_in_base', _expense_cost_base,
        'base_currency_code',   _base_currency_code
    );
END
$function$;
