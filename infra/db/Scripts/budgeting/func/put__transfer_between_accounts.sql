CREATE OR REPLACE FUNCTION budgeting.put__transfer_between_accounts(
    _user_id        bigint,
    _from_account_id bigint,
    _to_account_id  bigint,
    _currency_code  char(3),
    _amount         numeric,
    _comment        text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
AS $function$
DECLARE
    _from_owner_type      text;
    _from_owner_user_id   bigint;
    _from_owner_family_id bigint;
    _from_account_kind    text;
    _to_owner_type        text;
    _to_owner_user_id     bigint;
    _to_owner_family_id   bigint;
    _to_account_kind      text;
    _base_currency_code   char(3);
    _from_unallocated_id  bigint;
    _to_unallocated_id    bigint;
    _operation_id         bigint;
    _bank_balance         numeric(20, 8);
    _cost_base            numeric(20, 2) := 0;
    _remaining            numeric(20, 8);
    _lot_ids              bigint[]  := '{}';
    _lot_amounts          numeric[] := '{}';
    _lot_costs            numeric[] := '{}';
    _lot_idx              integer;
    _consume_amount       numeric(20, 8);
    _consume_cost         numeric(20, 2);
    _lot                  record;
BEGIN
    SET search_path TO budgeting;

    IF _amount <= 0 THEN
        RAISE EXCEPTION 'Transfer amount must be positive';
    END IF;

    IF _from_account_id = _to_account_id THEN
        RAISE EXCEPTION 'Source and target accounts must be different';
    END IF;

    -- Validate source account and access
    SELECT owner_type, owner_user_id, owner_family_id, account_kind
    INTO _from_owner_type, _from_owner_user_id, _from_owner_family_id, _from_account_kind
    FROM bank_accounts
    WHERE id = _from_account_id AND is_active;

    IF _from_owner_type IS NULL THEN
        RAISE EXCEPTION 'Unknown active bank account %', _from_account_id;
    END IF;

    IF NOT budgeting.has__owner_access(_user_id, _from_owner_type, _from_owner_user_id, _from_owner_family_id) THEN
        RAISE EXCEPTION 'Access denied to source bank account %', _from_account_id;
    END IF;

    -- Validate target account and access
    SELECT owner_type, owner_user_id, owner_family_id, account_kind
    INTO _to_owner_type, _to_owner_user_id, _to_owner_family_id, _to_account_kind
    FROM bank_accounts
    WHERE id = _to_account_id AND is_active;

    IF _to_owner_type IS NULL THEN
        RAISE EXCEPTION 'Unknown active bank account %', _to_account_id;
    END IF;

    IF NOT budgeting.has__owner_access(_user_id, _to_owner_type, _to_owner_user_id, _to_owner_family_id) THEN
        RAISE EXCEPTION 'Access denied to target bank account %', _to_account_id;
    END IF;

    -- Get base currency (same for both since family inherits user's base currency)
    _base_currency_code := budgeting.get__owner_base_currency(
        _from_owner_type, _from_owner_user_id, _from_owner_family_id
    );

    IF _from_account_kind = 'cash' THEN
        _from_unallocated_id := budgeting.get__owner_system_category_id(
            _from_owner_type, _from_owner_user_id, _from_owner_family_id, 'Unallocated'
        );
        IF _from_unallocated_id IS NULL THEN
            RAISE EXCEPTION 'Unallocated category missing for source account %', _from_account_id;
        END IF;
    END IF;

    IF _to_account_kind = 'cash' THEN
        _to_unallocated_id := budgeting.get__owner_system_category_id(
            _to_owner_type, _to_owner_user_id, _to_owner_family_id, 'Unallocated'
        );
        IF _to_unallocated_id IS NULL THEN
            RAISE EXCEPTION 'Unallocated category missing for target account %', _to_account_id;
        END IF;
    END IF;

    -- Check source balance
    SELECT COALESCE((
        SELECT amount FROM current_bank_balances
        WHERE bank_account_id = _from_account_id AND currency_code = _currency_code
    ), 0) INTO _bank_balance;

    IF _bank_balance < _amount THEN
        RAISE EXCEPTION 'Сумма превышает остаток';
    END IF;

    -- Calculate historical cost in base currency
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

            _lot_ids     := array_append(_lot_ids,     _lot.id);
            _lot_amounts := array_append(_lot_amounts, _consume_amount);
            _lot_costs   := array_append(_lot_costs,   _consume_cost);
            _cost_base   := _cost_base + _consume_cost;
            _remaining   := _remaining - _consume_amount;
        END LOOP;

        IF _remaining > 0 THEN
            RAISE EXCEPTION 'Сумма превышает остаток';
        END IF;
    END IF;

    -- Create operation (owned by the acting user)
    INSERT INTO operations (actor_user_id, owner_type, owner_user_id, owner_family_id, type, comment)
    VALUES (_user_id, 'user', _user_id, NULL, 'account_transfer', _comment)
    RETURNING id INTO _operation_id;

    -- Two bank entries: debit source, credit target
    INSERT INTO bank_entries (operation_id, bank_account_id, currency_code, amount)
    VALUES
        (_operation_id, _from_account_id, _currency_code, -_amount),
        (_operation_id, _to_account_id,   _currency_code,  _amount);

    -- Budget participates only when one of the accounts is a cash account.
    IF _from_account_kind = 'cash' THEN
        INSERT INTO budget_entries (operation_id, category_id, currency_code, amount)
        VALUES (_operation_id, _from_unallocated_id, _base_currency_code, -_cost_base);
    END IF;

    IF _to_account_kind = 'cash' THEN
        INSERT INTO budget_entries (operation_id, category_id, currency_code, amount)
        VALUES (_operation_id, _to_unallocated_id, _base_currency_code, _cost_base);
    END IF;

    -- Update bank balances
    PERFORM budgeting.put__apply_current_bank_delta(_from_account_id, _currency_code, -_amount, -_cost_base);
    PERFORM budgeting.put__apply_current_bank_delta(_to_account_id,   _currency_code,  _amount,  _cost_base);

    -- Update budget balances only for cash-side accounts.
    IF _from_account_kind = 'cash' THEN
        PERFORM budgeting.put__apply_current_budget_delta(_from_unallocated_id, _base_currency_code, -_cost_base);
    END IF;

    IF _to_account_kind = 'cash' THEN
        PERFORM budgeting.put__apply_current_budget_delta(_to_unallocated_id, _base_currency_code, _cost_base);
    END IF;

    -- Handle FX lots for foreign currencies
    IF _currency_code <> _base_currency_code THEN
        -- Consume lots from source
        IF array_length(_lot_ids, 1) IS NOT NULL THEN
            FOR _lot_idx IN 1..array_length(_lot_ids, 1) LOOP
                UPDATE fx_lots
                SET amount_remaining     = amount_remaining     - _lot_amounts[_lot_idx],
                    cost_base_remaining  = cost_base_remaining  - _lot_costs[_lot_idx]
                WHERE id = _lot_ids[_lot_idx];

                INSERT INTO lot_consumptions (operation_id, lot_id, amount, cost_base)
                VALUES (_operation_id, _lot_ids[_lot_idx], _lot_amounts[_lot_idx], _lot_costs[_lot_idx]);
            END LOOP;
        END IF;

        -- Open new lot in target at same historical cost
        INSERT INTO fx_lots (
            bank_account_id, currency_code,
            amount_initial, amount_remaining,
            buy_rate_in_base,
            cost_base_initial, cost_base_remaining,
            opened_by_operation_id
        )
        VALUES (
            _to_account_id, _currency_code,
            _amount, _amount,
            _cost_base / _amount,
            _cost_base, _cost_base,
            _operation_id
        );
    END IF;

    RETURN jsonb_build_object(
        'operation_id',      _operation_id,
        'amount_in_base',    _cost_base,
        'base_currency_code', _base_currency_code
    );
END
$function$;
