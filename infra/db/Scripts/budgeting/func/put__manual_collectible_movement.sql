-- Collection trades share the crypto journal: retries and dependent correction
-- must preserve both the item and the lots used to pay for it.
CREATE OR REPLACE FUNCTION budgeting.put__manual_collectible_movement(
    _user_id bigint, _request_id uuid, _kind text, _payload jsonb, _day date DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql AS $f$
DECLARE
    a record; p record; prior record; owner_scope text; evidence jsonb;
    day date := COALESCE(_day,current_date); stamp timestamptz; ord bigint; result jsonb;
BEGIN
    SET search_path TO budgeting;
    IF _request_id IS NULL OR _kind IS NULL OR _kind NOT IN ('collectible_details','collectible_transfer','collectible_coin_fee','collectible_coin_topup','collectible_receive','collectible_buy','collectible_sell','collectible_fiat_buy','collectible_fiat_close','collectible_fiat_partial','collectible_fiat_topup','collectible_fiat_fee')
       OR jsonb_typeof(_payload) IS DISTINCT FROM 'object' OR NOT isfinite(day) THEN
        RAISE EXCEPTION 'Некорректная операция коллекции';
    END IF;
    IF _kind = 'collectible_transfer' THEN
        SELECT * INTO a FROM bank_accounts WHERE id IN ((_payload->>'from_account_id')::bigint,(_payload->>'to_account_id')::bigint) AND investment_asset_type='collectible' ORDER BY id LIMIT 1;
    ELSIF _kind IN ('collectible_receive','collectible_buy','collectible_fiat_buy') THEN
        SELECT * INTO a FROM bank_accounts WHERE id=(_payload->>'investment_account_id')::bigint;
    ELSE
        SELECT * INTO p FROM portfolio_positions WHERE id=(_payload->>'position_id')::bigint;
        IF p.asset_type_code IS DISTINCT FROM 'collectible' THEN RAISE EXCEPTION 'Предмет не найден'; END IF;
        SELECT * INTO a FROM bank_accounts WHERE id=p.investment_account_id;
    END IF;
    IF a.id IS NULL OR NOT a.is_active OR a.investment_asset_type<>'collectible'
       OR NOT has__owner_access(_user_id,a.owner_type,a.owner_user_id,a.owner_family_id) THEN
        RAISE EXCEPTION 'Нет доступа к счёту коллекций';
    END IF;
    owner_scope:=a.owner_type||':'||CASE WHEN a.owner_type='user' THEN a.owner_user_id ELSE a.owner_family_id END;
    PERFORM pg_advisory_xact_lock(hashtextextended('crypto-source:'||owner_scope,0));
    evidence:=jsonb_build_object('manual_kind',_kind,'request_payload',_payload,'requested_date',_day);
    SELECT * INTO prior FROM crypto_source_events s WHERE s.owner_key=owner_scope
        AND s.source_namespace='manual-collection-v1' AND s.source_id=_request_id::text;
    IF prior.id IS NOT NULL THEN
        IF prior.evidence IS DISTINCT FROM evidence THEN RAISE EXCEPTION 'Запрос уже проведён с другими данными'; END IF;
        RETURN prior.result->'results'->0;
    END IF;
    IF EXISTS(SELECT 1 FROM crypto_source_events s WHERE s.owner_key=owner_scope AND accounting_date>day)
       OR EXISTS(SELECT 1 FROM operations o WHERE o.owner_type=a.owner_type
          AND o.owner_user_id IS NOT DISTINCT FROM a.owner_user_id
          AND o.owner_family_id IS NOT DISTINCT FROM a.owner_family_id AND operated_on>day) THEN
        RAISE EXCEPTION 'После этой даты уже есть операции. Для изменения прошлого нужен пересчёт';
    END IF;
    stamp:=(day::timestamp + interval '1 day' - interval '1 microsecond') AT TIME ZONE 'UTC';
    SELECT COALESCE(max(order_in_timestamp)+1,0) INTO ord FROM crypto_source_events s
        WHERE s.owner_key=owner_scope AND occurred_at=stamp;
    result:=put__crypto_source_event(_user_id,a.id,'manual-collection-v1',_request_id::text,
        stamp,ord,day,jsonb_build_array(jsonb_build_object('kind',_kind,'payload',_payload)),evidence);
    RETURN result->'results'->0;
END $f$;
