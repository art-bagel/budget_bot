DROP FUNCTION IF EXISTS budgeting.put__apply_current_budget_delta;
CREATE FUNCTION budgeting.put__apply_current_budget_delta(
    _category_id bigint,
    _currency_code char(3),
    _amount_delta numeric
)
RETURNS void
LANGUAGE plpgsql
AS $function$
BEGIN
    SET search_path TO budgeting;

    INSERT INTO current_budget_balances (
        category_id,
        currency_code,
        amount,
        updated_at
    )
    VALUES (
        _category_id,
        _currency_code,
        _amount_delta,
        current_timestamp
    )
    ON CONFLICT (category_id, currency_code)
    DO UPDATE
    SET amount = current_budget_balances.amount + EXCLUDED.amount,
        updated_at = current_timestamp;

    DELETE FROM current_budget_balances
    WHERE category_id = _category_id
      AND currency_code = _currency_code
      AND amount = 0;
END
$function$;
