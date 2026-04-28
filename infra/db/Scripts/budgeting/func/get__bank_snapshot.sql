DROP FUNCTION IF EXISTS budgeting.get__bank_snapshot;
CREATE FUNCTION budgeting.get__bank_snapshot(
    _user_id bigint,
    _bank_account_id bigint
)
RETURNS jsonb
LANGUAGE plpgsql
AS $function$
DECLARE
    _owner_type text;
    _owner_user_id bigint;
    _owner_family_id bigint;
    _base_currency_code char(3);
    _result jsonb;
BEGIN
    SET search_path TO budgeting;

    SELECT owner_type, owner_user_id, owner_family_id
    INTO _owner_type, _owner_user_id, _owner_family_id
    FROM bank_accounts
    WHERE id = _bank_account_id
      AND is_active;

    IF _owner_type IS NULL THEN
        RAISE EXCEPTION 'Unknown active bank account %', _bank_account_id;
    END IF;

    IF NOT budgeting.has__owner_access(_user_id, _owner_type, _owner_user_id, _owner_family_id) THEN
        RAISE EXCEPTION 'Access denied to bank account %', _bank_account_id;
    END IF;

    _base_currency_code := budgeting.get__owner_base_currency(_owner_type, _owner_user_id, _owner_family_id);

    WITH fiat_rows AS (
        SELECT
            'fiat'::text AS asset_type,
            NULL::bigint AS crypto_asset_id,
            cbb.currency_code::text AS currency_code,
            cbb.currency_code::text AS symbol,
            cbb.amount,
            cbb.historical_cost_in_base,
            NULL::text AS network_code,
            NULL::text AS contract_address,
            2::smallint AS decimals
        FROM current_bank_balances cbb
        WHERE cbb.bank_account_id = _bank_account_id
          AND cbb.amount <> 0
    ),
    crypto_rows AS (
        SELECT
            'crypto'::text AS asset_type,
            ca.id AS crypto_asset_id,
            ca.symbol::text AS currency_code,
            ca.symbol::text AS symbol,
            ccb.amount,
            ccb.cost_base_remaining AS historical_cost_in_base,
            ca.network_code,
            ca.contract_address,
            ca.decimals
        FROM current_crypto_balances ccb
        JOIN crypto_assets ca
          ON ca.id = ccb.crypto_asset_id
        WHERE ccb.bank_account_id = _bank_account_id
          AND ccb.amount <> 0
    ),
    combined AS (
        SELECT * FROM fiat_rows
        UNION ALL
        SELECT * FROM crypto_rows
    )
    SELECT COALESCE(
        jsonb_agg(
            jsonb_build_object(
                'asset_type', asset_type,
                'crypto_asset_id', crypto_asset_id,
                'currency_code', currency_code,
                'symbol', symbol,
                'amount', amount,
                'historical_cost_in_base', historical_cost_in_base,
                'base_currency_code', _base_currency_code,
                'network_code', network_code,
                'contract_address', contract_address,
                'decimals', decimals
            )
            ORDER BY asset_type, symbol
        ),
        '[]'::jsonb
    )
    INTO _result
    FROM combined;

    RETURN _result;
END
$function$;
