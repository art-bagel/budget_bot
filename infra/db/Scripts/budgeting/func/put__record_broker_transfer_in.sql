DROP FUNCTION IF EXISTS budgeting.put__record_broker_transfer_in;
CREATE FUNCTION budgeting.put__record_broker_transfer_in(
    _user_id               bigint,
    _owner_type            text,
    _owner_user_id         bigint,
    _owner_family_id       bigint,
    _from_account_id       bigint,
    _investment_account_id bigint,
    _currency_code         char(3),
    _amount                numeric,
    _external_id           text             DEFAULT NULL,
    _import_source         varchar(30)      DEFAULT NULL,
    _comment               text             DEFAULT NULL,
    _operation_at          timestamptz      DEFAULT CURRENT_TIMESTAMP
)
RETURNS jsonb
LANGUAGE plpgsql
AS $function$
DECLARE
    _operation_id        bigint;
    _base_currency_code  char(3);
    _from_owner_type     text;
    _from_owner_user_id  bigint;
    _from_owner_family_id bigint;
    _investment_owner_type text;
    _investment_owner_user_id bigint;
    _investment_owner_family_id bigint;
    _from_account_kind   text;
    _investment_account_kind text;
    _from_credit_limit   numeric(20, 2);
    _from_unallocated_id bigint;
    _bank_balance        numeric(20, 8);
    _cost_base           numeric(20, 2) := 0;
    _remaining           numeric(20, 8);
    _lot_ids             bigint[]  := '{}';
    _lot_amounts         numeric[] := '{}';
    _lot_costs           numeric[] := '{}';
    _lot_idx             integer;
    _consume_amount      numeric(20, 8);
    _consume_cost        numeric(20, 2);
    _lot                 record;
BEGIN
    SET search_path TO budgeting;

    IF _amount <= 0 THEN
        RAISE EXCEPTION 'Transfer amount must be positive';
    END IF;

    SELECT owner_type, owner_user_id, owner_family_id, account_kind, credit_limit
    INTO _from_owner_type, _from_owner_user_id, _from_owner_family_id, _from_account_kind, _from_credit_limit
    FROM bank_accounts
    WHERE id = _from_account_id AND is_active;

    IF _from_account_kind IS NULL THEN
        RAISE EXCEPTION 'Unknown active bank account %', _from_account_id;
    END IF;

    IF NOT budgeting.has__owner_access(_user_id, _from_owner_type, _from_owner_user_id, _from_owner_family_id) THEN
        RAISE EXCEPTION 'Access denied to account %', _from_account_id;
    END IF;

    SELECT owner_type, owner_user_id, owner_family_id, account_kind
    INTO _investment_owner_type, _investment_owner_user_id, _investment_owner_family_id, _investment_account_kind
    FROM bank_accounts
    WHERE id = _investment_account_id AND is_active;

    IF _investment_owner_type IS NULL OR _investment_account_kind <> 'investment' THEN
        RAISE EXCEPTION 'Unknown active investment account %', _investment_account_id;
    END IF;

    IF NOT budgeting.has__owner_access(
        _user_id, _investment_owner_type, _investment_owner_user_id, _investment_owner_family_id
    ) THEN
        RAISE EXCEPTION 'Access denied to investment account %', _investment_account_id;
    END IF;

    _base_currency_code := budgeting.get__owner_base_currency(_from_owner_type, _from_owner_user_id, _from_owner_family_id);

    IF _from_account_kind = 'cash' THEN
        _from_unallocated_id := budgeting.get__owner_system_category_id(
            _from_owner_type, _from_owner_user_id, _from_owner_family_id, 'Unallocated'
        );
        IF _from_unallocated_id IS NULL THEN
            RAISE EXCEPTION 'Unallocated category missing for source account %', _from_account_id;
        END IF;
    END IF;

    -- Lock the balance row to prevent concurrent over-spend.
    PERFORM 1 FROM current_bank_balances
    WHERE bank_account_id = _from_account_id AND currency_code = _currency_code
    FOR UPDATE;

    SELECT COALESCE(amount, 0)
    INTO _bank_balance
    FROM current_bank_balances
    WHERE bank_account_id = _from_account_id AND currency_code = _currency_code;

    -- If no row exists, _bank_balance is NULL; treat as zero.
    _bank_balance := COALESCE(_bank_balance, 0);

    IF _from_account_kind = 'credit' THEN
        IF _from_credit_limit IS NULL THEN
            RAISE EXCEPTION 'Credit limit is not configured for this account';
        END IF;
        IF (_bank_balance - _amount) < -_from_credit_limit THEN
            RAISE EXCEPTION 'Credit limit exceeded';
        END IF;
    ELSE
        IF _bank_balance < _amount THEN
            RAISE EXCEPTION 'Сумма превышает остаток';
        END IF;
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
                _consume_cost := round(
                    _lot.cost_base_remaining * _consume_amount / _lot.amount_remaining, 2
                );
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

    INSERT INTO operations (
        actor_user_id, owner_type, owner_user_id, owner_family_id, type, comment, created_at
    )
    VALUES (
        _user_id, _from_owner_type, _from_owner_user_id, _from_owner_family_id,
        'account_transfer', _comment, COALESCE(_operation_at, CURRENT_TIMESTAMP)
    )
    RETURNING id INTO _operation_id;

    INSERT INTO bank_entries (operation_id, bank_account_id, currency_code, amount)
    VALUES (_operation_id, _from_account_id, _currency_code, -_amount);

    INSERT INTO bank_entries (
        operation_id, bank_account_id, currency_code, amount, external_id, import_source
    )
    VALUES (
        _operation_id, _investment_account_id, _currency_code, _amount, _external_id, _import_source
    )
    ON CONFLICT DO NOTHING;

    IF _from_account_kind = 'cash' THEN
        INSERT INTO budget_entries (operation_id, category_id, currency_code, amount)
        VALUES (_operation_id, _from_unallocated_id, _base_currency_code, -_cost_base);
    END IF;

    PERFORM budgeting.put__apply_current_bank_delta(_from_account_id,       _currency_code, -_amount, -_cost_base);
    PERFORM budgeting.put__apply_current_bank_delta(_investment_account_id, _currency_code,  _amount,  _cost_base);

    IF _from_account_kind = 'cash' THEN
        PERFORM budgeting.put__apply_current_budget_delta(_from_unallocated_id, _base_currency_code, -_cost_base);
    END IF;

    IF _currency_code <> _base_currency_code THEN
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

        INSERT INTO fx_lots (
            bank_account_id, currency_code,
            amount_initial, amount_remaining,
            buy_rate_in_base,
            cost_base_initial, cost_base_remaining,
            opened_by_operation_id
        )
        VALUES (
            _investment_account_id, _currency_code,
            _amount, _amount,
            _cost_base / _amount,
            _cost_base, _cost_base,
            _operation_id
        );
    END IF;

    RETURN jsonb_build_object(
        'operation_id',   _operation_id,
        'amount_in_base', _cost_base
    );
END
$function$;
