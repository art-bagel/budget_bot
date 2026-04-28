DROP FUNCTION IF EXISTS budgeting.put__upsert_crypto_asset;
CREATE FUNCTION budgeting.put__upsert_crypto_asset(
    _symbol text,
    _name text DEFAULT NULL,
    _network_code text DEFAULT 'manual',
    _contract_address text DEFAULT NULL,
    _decimals smallint DEFAULT 8,
    _metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
AS $function$
DECLARE
    _asset_id bigint;
    _normalized_symbol text := upper(btrim(_symbol));
    _normalized_network text := lower(COALESCE(NULLIF(btrim(_network_code), ''), 'manual'));
    _normalized_contract text := lower(btrim(COALESCE(_contract_address, '')));
    _normalized_name text := COALESCE(NULLIF(btrim(_name), ''), upper(btrim(_symbol)));
    _result jsonb;
BEGIN
    SET search_path TO budgeting;

    IF _normalized_symbol = '' OR _normalized_symbol !~ '^[A-Z0-9][A-Z0-9_./-]{1,29}$' THEN
        RAISE EXCEPTION 'Unsupported crypto symbol: %', _symbol;
    END IF;

    IF _decimals < 0 OR _decimals > 30 THEN
        RAISE EXCEPTION 'Crypto decimals must be between 0 and 30';
    END IF;

    INSERT INTO crypto_assets (
        symbol,
        name,
        network_code,
        contract_address,
        decimals,
        metadata
    )
    VALUES (
        _normalized_symbol,
        _normalized_name,
        _normalized_network,
        _normalized_contract,
        COALESCE(_decimals, 8),
        COALESCE(_metadata, '{}'::jsonb)
    )
    ON CONFLICT (symbol, network_code, contract_address) DO UPDATE
    SET name = EXCLUDED.name,
        decimals = EXCLUDED.decimals,
        metadata = crypto_assets.metadata || EXCLUDED.metadata
    RETURNING id INTO _asset_id;

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
    WHERE id = _asset_id;

    RETURN _result;
END
$function$;
