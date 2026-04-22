DROP FUNCTION IF EXISTS budgeting.put__record_income(bigint, bigint, numeric, character, bigint, numeric, text, timestamptz);
DROP FUNCTION IF EXISTS budgeting.put__record_income(bigint, bigint, numeric, character, bigint, numeric, text, timestamptz, numeric);
DROP FUNCTION IF EXISTS budgeting.put__record_income(bigint, bigint, numeric, character, bigint, numeric, text, date);
DROP FUNCTION IF EXISTS budgeting.put__record_income(bigint, bigint, numeric, character, bigint, numeric, text, date, numeric);
CREATE FUNCTION budgeting.put__record_income(
    _user_id bigint,
    _bank_account_id bigint,
    _amount numeric,
    _currency_code char(3),
    _income_source_id bigint DEFAULT NULL,
    _budget_amount_in_base numeric DEFAULT NULL,
    _comment text DEFAULT NULL,
    _operated_at date DEFAULT NULL,
    _tax_percent numeric DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
AS $function$
DECLARE
    _operation_id bigint;
    _owner_type text;
    _owner_user_id bigint;
    _owner_family_id bigint;
    _account_kind text;
    _base_currency_code char(3);
    _unallocated_category_id bigint;
    _effective_budget_amount_in_base numeric(20, 2);
    _income_source_user_id bigint;
    _tax_amount numeric(20, 8) := 0;
    _tax_cost_in_base numeric(20, 2) := 0;
    _tax_result jsonb;
    _tax_operation_id bigint;
    _net_budget_amount_in_base numeric(20, 2);
BEGIN
    SET search_path TO budgeting;

    IF _amount <= 0 THEN
        RAISE EXCEPTION 'Income amount must be positive';
    END IF;

    IF _tax_percent IS NOT NULL AND _tax_percent <> 0
       AND (_tax_percent < 0 OR _tax_percent >= 100) THEN
        RAISE EXCEPTION 'Tax percent must be greater than or equal to 0 and less than 100';
    END IF;

    SELECT owner_type, owner_user_id, owner_family_id, account_kind
    INTO _owner_type, _owner_user_id, _owner_family_id, _account_kind
    FROM bank_accounts
    WHERE id = _bank_account_id
      AND is_active;

    IF _owner_type IS NULL THEN
        RAISE EXCEPTION 'Unknown active bank account %', _bank_account_id;
    END IF;

    IF NOT budgeting.has__owner_access(_user_id, _owner_type, _owner_user_id, _owner_family_id) THEN
        RAISE EXCEPTION 'Access denied to bank account %', _bank_account_id;
    END IF;

    IF _account_kind <> 'cash' THEN
        RAISE EXCEPTION 'Income can only be recorded on cash accounts';
    END IF;

    _base_currency_code := budgeting.get__owner_base_currency(_owner_type, _owner_user_id, _owner_family_id);

    IF _base_currency_code IS NULL THEN
        RAISE EXCEPTION 'Base currency is missing for bank account owner %', _bank_account_id;
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

    _unallocated_category_id := budgeting.get__owner_system_category_id(
        _owner_type,
        _owner_user_id,
        _owner_family_id,
        'Unallocated'
    );

    IF _unallocated_category_id IS NULL THEN
        RAISE EXCEPTION 'System category Unallocated is missing for bank account owner %', _bank_account_id;
    END IF;

    IF _currency_code = _base_currency_code THEN
        _effective_budget_amount_in_base := round(_amount, 2);
    ELSE
        IF _budget_amount_in_base IS NULL OR _budget_amount_in_base <= 0 THEN
            RAISE EXCEPTION 'Historical base amount is required for non-base currency income';
        END IF;

        _effective_budget_amount_in_base := round(_budget_amount_in_base, 2);
    END IF;

    IF _tax_percent IS NOT NULL AND _tax_percent > 0 THEN
        _tax_amount := round(_amount * _tax_percent / 100, 8);

        IF _tax_amount <= 0 OR _tax_amount >= _amount THEN
            RAISE EXCEPTION 'Calculated income tax amount must be greater than 0 and less than income amount';
        END IF;

        _tax_cost_in_base := round(_effective_budget_amount_in_base * _tax_percent / 100, 2);

        IF _tax_cost_in_base <= 0 OR _tax_cost_in_base >= _effective_budget_amount_in_base THEN
            RAISE EXCEPTION 'Calculated income tax base amount must be greater than 0 and less than income base amount';
        END IF;
    END IF;

    INSERT INTO operations (
        actor_user_id,
        owner_type,
        owner_user_id,
        owner_family_id,
        income_source_id,
        type,
        comment,
        operated_on
    )
    VALUES (
        _user_id,
        _owner_type,
        _owner_user_id,
        _owner_family_id,
        _income_source_id,
        'income',
        _comment,
        COALESCE(_operated_at::date, current_date)
    )
    RETURNING id
    INTO _operation_id;

    INSERT INTO bank_entries (operation_id, bank_account_id, currency_code, amount)
    VALUES (_operation_id, _bank_account_id, _currency_code, _amount);

    INSERT INTO budget_entries (operation_id, category_id, currency_code, amount)
    VALUES (_operation_id, _unallocated_category_id, _base_currency_code, _effective_budget_amount_in_base);

    PERFORM budgeting.put__apply_current_bank_delta(
        _bank_account_id,
        _currency_code,
        _amount,
        _effective_budget_amount_in_base
    );

    PERFORM budgeting.put__apply_current_budget_delta(
        _unallocated_category_id,
        _base_currency_code,
        _effective_budget_amount_in_base
    );

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

    IF _tax_amount > 0 THEN
        SELECT budgeting.put__record_income_tax(
            _user_id,
            _bank_account_id,
            _tax_amount,
            _currency_code,
            _tax_cost_in_base,
            _tax_percent,
            _operated_at,
            _income_source_id
        ) INTO _tax_result;

        _tax_operation_id := (_tax_result->>'operation_id')::bigint;
        _tax_cost_in_base := (_tax_result->>'expense_cost_in_base')::numeric;
    END IF;

    _net_budget_amount_in_base := _effective_budget_amount_in_base - _tax_cost_in_base;

    RETURN jsonb_build_object(
        'operation_id', _operation_id,
        'tax_operation_id', _tax_operation_id,
        'budget_amount_in_base', _net_budget_amount_in_base,
        'gross_budget_amount_in_base', _effective_budget_amount_in_base,
        'tax_amount', _tax_amount,
        'tax_amount_in_base', _tax_cost_in_base,
        'base_currency_code', _base_currency_code
    );
END
$function$;
