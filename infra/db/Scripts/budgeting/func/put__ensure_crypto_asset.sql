-- Description:
--   Заводит крипто-актив в общем справочнике, если его там ещё нет, и
--   возвращает запись. Существующую строку НЕ меняет.
--
--   Это публичный путь — тот, что доступен любому аутентифицированному
--   пользователю через HTTP. crypto_assets общая на всех, поэтому право
--   переписать чужую строку здесь недопустимо: достаточно было отправить
--   symbol=BTC с metadata {"coingecko_id": "<что угодно>"}, чтобы цена
--   биткоина поехала у всех сразу. Никакой ошибки при этом не возникало —
--   просто у всех портфелей менялась оценка.
--
--   Обновление справочника осталось у put__upsert_crypto_asset, которую
--   вызывают только скрипты ручного импорта, работающие с базой напрямую.
-- Parameters:
--   _symbol text - Тикер актива, приводится к верхнему регистру.
--   _name text - Человекочитаемое имя; по умолчанию совпадает с тикером.
--   _network_code text - Сеть ('ton', 'ethereum', ...), по умолчанию 'manual'.
--   _contract_address text - Адрес контракта, приводится к нижнему регистру.
--   _decimals smallint - Знаков после запятой, 0..30.
--   _metadata jsonb - Дополнительные поля, используются только при создании.
-- Returns:
--   jsonb - Запись актива: созданная либо уже существовавшая.
DROP FUNCTION IF EXISTS budgeting.put__ensure_crypto_asset;
CREATE FUNCTION budgeting.put__ensure_crypto_asset(
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

    -- DO NOTHING, а не DO UPDATE: если актив уже есть, он остаётся ровно
    -- таким, каким был. Возвращаем его ниже обычным SELECT — вызывающему
    -- незачем знать, создали мы строку сейчас или она была раньше.
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
    ON CONFLICT (symbol, network_code, contract_address) DO NOTHING;

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
    WHERE symbol = _normalized_symbol
      AND network_code = _normalized_network
      AND contract_address = _normalized_contract;

    RETURN _result;
END
$function$;
