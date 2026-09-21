-- Сценарный тест защиты общего справочника крипто-активов.
--
-- Запуск на локальном docker-стеке:
--   docker exec budget_bot_db sh -lc 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" \
--       -d "$POSTGRES_DB" -f /Scripts/budgeting/tests/crypto_assets.sql'
--
-- crypto_assets — одна таблица на всех пользователей, и в metadata лежит
-- coingecko_id, то есть источник цены. Пока за публичным POST /crypto/assets
-- стоял upsert, любой аутентифицированный пользователь мог отправить
-- symbol=BTC с чужим coingecko_id и поменять оценку биткоина сразу всем,
-- не вызвав ни одной ошибки.
--
-- Проверяется, что публичный путь (put__ensure_crypto_asset) существующую
-- запись не трогает, а привилегированный (put__upsert_crypto_asset) — трогает,
-- потому что им пользуются скрипты ручного импорта.
--
-- Тест пишет в базу и убирает за собой — гонять на dev, не на проде.
SET search_path TO budgeting;

DO $$
DECLARE
    _victim_id   bigint;
    _returned    jsonb;
    _name        text;
    _decimals    smallint;
    _metadata    jsonb;
    _count_before int;
    _count_after  int;
    _guard       boolean;
    _err         text;
BEGIN
    -- ── Фикстура: «чужой» актив с настроенным источником цены ───────────
    INSERT INTO crypto_assets (symbol, name, network_code, contract_address, decimals, metadata)
    VALUES ('ZZTEST', 'Честный актив', 'testnet', '', 8, '{"coingecko_id": "honest-coin"}'::jsonb)
    RETURNING id INTO _victim_id;

    SELECT count(*) INTO _count_before FROM crypto_assets;

    -- ── 1. Публичный путь не переписывает существующий актив ────────────
    -- Ровно та атака, ради которой тест написан: подменить источник цены.
    _returned := put__ensure_crypto_asset(
        'ZZTEST', 'Подменённое имя', 'testnet', '', 2::smallint,
        '{"coingecko_id": "scam-coin"}'::jsonb
    );

    SELECT name, decimals, metadata INTO _name, _decimals, _metadata
    FROM crypto_assets WHERE id = _victim_id;

    ASSERT _name = 'Честный актив',
        format('имя не должно меняться через публичный путь, стало %s', _name);
    ASSERT _decimals = 8,
        format('decimals не должны меняться, стало %s', _decimals);
    ASSERT _metadata->>'coingecko_id' = 'honest-coin',
        format('источник цены не должен подменяться, стал %s', _metadata->>'coingecko_id');

    -- Вызывающий получает актуальную запись, а не свою выдумку.
    ASSERT (_returned->>'id')::bigint = _victim_id, 'возвращается существующая запись';
    ASSERT _returned->>'name' = 'Честный актив', 'и именно её поля, а не присланные';

    SELECT count(*) INTO _count_after FROM crypto_assets;
    ASSERT _count_after = _count_before, 'дубликат не создаётся';

    -- ── 2. Новый актив по-прежнему заводится ────────────────────────────
    -- Запрет на переписывание не должен ломать саму возможность добавить
    -- актив, которого в справочнике ещё нет.
    _returned := put__ensure_crypto_asset(
        'ZZNEW', 'Новый актив', 'testnet', '', 6::smallint,
        '{"coingecko_id": "brand-new"}'::jsonb
    );

    ASSERT (_returned->>'id') IS NOT NULL, 'новый актив создаётся';
    ASSERT _returned->>'symbol' = 'ZZNEW', 'с присланным тикером';
    ASSERT _returned->>'name' = 'Новый актив', 'и присланным именем';
    ASSERT (_returned->>'decimals')::int = 6, 'и присланными decimals';

    SELECT count(*) INTO _count_after FROM crypto_assets;
    ASSERT _count_after = _count_before + 1, 'ровно одна новая строка';

    -- Повторный вызов для того же актива ничего не добавляет и не меняет.
    PERFORM put__ensure_crypto_asset('ZZNEW', 'Другое имя', 'testnet', '', 9::smallint, '{}'::jsonb);

    SELECT count(*) INTO _count_after FROM crypto_assets;
    ASSERT _count_after = _count_before + 1, 'повторный вызов не плодит строки';
    ASSERT (SELECT name FROM crypto_assets WHERE symbol = 'ZZNEW') = 'Новый актив',
        'и не переписывает только что созданную запись';

    -- ── 3. Валидация никуда не делась ───────────────────────────────────
    _guard := false;
    BEGIN
        PERFORM put__ensure_crypto_asset('не тикер', NULL, 'testnet', '', 8::smallint, '{}'::jsonb);
    EXCEPTION WHEN others THEN
        _guard := true; _err := SQLERRM;
    END;
    ASSERT _guard, 'мусорный тикер должен падать';
    ASSERT _err LIKE '%Unsupported crypto symbol%', format('ожидали отказ по тикеру, получили: %s', _err);

    _guard := false;
    BEGIN
        PERFORM put__ensure_crypto_asset('ZZBAD', NULL, 'testnet', '', 99::smallint, '{}'::jsonb);
    EXCEPTION WHEN others THEN
        _guard := true; _err := SQLERRM;
    END;
    ASSERT _guard, 'decimals вне диапазона должны падать';
    ASSERT _err LIKE '%decimals%', format('ожидали отказ по decimals, получили: %s', _err);

    -- ── 4. Привилегированный путь обновляет — он для ручного импорта ────
    -- Скрипты в budgeting/manual/ работают с базой напрямую и должны уметь
    -- править справочник. Проверяем, что эта возможность не потерялась.
    PERFORM put__upsert_crypto_asset(
        'ZZTEST', 'Исправленное имя', 'testnet', '', 4::smallint,
        '{"coingecko_id": "corrected-coin"}'::jsonb
    );

    SELECT name, decimals, metadata INTO _name, _decimals, _metadata
    FROM crypto_assets WHERE id = _victim_id;

    ASSERT _name = 'Исправленное имя', 'ручной импорт может править имя';
    ASSERT _decimals = 4, 'и decimals';
    ASSERT _metadata->>'coingecko_id' = 'corrected-coin', 'и источник цены';

    -- ── Уборка ──────────────────────────────────────────────────────────
    DELETE FROM crypto_assets WHERE symbol IN ('ZZTEST', 'ZZNEW');

    RAISE NOTICE 'crypto_assets: все проверки пройдены';
END
$$;
