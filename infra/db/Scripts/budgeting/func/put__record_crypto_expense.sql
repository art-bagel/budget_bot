DROP FUNCTION IF EXISTS budgeting.put__record_crypto_expense;
CREATE FUNCTION budgeting.put__record_crypto_expense(
    _user_id bigint,
    _bank_account_id bigint,
    _category_id bigint,
    _crypto_asset_id bigint,
    _amount numeric,
    _comment text DEFAULT NULL,
    _operated_at date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
AS $function$
DECLARE
    _category_kind text;
    _category_owner_type text;
    _category_owner_user_id bigint;
    _category_owner_family_id bigint;
    _bank_owner_type text;
    _bank_owner_user_id bigint;
    _bank_owner_family_id bigint;
    _bank_account_kind text;
    _base_currency_code char(3);
    _crypto_balance numeric(30, 12);
    _remaining_to_consume numeric(30, 12);
    _expense_cost_base numeric(20, 2) := 0;
    _lot_ids bigint[] := '{}';
    _lot_amounts numeric[] := '{}';
    _lot_costs numeric[] := '{}';
    _lot_idx integer;
    _consume_amount numeric(30, 12);
    _consume_cost numeric(20, 2);
    _lot record;
    _operation_id bigint;
BEGIN
    SET search_path TO budgeting;

    IF _amount <= 0 THEN
        RAISE EXCEPTION 'Expense amount must be positive';
    END IF;
    _amount := round(_amount, 12);

    SELECT kind, owner_type, owner_user_id, owner_family_id
    INTO _category_kind, _category_owner_type, _category_owner_user_id, _category_owner_family_id
    FROM categories
    WHERE id = _category_id
      AND is_active;

    IF _category_kind IS NULL THEN
        RAISE EXCEPTION 'Unknown active category %', _category_id;
    END IF;

    IF _category_kind <> 'regular' THEN
        RAISE EXCEPTION 'Expense category % must be of kind regular', _category_id;
    END IF;

    SELECT owner_type, owner_user_id, owner_family_id, account_kind
    INTO _bank_owner_type, _bank_owner_user_id, _bank_owner_family_id, _bank_account_kind
    FROM bank_accounts
    WHERE id = _bank_account_id
      AND is_active;

    IF _bank_owner_type IS NULL THEN
        RAISE EXCEPTION 'Unknown active bank account %', _bank_account_id;
    END IF;

    IF _bank_account_kind <> 'cash' THEN
        RAISE EXCEPTION 'Crypto expenses can only be recorded from cash accounts';
    END IF;

    IF NOT budgeting.has__owner_access(_user_id, _category_owner_type, _category_owner_user_id, _category_owner_family_id)
       OR NOT budgeting.has__owner_access(_user_id, _bank_owner_type, _bank_owner_user_id, _bank_owner_family_id) THEN
        RAISE EXCEPTION 'Access denied';
    END IF;

    IF _category_owner_type <> _bank_owner_type
       OR COALESCE(_category_owner_user_id, 0) <> COALESCE(_bank_owner_user_id, 0)
       OR COALESCE(_category_owner_family_id, 0) <> COALESCE(_bank_owner_family_id, 0) THEN
        RAISE EXCEPTION 'Expense category and bank account must have the same owner';
    END IF;

    _base_currency_code := budgeting.get__owner_base_currency(
        _category_owner_type,
        _category_owner_user_id,
        _category_owner_family_id
    );

    PERFORM 1
    FROM current_crypto_balances
    WHERE bank_account_id = _bank_account_id
      AND crypto_asset_id = _crypto_asset_id
    FOR UPDATE;

    SELECT COALESCE(amount, 0)
    INTO _crypto_balance
    FROM current_crypto_balances
    WHERE bank_account_id = _bank_account_id
      AND crypto_asset_id = _crypto_asset_id;

    _crypto_balance := COALESCE(_crypto_balance, 0);
    IF _crypto_balance < _amount THEN
        RAISE EXCEPTION 'Сумма превышает остаток';
    END IF;

    _remaining_to_consume := _amount;
    FOR _lot IN
        SELECT id, amount_remaining, cost_base_remaining
        FROM crypto_lots
        WHERE bank_account_id = _bank_account_id
          AND crypto_asset_id = _crypto_asset_id
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

        _lot_ids := array_append(_lot_ids, _lot.id);
        _lot_amounts := array_append(_lot_amounts, _consume_amount);
        _lot_costs := array_append(_lot_costs, _consume_cost);
        _expense_cost_base := _expense_cost_base + _consume_cost;
        _remaining_to_consume := _remaining_to_consume - _consume_amount;
    END LOOP;

    IF _remaining_to_consume > 0 THEN
        RAISE EXCEPTION 'Сумма превышает остаток';
    END IF;

    PERFORM 1
    FROM current_budget_balances
    WHERE category_id = _category_id
      AND currency_code = _base_currency_code
    FOR UPDATE;

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
        _category_owner_type,
        _category_owner_user_id,
        _category_owner_family_id,
        'expense',
        _comment,
        COALESCE(_operated_at, current_date)
    )
    RETURNING id INTO _operation_id;

    INSERT INTO crypto_bank_entries (operation_id, bank_account_id, crypto_asset_id, amount)
    VALUES (_operation_id, _bank_account_id, _crypto_asset_id, -_amount);

    FOR _lot_idx IN 1..array_length(_lot_ids, 1) LOOP
        UPDATE crypto_lots
        SET amount_remaining = amount_remaining - _lot_amounts[_lot_idx],
            cost_base_remaining = cost_base_remaining - _lot_costs[_lot_idx]
        WHERE id = _lot_ids[_lot_idx];

        INSERT INTO crypto_lot_consumptions (operation_id, lot_id, amount, cost_base)
        VALUES (_operation_id, _lot_ids[_lot_idx], _lot_amounts[_lot_idx], _lot_costs[_lot_idx]);
    END LOOP;

    INSERT INTO budget_entries (operation_id, category_id, currency_code, amount)
    VALUES (_operation_id, _category_id, _base_currency_code, -_expense_cost_base);

    PERFORM budgeting.put__apply_current_crypto_delta(
        _bank_account_id,
        _crypto_asset_id,
        -_amount,
        -_expense_cost_base
    );

    PERFORM budgeting.put__apply_current_budget_delta(
        _category_id,
        _base_currency_code,
        -_expense_cost_base
    );

    RETURN jsonb_build_object(
        'operation_id', _operation_id,
        'expense_cost_in_base', _expense_cost_base,
        'base_currency_code', _base_currency_code
    );
END
$function$;
