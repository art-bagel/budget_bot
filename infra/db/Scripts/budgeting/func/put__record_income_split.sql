DROP FUNCTION IF EXISTS budgeting.put__record_income_split(bigint, bigint, numeric, character, numeric, text, timestamptz);
DROP FUNCTION IF EXISTS budgeting.put__record_income_split(bigint, bigint, numeric, character, numeric, text, timestamptz, numeric);
DROP FUNCTION IF EXISTS budgeting.put__record_income_split(bigint, bigint, numeric, character, numeric, text, date);
DROP FUNCTION IF EXISTS budgeting.put__record_income_split(bigint, bigint, numeric, character, numeric, text, date, numeric);
CREATE FUNCTION budgeting.put__record_income_split(
    _user_id              bigint,
    _income_source_id     bigint,
    _amount               numeric,
    _currency_code        char(3),
    _budget_amount_in_base numeric DEFAULT NULL,
    _comment              text     DEFAULT NULL,
    _operated_at          date DEFAULT NULL,
    _tax_percent          numeric DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
AS $function$
DECLARE
    _pattern_id          bigint;
    _line                record;
    _line_amount         numeric;
    _line_budget_amount  numeric;
    _result              jsonb;
    _operation_ids       bigint[] := '{}';
    _total_budget_base   numeric  := 0;
    _last_base_currency  char(3);
    _running_amount      numeric  := 0;
    _running_budget      numeric  := 0;
    _line_index          int      := 0;
    _total_lines         int;
    _tax_operation_id    bigint;
    _tax_operation_ids   bigint[] := '{}';
    _total_tax_base      numeric  := 0;
BEGIN
    SET search_path TO budgeting;

    IF _amount <= 0 THEN
        RAISE EXCEPTION 'Income amount must be positive';
    END IF;

    IF _tax_percent IS NOT NULL AND _tax_percent <> 0
       AND (_tax_percent < 0 OR _tax_percent >= 100) THEN
        RAISE EXCEPTION 'Tax percent must be greater than or equal to 0 and less than 100';
    END IF;

    -- Verify income source and locate its pattern
    SELECT p.id INTO _pattern_id
    FROM income_sources s
    JOIN income_source_patterns p ON p.income_source_id = s.id
    WHERE s.id = _income_source_id
      AND s.user_id = _user_id
      AND s.is_active;

    IF _pattern_id IS NULL THEN
        RAISE EXCEPTION 'No distribution pattern found for income source %', _income_source_id;
    END IF;

    SELECT COUNT(*) INTO _total_lines
    FROM income_source_pattern_lines
    WHERE pattern_id = _pattern_id;

    FOR _line IN
        SELECT l.bank_account_id, l.share
        FROM income_source_pattern_lines l
        WHERE l.pattern_id = _pattern_id
        ORDER BY l.id
    LOOP
        _line_index := _line_index + 1;

        -- Last line gets the remainder to avoid rounding drift
        IF _line_index = _total_lines THEN
            _line_amount        := _amount - _running_amount;
            _line_budget_amount := CASE
                WHEN _budget_amount_in_base IS NOT NULL THEN _budget_amount_in_base - _running_budget
                ELSE NULL
            END;
        ELSE
            _line_amount        := ROUND(_amount * _line.share, 8);
            _line_budget_amount := CASE
                WHEN _budget_amount_in_base IS NOT NULL THEN ROUND(_budget_amount_in_base * _line.share, 2)
                ELSE NULL
            END;
            _running_amount := _running_amount + _line_amount;
            _running_budget := _running_budget + COALESCE(_line_budget_amount, 0);
        END IF;

        IF _line_amount <= 0 THEN CONTINUE; END IF;

        SELECT budgeting.put__record_income(
            _user_id,
            _line.bank_account_id,
            _line_amount,
            _currency_code,
            _income_source_id,
            _line_budget_amount,
            _comment,
            _operated_at,
            _tax_percent
        ) INTO _result;

        _operation_ids      := _operation_ids || (_result->>'operation_id')::bigint;
        _total_budget_base  := _total_budget_base + (_result->>'budget_amount_in_base')::numeric;
        _total_tax_base     := _total_tax_base + COALESCE((_result->>'tax_amount_in_base')::numeric, 0);
        _tax_operation_id   := NULLIF(_result->>'tax_operation_id', '')::bigint;
        IF _tax_operation_id IS NOT NULL THEN
            _tax_operation_ids := _tax_operation_ids || _tax_operation_id;
        END IF;
        _last_base_currency := (_result->>'base_currency_code')::char(3);
    END LOOP;

    RETURN jsonb_build_object(
        'operation_ids',        _operation_ids,
        'tax_operation_ids',    _tax_operation_ids,
        'total_budget_in_base', _total_budget_base,
        'total_tax_in_base',    _total_tax_base,
        'base_currency_code',   _last_base_currency
    );
END
$function$;
