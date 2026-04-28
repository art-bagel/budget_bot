DROP FUNCTION IF EXISTS budgeting.put__apply_current_crypto_delta;
CREATE FUNCTION budgeting.put__apply_current_crypto_delta(
    _bank_account_id bigint,
    _crypto_asset_id bigint,
    _amount_delta numeric,
    _cost_base_delta numeric DEFAULT 0
)
RETURNS void
LANGUAGE plpgsql
AS $function$
BEGIN
    SET search_path TO budgeting;

    INSERT INTO current_crypto_balances (
        bank_account_id,
        crypto_asset_id,
        amount,
        cost_base_remaining,
        updated_at
    )
    VALUES (
        _bank_account_id,
        _crypto_asset_id,
        _amount_delta,
        COALESCE(_cost_base_delta, 0),
        current_timestamp
    )
    ON CONFLICT (bank_account_id, crypto_asset_id) DO UPDATE
    SET amount = current_crypto_balances.amount + EXCLUDED.amount,
        cost_base_remaining = current_crypto_balances.cost_base_remaining + EXCLUDED.cost_base_remaining,
        updated_at = current_timestamp;

    DELETE FROM current_crypto_balances
    WHERE bank_account_id = _bank_account_id
      AND crypto_asset_id = _crypto_asset_id
      AND abs(amount) < 0.000000000001
      AND abs(cost_base_remaining) < 0.01;
END
$function$;

