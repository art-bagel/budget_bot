-- Description:
--   Exchanges one currency into another inside a bank account.
--   The function consumes existing FX lots when the sold currency is not the base currency,
--   creates a new lot when the bought currency is not the base currency and books realized
--   FX result into the system category when a foreign currency is sold back to the base currency.
-- Parameters:
--   _user_id bigint - Operation owner.
--   _bank_account_id bigint - Bank account used for the exchange.
--   _from_currency_code char(3) - Currency sold.
--   _from_amount numeric - Amount sold.
--   _to_currency_code char(3) - Currency bought.
--   _to_amount numeric - Amount bought.
--   _comment text - Optional comment.
-- Returns:
--   jsonb - Operation identifier, effective rate and realized FX result in base currency.
CREATE OR REPLACE FUNCTION budgeting.put__exchange_currency(
    _user_id bigint,
    _bank_account_id bigint,
    _from_currency_code char(3),
    _from_amount numeric,
    _to_currency_code char(3),
    _to_amount numeric,
    _comment text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
AS $function$
DECLARE
    _base_currency_code char(3);
    _fx_result_category_id bigint;
    _operation_id bigint;
    _bank_balance numeric(20, 8);
    _remaining_to_consume numeric(20, 8);
    _consumed_cost_base numeric(20, 2) := 0;
    _new_lot_cost_base numeric(20, 2);
    _realized_fx_result numeric(20, 2) := 0;
    _lot_ids bigint[] := '{}';
    _lot_amounts numeric[] := '{}';
    _lot_costs numeric[] := '{}';
    _lot_idx integer;
    _consume_amount numeric(20, 8);
    _consume_cost numeric(20, 2);
    _lot record;
BEGIN
    SET search_path TO budgeting;

    IF _from_currency_code = _to_currency_code THEN
        RAISE EXCEPTION 'Exchange currencies must be different';
    END IF;

    IF _from_amount <= 0 OR _to_amount <= 0 THEN
        RAISE EXCEPTION 'Exchange amounts must be positive';
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

    SELECT COALESCE(sum(amount), 0)
    INTO _bank_balance
    FROM bank_entries
    WHERE bank_account_id = _bank_account_id
      AND currency_code = _from_currency_code;

    IF _bank_balance < _from_amount THEN
        RAISE EXCEPTION 'Insufficient bank balance in currency %', _from_currency_code;
    END IF;

    IF _from_currency_code = _base_currency_code THEN
        _consumed_cost_base := round(_from_amount, 2);
    ELSE
        _remaining_to_consume := _from_amount;

        FOR _lot IN
            SELECT id, amount_remaining, cost_base_remaining
            FROM fx_lots
            WHERE bank_account_id = _bank_account_id
              AND currency_code = _from_currency_code
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
            _consumed_cost_base := _consumed_cost_base + _consume_cost;
            _remaining_to_consume := _remaining_to_consume - _consume_amount;
        END LOOP;

        IF _remaining_to_consume > 0 THEN
            RAISE EXCEPTION 'Insufficient FX lots in currency %', _from_currency_code;
        END IF;
    END IF;

    INSERT INTO operations (user_id, type, comment)
    VALUES (_user_id, 'exchange', _comment)
    RETURNING id
    INTO _operation_id;

    INSERT INTO bank_entries (operation_id, bank_account_id, currency_code, amount)
    VALUES
        (_operation_id, _bank_account_id, _from_currency_code, -_from_amount),
        (_operation_id, _bank_account_id, _to_currency_code, _to_amount);

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

    IF _to_currency_code <> _base_currency_code THEN
        IF _from_currency_code = _base_currency_code THEN
            _new_lot_cost_base := round(_from_amount, 2);
        ELSE
            _new_lot_cost_base := _consumed_cost_base;
        END IF;

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
            _bank_account_id,
            _to_currency_code,
            _to_amount,
            _to_amount,
            _new_lot_cost_base / _to_amount,
            _new_lot_cost_base,
            _new_lot_cost_base,
            _operation_id
        );
    ELSIF _from_currency_code <> _base_currency_code THEN
        SELECT id
        INTO _fx_result_category_id
        FROM categories
        WHERE user_id = _user_id
          AND name = 'FX Result'
          AND kind = 'system'
          AND is_active;

        IF _fx_result_category_id IS NULL THEN
            RAISE EXCEPTION 'System category FX Result is missing for user %', _user_id;
        END IF;

        _realized_fx_result := round(_to_amount, 2) - _consumed_cost_base;

        IF _realized_fx_result <> 0 THEN
            INSERT INTO budget_entries (operation_id, category_id, currency_code, amount)
            VALUES (_operation_id, _fx_result_category_id, _base_currency_code, _realized_fx_result);
        END IF;
    END IF;

    RETURN jsonb_build_object(
        'operation_id', _operation_id,
        'effective_rate', _from_amount / _to_amount,
        'realized_fx_result_in_base', _realized_fx_result,
        'base_currency_code', _base_currency_code
    );
END
$function$;
