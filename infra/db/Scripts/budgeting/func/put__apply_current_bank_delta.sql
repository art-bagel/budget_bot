CREATE OR REPLACE FUNCTION budgeting.put__apply_current_bank_delta(
    _bank_account_id bigint,
    _currency_code char(3),
    _amount_delta numeric,
    _cost_delta_in_base numeric
)
RETURNS void
LANGUAGE plpgsql
AS $function$
BEGIN
    SET search_path TO budgeting;

    INSERT INTO current_bank_balances (
        bank_account_id,
        currency_code,
        amount,
        historical_cost_in_base,
        updated_at
    )
    VALUES (
        _bank_account_id,
        _currency_code,
        _amount_delta,
        _cost_delta_in_base,
        current_timestamp
    )
    ON CONFLICT (bank_account_id, currency_code)
    DO UPDATE
    SET amount = current_bank_balances.amount + EXCLUDED.amount,
        historical_cost_in_base = current_bank_balances.historical_cost_in_base + EXCLUDED.historical_cost_in_base,
        updated_at = current_timestamp;

    DELETE FROM current_bank_balances
    WHERE bank_account_id = _bank_account_id
      AND currency_code = _currency_code
      AND amount = 0
      AND historical_cost_in_base = 0;
END
$function$;
