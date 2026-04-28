DROP FUNCTION IF EXISTS budgeting.get__crypto_assets;
CREATE FUNCTION budgeting.get__crypto_assets()
RETURNS jsonb
LANGUAGE plpgsql
AS $function$
DECLARE
    _result jsonb;
BEGIN
    SET search_path TO budgeting;

    SELECT COALESCE(
        jsonb_agg(
            jsonb_build_object(
                'id', id,
                'symbol', symbol,
                'name', name,
                'network_code', network_code,
                'contract_address', contract_address,
                'decimals', decimals,
                'metadata', metadata,
                'created_at', created_at
            )
            ORDER BY symbol, network_code, id
        ),
        '[]'::jsonb
    )
    INTO _result
    FROM crypto_assets;

    RETURN _result;
END
$function$;

