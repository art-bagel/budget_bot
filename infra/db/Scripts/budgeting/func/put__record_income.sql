-- Description:
--   Records an income operation by increasing the bank balance and the unallocated budget.
--   For non-base currency income a new FX lot is created with the provided historical cost.
-- Parameters:
--   _user_id bigint - Operation owner.
--   _bank_account_id bigint - Bank account that receives the funds.
--   _amount numeric - Amount received in the bank currency.
--   _currency_code char(3) - Currency of the received amount.
--   _income_source_id bigint - Optional income source for analytics.
--   _budget_amount_in_base numeric - Historical cost of the received amount in the user's base currency.
--   _comment text - Optional comment.
-- Returns:
--   jsonb - Operation identifier and booked amount in base currency.
CREATE OR REPLACE FUNCTION budgeting.put__record_income(
    _user_id bigint,
    _bank_account_id bigint,
    _amount numeric,
    _currency_code char(3),
    _income_source_id bigint DEFAULT NULL,
    _budget_amount_in_base numeric DEFAULT NULL,
    _comment text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
AS $function$
DECLARE
    _operation_id bigint;
    _base_currency_code char(3);
    _unallocated_category_id bigint;
    _effective_budget_amount_in_base numeric(20, 2);
    _income_source_user_id bigint;
BEGIN
    SET search_path TO budgeting;

    IF _amount <= 0 THEN
        RAISE EXCEPTION 'Income amount must be positive';
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

    IF _income_source_id IS NOT NULL THEN
        SELECT user_id
        INTO _income_source_user_id
        FROM income_sources
        WHERE id = _income_source_id
          AND is_active;

        IF _income_source_user_id IS NULL THEN
            RAISE EXCEPTION 'Unknown active income source %', _income_source_id;
        END IF;

        IF _income_source_user_id <> _user_id THEN
            RAISE EXCEPTION 'Income source % does not belong to user %', _income_source_id, _user_id;
        END IF;
    END IF;

    SELECT id
    INTO _unallocated_category_id
    FROM categories
    WHERE user_id = _user_id
      AND name = 'Unallocated'
      AND kind = 'system'
      AND is_active;

    IF _unallocated_category_id IS NULL THEN
        RAISE EXCEPTION 'System category Unallocated is missing for user %', _user_id;
    END IF;

    IF _currency_code = _base_currency_code THEN
        _effective_budget_amount_in_base := round(_amount, 2);
    ELSE
        IF _budget_amount_in_base IS NULL OR _budget_amount_in_base <= 0 THEN
            RAISE EXCEPTION 'Historical base amount is required for non-base currency income';
        END IF;

        _effective_budget_amount_in_base := round(_budget_amount_in_base, 2);
    END IF;

    INSERT INTO operations (user_id, income_source_id, type, comment)
    VALUES (_user_id, _income_source_id, 'income', _comment)
    RETURNING id
    INTO _operation_id;

    INSERT INTO bank_entries (operation_id, bank_account_id, currency_code, amount)
    VALUES (_operation_id, _bank_account_id, _currency_code, _amount);

    INSERT INTO budget_entries (operation_id, category_id, currency_code, amount)
    VALUES (_operation_id, _unallocated_category_id, _base_currency_code, _effective_budget_amount_in_base);

    IF _currency_code <> _base_currency_code THEN
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
            _currency_code,
            _amount,
            _amount,
            _effective_budget_amount_in_base / _amount,
            _effective_budget_amount_in_base,
            _effective_budget_amount_in_base,
            _operation_id
        );
    END IF;

    RETURN jsonb_build_object(
        'operation_id', _operation_id,
        'budget_amount_in_base', _effective_budget_amount_in_base,
        'base_currency_code', _base_currency_code
    );
END
$function$;
