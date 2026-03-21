CREATE OR REPLACE FUNCTION budgeting.put__reverse_operation(
    _user_id bigint,
    _operation_id bigint,
    _comment text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
AS $function$
DECLARE
    _original_type text;
    _reversal_operation_id bigint;
    _current_balance numeric;
    _current_budget numeric;
    _created_lot record;
    _bank_entry record;
    _budget_entry record;
    _consumption record;
    _owner_type text;
    _owner_user_id bigint;
    _owner_family_id bigint;
    _base_currency_code char(3);
    _bank_cost_delta numeric(20, 2);
BEGIN
    SET search_path TO budgeting;

    SELECT type, owner_type, owner_user_id, owner_family_id
    INTO _original_type, _owner_type, _owner_user_id, _owner_family_id
    FROM operations
    WHERE id = _operation_id;

    IF _original_type IS NULL THEN
        RAISE EXCEPTION 'Unknown operation %', _operation_id;
    END IF;

    IF NOT budgeting.has__owner_access(_user_id, _owner_type, _owner_user_id, _owner_family_id) THEN
        RAISE EXCEPTION 'Access denied to operation %', _operation_id;
    END IF;

    IF _original_type = 'reversal' THEN
        RAISE EXCEPTION 'Reversal operation cannot be reversed';
    END IF;

    IF _original_type IN ('investment_trade', 'investment_income', 'investment_adjustment') THEN
        RAISE EXCEPTION 'Investment operations reversal is not supported yet';
    END IF;

    PERFORM 1
    FROM operations
    WHERE reversal_of_operation_id = _operation_id;

    IF FOUND THEN
        RAISE EXCEPTION 'Operation % has already been reversed', _operation_id;
    END IF;

    FOR _created_lot IN
        SELECT id, amount_initial, amount_remaining, cost_base_initial, cost_base_remaining
        FROM fx_lots
        WHERE opened_by_operation_id = _operation_id
    LOOP
        IF _created_lot.amount_remaining <> _created_lot.amount_initial
           OR _created_lot.cost_base_remaining <> _created_lot.cost_base_initial THEN
            RAISE EXCEPTION 'Cannot reverse operation % because created FX lot % was already used',
                _operation_id,
                _created_lot.id;
        END IF;
    END LOOP;

    -- Check bank balances: reversal negates original entries.
    -- If original amount > 0 (was receiving money), reversal will subtract → check balance.
    FOR _bank_entry IN
        SELECT bank_account_id, currency_code, amount
        FROM bank_entries
        WHERE operation_id = _operation_id
    LOOP
        IF _bank_entry.amount > 0 THEN
            SELECT COALESCE((
                SELECT amount
                FROM current_bank_balances
                WHERE bank_account_id = _bank_entry.bank_account_id
                  AND currency_code = _bank_entry.currency_code
            ), 0)
            INTO _current_balance;

            IF _current_balance < _bank_entry.amount THEN
                RAISE EXCEPTION 'Cannot reverse operation %, insufficient bank balance in currency %',
                    _operation_id,
                    _bank_entry.currency_code;
            END IF;
        END IF;
    END LOOP;

    -- Check budget balances: if original amount > 0 (was adding budget), reversal will subtract → check balance.
    FOR _budget_entry IN
        SELECT category_id, currency_code, amount
        FROM budget_entries
        WHERE operation_id = _operation_id
    LOOP
        IF _budget_entry.amount > 0 THEN
            SELECT COALESCE((
                SELECT amount
                FROM current_budget_balances
                WHERE category_id = _budget_entry.category_id
                  AND currency_code = _budget_entry.currency_code
            ), 0)
            INTO _current_budget;

            IF _current_budget < _budget_entry.amount THEN
                RAISE EXCEPTION 'Cannot reverse operation %, insufficient budget in category %',
                    _operation_id,
                    _budget_entry.category_id;
            END IF;
        END IF;
    END LOOP;

    INSERT INTO operations (
        actor_user_id,
        owner_type,
        owner_user_id,
        owner_family_id,
        type,
        reversal_of_operation_id,
        comment
    )
    VALUES (
        _user_id,
        _owner_type,
        _owner_user_id,
        _owner_family_id,
        'reversal',
        _operation_id,
        COALESCE(_comment, 'Reversal of operation ' || _operation_id)
    )
    RETURNING id
    INTO _reversal_operation_id;

    INSERT INTO bank_entries (operation_id, bank_account_id, currency_code, amount)
    SELECT _reversal_operation_id, bank_account_id, currency_code, -amount
    FROM bank_entries
    WHERE operation_id = _operation_id;

    INSERT INTO budget_entries (operation_id, category_id, currency_code, amount)
    SELECT _reversal_operation_id, category_id, currency_code, -amount
    FROM budget_entries
    WHERE operation_id = _operation_id;

    -- Restore lots that were consumed by the original operation.
    FOR _consumption IN
        SELECT lot_id, amount, cost_base
        FROM lot_consumptions
        WHERE operation_id = _operation_id
    LOOP
        UPDATE fx_lots
        SET amount_remaining    = amount_remaining    + _consumption.amount,
            cost_base_remaining = cost_base_remaining + _consumption.cost_base
        WHERE id = _consumption.lot_id;

        INSERT INTO lot_consumptions (operation_id, lot_id, amount, cost_base)
        VALUES (_reversal_operation_id, _consumption.lot_id, -_consumption.amount, -_consumption.cost_base);
    END LOOP;

    -- Zero out lots that were opened by the original operation.
    UPDATE fx_lots
    SET amount_remaining    = 0,
        cost_base_remaining = 0
    WHERE opened_by_operation_id = _operation_id;

    -- Apply incremental balance deltas (same pattern as all other operations).
    _base_currency_code := budgeting.get__owner_base_currency(_owner_type, _owner_user_id, _owner_family_id);

    FOR _bank_entry IN
        SELECT bank_account_id, currency_code, amount
        FROM bank_entries
        WHERE operation_id = _operation_id
    LOOP
        IF _bank_entry.currency_code = _base_currency_code THEN
            -- Base currency: cost equals amount.
            _bank_cost_delta := -round(_bank_entry.amount, 2);

        ELSIF _bank_entry.amount > 0 THEN
            -- Was receiving foreign currency → a lot was opened; zero that cost.
            SELECT -COALESCE(sum(fl.cost_base_initial), 0)
            INTO _bank_cost_delta
            FROM fx_lots fl
            WHERE fl.opened_by_operation_id = _operation_id
              AND fl.currency_code = _bank_entry.currency_code;

        ELSE
            -- Was paying foreign currency → lots were consumed; restore that cost.
            SELECT COALESCE(sum(lc.cost_base), 0)
            INTO _bank_cost_delta
            FROM lot_consumptions lc
            JOIN fx_lots fl ON fl.id = lc.lot_id
            WHERE lc.operation_id = _operation_id
              AND fl.currency_code = _bank_entry.currency_code;
        END IF;

        PERFORM budgeting.put__apply_current_bank_delta(
            _bank_entry.bank_account_id,
            _bank_entry.currency_code,
            -_bank_entry.amount,
            _bank_cost_delta
        );
    END LOOP;

    FOR _budget_entry IN
        SELECT category_id, currency_code, amount
        FROM budget_entries
        WHERE operation_id = _operation_id
    LOOP
        PERFORM budgeting.put__apply_current_budget_delta(
            _budget_entry.category_id,
            _budget_entry.currency_code,
            -_budget_entry.amount
        );
    END LOOP;

    RETURN jsonb_build_object(
        'reversal_operation_id', _reversal_operation_id,
        'reversed_operation_id', _operation_id
    );
END
$function$;
