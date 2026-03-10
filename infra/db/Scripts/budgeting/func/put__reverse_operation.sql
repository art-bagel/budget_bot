-- Description:
--   Creates a reversal operation for a previously posted operation.
--   The function mirrors bank and budget entries, restores consumed FX lots and
--   closes untouched lots created by the original operation.
-- Parameters:
--   _user_id bigint - Operation owner.
--   _operation_id bigint - Operation to reverse.
--   _comment text - Optional comment for the reversal.
-- Returns:
--   jsonb - Identifier of the reversal operation.
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
BEGIN
    SET search_path TO budgeting;

    SELECT type
    INTO _original_type
    FROM operations
    WHERE id = _operation_id
      AND user_id = _user_id;

    IF _original_type IS NULL THEN
        RAISE EXCEPTION 'Unknown operation % for user %', _operation_id, _user_id;
    END IF;

    IF _original_type = 'reversal' THEN
        RAISE EXCEPTION 'Reversal operation cannot be reversed';
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

    FOR _bank_entry IN
        SELECT bank_account_id, currency_code, amount
        FROM bank_entries
        WHERE operation_id = _operation_id
    LOOP
        IF -_bank_entry.amount < 0 THEN
            SELECT COALESCE((
                SELECT amount
                FROM current_bank_balances
                WHERE bank_account_id = _bank_entry.bank_account_id
                  AND currency_code = _bank_entry.currency_code
            ), 0)
            INTO _current_balance
            ;

            IF _current_balance < abs(_bank_entry.amount) THEN
                RAISE EXCEPTION 'Cannot reverse operation %, insufficient bank balance in currency %',
                    _operation_id,
                    _bank_entry.currency_code;
            END IF;
        END IF;
    END LOOP;

    FOR _budget_entry IN
        SELECT category_id, currency_code, amount
        FROM budget_entries
        WHERE operation_id = _operation_id
    LOOP
        IF -_budget_entry.amount < 0 THEN
            SELECT COALESCE((
                SELECT amount
                FROM current_budget_balances
                WHERE category_id = _budget_entry.category_id
                  AND currency_code = _budget_entry.currency_code
            ), 0)
            INTO _current_budget
            ;

            IF _current_budget < abs(_budget_entry.amount) THEN
                RAISE EXCEPTION 'Cannot reverse operation %, insufficient budget in category %',
                    _operation_id,
                    _budget_entry.category_id;
            END IF;
        END IF;
    END LOOP;

    INSERT INTO operations (user_id, type, reversal_of_operation_id, comment)
    VALUES (_user_id, 'reversal', _operation_id, COALESCE(_comment, 'Reversal of operation ' || _operation_id))
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

    FOR _consumption IN
        SELECT lot_id, amount, cost_base
        FROM lot_consumptions
        WHERE operation_id = _operation_id
    LOOP
        UPDATE fx_lots
        SET amount_remaining = amount_remaining + _consumption.amount,
            cost_base_remaining = cost_base_remaining + _consumption.cost_base
        WHERE id = _consumption.lot_id;

        INSERT INTO lot_consumptions (operation_id, lot_id, amount, cost_base)
        VALUES (_reversal_operation_id, _consumption.lot_id, -_consumption.amount, -_consumption.cost_base);
    END LOOP;

    UPDATE fx_lots
    SET amount_remaining = 0,
        cost_base_remaining = 0
    WHERE opened_by_operation_id = _operation_id;

    PERFORM budgeting.rebuild_current_balances(_user_id);

    RETURN jsonb_build_object(
        'reversal_operation_id', _reversal_operation_id,
        'reversed_operation_id', _operation_id
    );
END
$function$;
