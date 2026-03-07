-- Description:
--   Records an expense from the shared bank and books its historical cost to a budget category.
--   For non-base currency expenses the function consumes FX lots by FIFO and uses their
--   historical cost as the budget amount.
-- Parameters:
--   _user_id bigint - Operation owner.
--   _bank_account_id bigint - Bank account that funds the expense.
--   _category_id bigint - Budget category affected by the expense.
--   _amount numeric - Expense amount in the bank currency.
--   _currency_code char(3) - Currency of the expense.
--   _comment text - Optional comment.
-- Returns:
--   jsonb - Operation identifier and booked budget amount in base currency.
CREATE OR REPLACE FUNCTION budgeting.put__record_expense(
    _user_id bigint,
    _bank_account_id bigint,
    _category_id bigint,
    _amount numeric,
    _currency_code char(3),
    _comment text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
AS $function$
DECLARE
    _base_currency_code char(3);
    _category_kind text;
    _bank_balance numeric(20, 8);
    _category_balance numeric(20, 2);
    _operation_id bigint;
    _remaining_to_consume numeric(20, 8);
    _expense_cost_base numeric(20, 2) := 0;
    _lot_ids bigint[] := '{}';
    _lot_amounts numeric[] := '{}';
    _lot_costs numeric[] := '{}';
    _lot_idx integer;
    _consume_amount numeric(20, 8);
    _consume_cost numeric(20, 2);
    _lot record;
BEGIN
    SET search_path TO budgeting;

    IF _amount <= 0 THEN
        RAISE EXCEPTION 'Expense amount must be positive';
    END IF;

    SELECT base_currency_code
    INTO _base_currency_code
    FROM users
    WHERE id = _user_id;

    IF _base_currency_code IS NULL THEN
        RAISE EXCEPTION 'Unknown user id: %', _user_id;
    END IF;

    PERFORM 1
    FROM bank_accounts
    WHERE id = _bank_account_id
      AND user_id = _user_id
      AND is_active;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Unknown active bank account % for user %', _bank_account_id, _user_id;
    END IF;

    SELECT kind
    INTO _category_kind
    FROM categories
    WHERE id = _category_id
      AND user_id = _user_id
      AND is_active;

    IF _category_kind IS NULL THEN
        RAISE EXCEPTION 'Unknown active category %', _category_id;
    END IF;

    IF _category_kind <> 'regular' THEN
        RAISE EXCEPTION 'Expense category % must be of kind regular', _category_id;
    END IF;

    SELECT COALESCE(sum(amount), 0)
    INTO _bank_balance
    FROM bank_entries
    WHERE bank_account_id = _bank_account_id
      AND currency_code = _currency_code;

    IF _bank_balance < _amount THEN
        RAISE EXCEPTION 'Insufficient bank balance in currency %', _currency_code;
    END IF;

    IF _currency_code = _base_currency_code THEN
        _expense_cost_base := round(_amount, 2);
    ELSE
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

            _lot_ids := array_append(_lot_ids, _lot.id);
            _lot_amounts := array_append(_lot_amounts, _consume_amount);
            _lot_costs := array_append(_lot_costs, _consume_cost);
            _expense_cost_base := _expense_cost_base + _consume_cost;
            _remaining_to_consume := _remaining_to_consume - _consume_amount;
        END LOOP;

        IF _remaining_to_consume > 0 THEN
            RAISE EXCEPTION 'Insufficient FX lots in currency %', _currency_code;
        END IF;
    END IF;

    SELECT COALESCE(sum(amount), 0)
    INTO _category_balance
    FROM budget_entries
    WHERE category_id = _category_id
      AND currency_code = _base_currency_code;

    IF _category_balance < _expense_cost_base THEN
        RAISE EXCEPTION 'Insufficient budget in category %', _category_id;
    END IF;

    INSERT INTO operations (user_id, type, comment)
    VALUES (_user_id, 'expense', _comment)
    RETURNING id
    INTO _operation_id;

    INSERT INTO bank_entries (operation_id, bank_account_id, currency_code, amount)
    VALUES (_operation_id, _bank_account_id, _currency_code, -_amount);

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

    INSERT INTO budget_entries (operation_id, category_id, currency_code, amount)
    VALUES (_operation_id, _category_id, _base_currency_code, -_expense_cost_base);

    RETURN jsonb_build_object(
        'operation_id', _operation_id,
        'expense_cost_in_base', _expense_cost_base,
        'base_currency_code', _base_currency_code
    );
END
$function$;
