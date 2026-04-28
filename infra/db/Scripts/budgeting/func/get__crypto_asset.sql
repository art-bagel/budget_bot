DROP FUNCTION IF EXISTS budgeting.get__crypto_asset;
CREATE FUNCTION budgeting.get__crypto_asset(
    _crypto_asset_id bigint
)
RETURNS jsonb
LANGUAGE plpgsql
AS $function$
DECLARE
    _result jsonb;
BEGIN
    SET search_path TO budgeting;

    SELECT jsonb_build_object(
        'id', id,
        'symbol', symbol,
        'name', name,
        'network_code', network_code,
        'contract_address', contract_address,
        'decimals', decimals,
        'metadata', metadata,
        'created_at', created_at
    )
    INTO _result
    FROM crypto_assets
    WHERE id = _crypto_asset_id;

    RETURN _result;
END
$function$;

