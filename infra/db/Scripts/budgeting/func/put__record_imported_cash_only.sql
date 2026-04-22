DROP FUNCTION IF EXISTS budgeting.put__record_imported_cash_only;
CREATE FUNCTION budgeting.put__record_imported_cash_only(
    _user_id bigint,
    _owner_type text,
    _owner_user_id bigint,
    _owner_family_id bigint,
    _linked_account_id bigint,
    _signed_amount numeric,
    _currency_code char(3),
    _external_id text,
    _import_source varchar(30),
    _comment text,
    _operation_type text,
    _operation_at timestamptz DEFAULT CURRENT_TIMESTAMP
)
RETURNS jsonb
LANGUAGE plpgsql
AS $function$
DECLARE
    _base_currency_code char(3);
    _normalized_currency char(3);
    _signed_cost_in_base numeric(20, 2);
    _operation_id bigint;
    _bank_balance numeric(20, 8);
    _remaining_to_consume numeric(20, 8);
    _consumed_cost_base numeric(20, 2) := 0;
    _lot_ids bigint[] := '{}';
    _lot_amounts numeric[] := '{}';
    _lot_costs numeric[] := '{}';
    _lot_idx integer;
    _consume_amount numeric(20, 8);
    _consume_cost numeric(20, 2);
    _lot record;
BEGIN
    SET search_path TO budgeting;

    _normalized_currency := upper(_currency_code);
    _base_currency_code := budgeting.get__owner_base_currency(_owner_type, _owner_user_id, _owner_family_id);
    _signed_cost_in_base := round(COALESCE(_signed_amount, 0), 2);

    IF _base_currency_code <> _normalized_currency THEN
        IF COALESCE(_signed_amount, 0) > 0 THEN
            _signed_cost_in_base := round(_signed_amount, 2);
        ELSIF COALESCE(_signed_amount, 0) < 0 THEN
            PERFORM 1
            FROM current_bank_balances
            WHERE bank_account_id = _linked_account_id
              AND currency_code = _normalized_currency
            FOR UPDATE;

            SELECT COALESCE(amount, 0)
            INTO _bank_balance
            FROM current_bank_balances
            WHERE bank_account_id = _linked_account_id
              AND currency_code = _normalized_currency;

            IF COALESCE(_bank_balance, 0) < abs(_signed_amount) THEN
                RAISE EXCEPTION
                    'Cannot record unmatched imported cash outflow of % %: insufficient balance on investment account',
                    abs(_signed_amount),
                    _normalized_currency;
            END IF;

            _remaining_to_consume := abs(_signed_amount);

            FOR _lot IN
                SELECT id, amount_remaining, cost_base_remaining
                FROM fx_lots
                WHERE bank_account_id = _linked_account_id
                  AND currency_code = _normalized_currency
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
                _consumed_cost_base := _consumed_cost_base + round(_remaining_to_consume, 2);
            END IF;

            _signed_cost_in_base := -_consumed_cost_base;
        END IF;
    END IF;

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
        _operation_type,
        _comment,
        COALESCE(_operation_at::date, CURRENT_DATE)
    )
    RETURNING id INTO _operation_id;

    INSERT INTO bank_entries (
        operation_id,
        bank_account_id,
        currency_code,
        amount,
        external_id,
        import_source
    )
    VALUES (
        _operation_id,
        _linked_account_id,
        _normalized_currency,
        COALESCE(_signed_amount, 0),
        _external_id,
        _import_source
    );

    PERFORM budgeting.put__apply_current_bank_delta(
        _linked_account_id,
        _normalized_currency,
        COALESCE(_signed_amount, 0),
        _signed_cost_in_base
    );

    IF _base_currency_code <> _normalized_currency THEN
        IF COALESCE(_signed_amount, 0) > 0 THEN
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
                _linked_account_id,
                _normalized_currency,
                _signed_amount,
                _signed_amount,
                round(_signed_cost_in_base / NULLIF(_signed_amount, 0), 8),
                _signed_cost_in_base,
                _signed_cost_in_base,
                _operation_id
            );
        ELSIF array_length(_lot_ids, 1) IS NOT NULL THEN
            FOR _lot_idx IN 1..array_length(_lot_ids, 1) LOOP
                UPDATE fx_lots
                SET amount_remaining = amount_remaining - _lot_amounts[_lot_idx],
                    cost_base_remaining = cost_base_remaining - _lot_costs[_lot_idx]
                WHERE id = _lot_ids[_lot_idx];

                INSERT INTO lot_consumptions (operation_id, lot_id, amount, cost_base)
                VALUES (_operation_id, _lot_ids[_lot_idx], _lot_amounts[_lot_idx], _lot_costs[_lot_idx]);
            END LOOP;
        END IF;
    END IF;

    RETURN jsonb_build_object(
        'operation_id', _operation_id,
        'amount_in_base', _signed_cost_in_base
    );
END
$function$;
