DROP FUNCTION IF EXISTS budgeting.put__sell_crypto_asset;
CREATE FUNCTION budgeting.put__sell_crypto_asset(
    _user_id bigint,
    _bank_account_id bigint,
    _crypto_asset_id bigint,
    _crypto_amount numeric,
    _fiat_currency_code char(3),
    _fiat_amount numeric,
    _comment text DEFAULT NULL,
    _operated_at date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
AS $function$
DECLARE
    _owner_type text;
    _owner_user_id bigint;
    _owner_family_id bigint;
    _account_kind text;
    _base_currency_code char(3);
    _crypto_balance numeric(30, 12);
    _remaining_to_consume numeric(30, 12);
    _consumed_cost_base numeric(20, 2) := 0;
    _realized_result numeric(20, 2) := 0;
    _fx_result_category_id bigint;
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

    IF _crypto_amount <= 0 OR _fiat_amount <= 0 THEN
        RAISE EXCEPTION 'Amounts must be positive';
    END IF;
    _crypto_amount := round(_crypto_amount, 12);

    SELECT owner_type, owner_user_id, owner_family_id, account_kind
    INTO _owner_type, _owner_user_id, _owner_family_id, _account_kind
    FROM bank_accounts
    WHERE id = _bank_account_id
      AND is_active;

    IF _owner_type IS NULL THEN
        RAISE EXCEPTION 'Unknown active bank account %', _bank_account_id;
    END IF;

    IF _account_kind <> 'cash' THEN
        RAISE EXCEPTION 'Banking crypto is only supported for cash accounts';
    END IF;

    IF NOT budgeting.has__owner_access(_user_id, _owner_type, _owner_user_id, _owner_family_id) THEN
        RAISE EXCEPTION 'Access denied to bank account %', _bank_account_id;
    END IF;

    _base_currency_code := budgeting.get__owner_base_currency(_owner_type, _owner_user_id, _owner_family_id);

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
    IF _crypto_balance < _crypto_amount THEN
        RAISE EXCEPTION 'Сумма превышает остаток';
    END IF;

    _remaining_to_consume := _crypto_amount;
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
        _consumed_cost_base := _consumed_cost_base + _consume_cost;
        _remaining_to_consume := _remaining_to_consume - _consume_amount;
    END LOOP;

    IF _remaining_to_consume > 0 THEN
        RAISE EXCEPTION 'Сумма превышает остаток';
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
        'exchange',
        _comment,
        COALESCE(_operated_at, current_date)
    )
    RETURNING id INTO _operation_id;

    INSERT INTO crypto_bank_entries (operation_id, bank_account_id, crypto_asset_id, amount)
    VALUES (_operation_id, _bank_account_id, _crypto_asset_id, -_crypto_amount);

    INSERT INTO bank_entries (operation_id, bank_account_id, currency_code, amount)
    VALUES (_operation_id, _bank_account_id, _fiat_currency_code, _fiat_amount);

    FOR _lot_idx IN 1..array_length(_lot_ids, 1) LOOP
        UPDATE crypto_lots
        SET amount_remaining = amount_remaining - _lot_amounts[_lot_idx],
            cost_base_remaining = cost_base_remaining - _lot_costs[_lot_idx]
        WHERE id = _lot_ids[_lot_idx];

        INSERT INTO crypto_lot_consumptions (operation_id, lot_id, amount, cost_base)
        VALUES (_operation_id, _lot_ids[_lot_idx], _lot_amounts[_lot_idx], _lot_costs[_lot_idx]);
    END LOOP;

    IF _fiat_currency_code <> _base_currency_code THEN
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
            _fiat_currency_code,
            _fiat_amount,
            _fiat_amount,
            _consumed_cost_base / _fiat_amount,
            _consumed_cost_base,
            _consumed_cost_base,
            _operation_id
        );
    ELSE
        _realized_result := round(_fiat_amount, 2) - _consumed_cost_base;
        IF _realized_result <> 0 THEN
            _fx_result_category_id := budgeting.get__owner_system_category_id(
                _owner_type,
                _owner_user_id,
                _owner_family_id,
                'FX Result'
            );

            IF _fx_result_category_id IS NULL THEN
                RAISE EXCEPTION 'System category FX Result is missing';
            END IF;

            INSERT INTO budget_entries (operation_id, category_id, currency_code, amount)
            VALUES (_operation_id, _fx_result_category_id, _base_currency_code, _realized_result);

            PERFORM budgeting.put__apply_current_budget_delta(
                _fx_result_category_id,
                _base_currency_code,
                _realized_result
            );
        END IF;
    END IF;

    PERFORM budgeting.put__apply_current_crypto_delta(
        _bank_account_id,
        _crypto_asset_id,
        -_crypto_amount,
        -_consumed_cost_base
    );

    PERFORM budgeting.put__apply_current_bank_delta(
        _bank_account_id,
        _fiat_currency_code,
        _fiat_amount,
        CASE
            WHEN _fiat_currency_code = _base_currency_code THEN round(_fiat_amount, 2)
            ELSE _consumed_cost_base
        END
    );

    RETURN jsonb_build_object(
        'operation_id', _operation_id,
        'consumed_cost_base', _consumed_cost_base,
        'realized_fx_result_in_base', _realized_result,
        'base_currency_code', _base_currency_code
    );
END
$function$;
