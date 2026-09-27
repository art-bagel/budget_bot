CREATE OR REPLACE FUNCTION budgeting.put__manual_crypto_movement(
    _user_id bigint, _request_id uuid, _kind text, _payload jsonb,
    _operated_at date DEFAULT NULL, _fee jsonb DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql AS $function$
DECLARE
    _position record;
    _account record;
    _owner_key text;
    _prior record;
    _evidence jsonb;
    _commands jsonb;
    _day date := COALESCE(_operated_at, current_date);
    _time timestamptz;
    _order bigint;
    _result jsonb;
    _command_payload jsonb;
    _result_index integer := 0;
BEGIN
    SET search_path TO budgeting;
    IF _request_id IS NULL OR _kind NOT IN ('swap','transfer','borrow','repay','accrue_interest','liquidate','create_protocol','top_up_protocol','partial_close_protocol','close_protocol','fee','position_income','protocol_yield','group_lending') OR _kind IS NULL
       OR jsonb_typeof(_payload) IS DISTINCT FROM 'object' THEN
        RAISE EXCEPTION 'Некорректная ручная операция';
    END IF;
    IF _kind='create_protocol' THEN
        SELECT * INTO _position FROM crypto_protocol_positions WHERE false;
        SELECT * INTO _account FROM bank_accounts WHERE id=(_payload->>'investment_account_id')::bigint;
    ELSE
    IF _kind IN ('borrow','repay','accrue_interest','liquidate','top_up_protocol','partial_close_protocol','close_protocol','protocol_yield','group_lending') THEN
        SELECT * INTO _position FROM crypto_protocol_positions WHERE id=(_payload->>'position_id')::bigint;
    ELSE
        SELECT p.*, NULL::text AS position_type INTO _position FROM portfolio_positions p WHERE id=COALESCE(_payload->>'position_id',_payload->>'source_position_id')::bigint;
    END IF;
    IF _position.id IS NULL OR NOT budgeting.has__owner_access(
        _user_id,_position.owner_type,_position.owner_user_id,_position.owner_family_id) THEN
        RAISE EXCEPTION 'Нет доступа к исходной позиции';
    END IF;
    SELECT * INTO _account FROM bank_accounts WHERE id=_position.investment_account_id;
    END IF;
    IF _account.id IS NULL OR NOT budgeting.has__owner_access(_user_id,_account.owner_type,_account.owner_user_id,_account.owner_family_id) THEN
        RAISE EXCEPTION 'Нет доступа к счёту';
    END IF;
    IF _kind='create_protocol' AND COALESCE((_payload->>'borrowed_quantity')::numeric,0)>0 THEN _result_index:=1; END IF;
    _owner_key:=_account.owner_type||':'||CASE WHEN _account.owner_type='user'
        THEN _account.owner_user_id ELSE _account.owner_family_id END;
    -- The same lock as imports: receipt, ordering and all movements are one transaction.
    PERFORM pg_advisory_xact_lock(hashtextextended('crypto-source:'||_owner_key,0));
    _evidence:=jsonb_build_object('manual_kind',_kind,'request_payload',_payload,
        'requested_date',_operated_at,'fee',_fee);
    SELECT * INTO _prior FROM crypto_source_events WHERE owner_key=_owner_key
        AND source_namespace='manual-portfolio-v1' AND source_id=_request_id::text;
    IF NOT FOUND AND _kind IN ('accrue_interest','liquidate') AND _payload->>'external_id' IS NOT NULL THEN
        SELECT * INTO _prior FROM crypto_source_events WHERE owner_key=_owner_key
            AND source_namespace='manual-portfolio-v1'
            AND evidence->>'manual_kind'=_kind
            AND evidence->'request_payload'->>'position_id'=_payload->>'position_id'
            AND evidence->'request_payload'->>'external_id'=_payload->>'external_id';
    END IF;
    IF _prior.id IS NOT NULL THEN
        IF _prior.evidence IS DISTINCT FROM _evidence THEN
            RAISE EXCEPTION 'Этот запрос уже проведён с другими данными. Обновите историю перед исправлением';
        END IF;
        RETURN (_prior.result->'results'->_result_index)||jsonb_build_object('source_event_id',_prior.id);
    END IF;
    IF _kind IN ('accrue_interest','liquidate') AND EXISTS (
        SELECT 1 FROM crypto_liability_events WHERE protocol_position_id=_position.id
            AND external_id=_payload->>'external_id') THEN
        RAISE EXCEPTION 'Этот источник уже записан прежним механизмом. Проверьте историю перед повтором';
    END IF;
    IF _kind IN ('borrow','repay','accrue_interest','liquidate') AND
       COALESCE((_position.metadata->>'borrowed_quantity')::numeric,0)>0
       AND _position.metadata->>'funding_policy' IS DISTINCT FROM 'components' THEN
        RAISE EXCEPTION 'Существующий долг требует восстановления заёмных единиц перед изменением';
    END IF;
    IF NOT isfinite(_day) THEN RAISE EXCEPTION 'Некорректная дата операции'; END IF;
    IF EXISTS(SELECT 1 FROM portfolio_events e JOIN portfolio_positions p ON p.id=e.position_id
        WHERE p.owner_type=_account.owner_type
          AND p.owner_user_id IS NOT DISTINCT FROM _account.owner_user_id
          AND p.owner_family_id IS NOT DISTINCT FROM _account.owner_family_id
          AND p.asset_type_code='crypto' AND e.event_at>_day)
       OR EXISTS(SELECT 1 FROM crypto_source_events WHERE owner_key=_owner_key AND accounting_date>_day) THEN
        RAISE EXCEPTION 'После этой даты уже есть операции. Для изменения прошлого нужен пересчёт зависимой истории';
    END IF;
    -- Forms specify a day, not an on-chain timestamp. Append at the end of that UTC day.
    _time:=(_day::timestamp + interval '1 day' - interval '1 microsecond') AT TIME ZONE 'UTC';
    SELECT COALESCE(max(order_in_timestamp)+1,0) INTO _order FROM crypto_source_events
        WHERE owner_key=_owner_key AND occurred_at=_time;
    _command_payload:=CASE WHEN _kind='swap' THEN
            (_payload-'value_in_base'-'valuation_source')||jsonb_build_object('basis_policy','carry')
        WHEN _kind='borrow' THEN (_payload-'value_in_base')||jsonb_build_object('funding_policy','components')
        WHEN _kind='repay' THEN _payload-'value_in_base'
        WHEN _kind='accrue_interest' THEN (_payload-'external_id')||jsonb_build_object('value_in_base',0)
        WHEN _kind='liquidate' THEN _payload-'external_id'-'settlement_value_in_base'
        WHEN _kind='create_protocol' THEN _payload-'borrowed_crypto_asset_id'-'borrowed_quantity'-'borrowed_value_in_base'
        WHEN _kind='partial_close_protocol' THEN (_payload-'principal_value_in_base'-'secondary_value_in_base')
            ||jsonb_build_object('rewards_value_in_base',0,'secondary_rewards_value_in_base',0)
        WHEN _kind='close_protocol' THEN (_payload-'return_value_in_base'-'secondary_return_value_in_base')
            ||CASE WHEN _position.position_type='liquidity_pool' THEN jsonb_build_object('allocation_policy','net_composition') ELSE '{}'::jsonb END
        ELSE _payload END;
    IF _kind='create_protocol' THEN
        IF EXISTS(SELECT 1 FROM jsonb_object_keys(COALESCE(_payload->'metadata','{}'::jsonb)) k WHERE k NOT IN ('apr','pool_name')) THEN
            RAISE EXCEPTION 'Учётные поля позиции рассчитываются по операциям; вручную доступны APR и название пула';
        END IF;
        IF COALESCE((_payload->>'borrowed_quantity')::numeric,0)>0 AND
           (_payload->>'borrowed_crypto_asset_id' IS NULL OR _payload->>'position_type'<>'lending') THEN
            RAISE EXCEPTION 'Для начального займа нужны lending-позиция и монета долга';
        END IF;
        IF _payload->>'borrowed_crypto_asset_id' IS NOT NULL AND COALESCE((_payload->>'borrowed_quantity')::numeric,0)<=0 THEN
            RAISE EXCEPTION 'Укажите положительное количество начального займа';
        END IF;
    END IF;
    IF _kind='partial_close_protocol' AND _position.position_type='liquidity_pool' AND
       (COALESCE((_payload->>'principal_qty')::numeric,0)>0 OR COALESCE((_payload->>'secondary_principal_qty')::numeric,0)>0) THEN
        RAISE EXCEPTION 'Частичный выход LP требует доли погашенных LP-токенов. Пока доступен полный выход и отдельное получение наград';
    END IF;
    _commands:=jsonb_build_array(jsonb_build_object('kind',_kind,'payload',_command_payload));
    IF _result_index=1 THEN
        _commands:=_commands||jsonb_build_array(jsonb_build_object('kind','borrow','payload',jsonb_build_object(
            'position_id_from_command',0,'borrowed_crypto_asset_id',_payload->'borrowed_crypto_asset_id',
            'debt_qty',_payload->'borrowed_quantity','funding_policy','components','comment',_payload->'comment')));
    END IF;
    IF _fee IS NOT NULL THEN
        IF _kind='create_protocol' THEN
            _fee:=_fee||jsonb_build_object('link_protocol_position_id_from_command',0);
        ELSIF _kind IN ('borrow','repay','top_up_protocol','partial_close_protocol','close_protocol') THEN
            _fee:=_fee||jsonb_build_object('link_protocol_position_id',_position.id);
        END IF;
        _commands:=_commands||jsonb_build_array(jsonb_build_object('kind','fee','payload',_fee));
    END IF;
    _result:=budgeting.put__crypto_source_event(_user_id,_account.id,'manual-portfolio-v1',
        _request_id::text,_time,_order,_day,_commands,_evidence);
    RETURN (_result->'results'->_result_index)||jsonb_build_object('source_event_id',_result->'source_event_id');
END
$function$;
