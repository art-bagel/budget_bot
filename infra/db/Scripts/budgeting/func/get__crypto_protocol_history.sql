CREATE OR REPLACE FUNCTION budgeting.get__crypto_protocol_history(
    _user_id bigint, _position_id bigint, _limit integer DEFAULT 50, _offset integer DEFAULT 0
) RETURNS jsonb LANGUAGE plpgsql AS $function$
DECLARE
    _p budgeting.crypto_protocol_positions%ROWTYPE;
    _result jsonb;
BEGIN
    SET search_path TO budgeting;
    SELECT * INTO _p FROM crypto_protocol_positions WHERE id = _position_id;
    IF _p.id IS NULL OR NOT budgeting.has__owner_access(
        _user_id, _p.owner_type, _p.owner_user_id, _p.owner_family_id
    ) THEN
        RAISE EXCEPTION 'DeFi position unavailable';
    END IF;
    IF _limit NOT BETWEEN 1 AND 200 OR _offset < 0 THEN
        RAISE EXCEPTION 'Invalid history page';
    END IF;
    WITH initial_links AS (
        -- Historical imports created asset entries before the protocol id existed.
        -- Match the exact command result, never a date, symbol or protocol name.
        SELECT l.ledger_id
        FROM crypto_source_event_links l JOIN crypto_source_events s ON s.id=l.source_event_id
        WHERE l.ledger_table='portfolio_events'
          AND s.commands->l.command_index->>'kind'='create_protocol'
          AND s.result->'results'->l.command_index->>'id'=_position_id::text
    ), asset_rows AS (
        SELECT 'asset:'||e.id AS id, e.event_at, e.id AS sequence,
            CASE WHEN e.metadata->>'source_kind'='liquidation_funding_settlement'
                THEN 'external_expense' ELSE COALESCE(e.metadata->>'action', e.event_type) END AS kind,
            CASE WHEN e.metadata->>'source_kind'='liquidation_funding_settlement'
                THEN NULL::numeric ELSE e.quantity END AS quantity,
            COALESCE(p.metadata->>'asset_symbol',p.title) AS symbol,
            CASE WHEN e.metadata->>'source_kind'='liquidation_funding_settlement'
                THEN COALESCE((e.metadata->>'funding_interest_cost')::numeric,0)
                    + COALESCE((e.metadata->>'funding_confirmed_cost')::numeric,0)
                ELSE COALESCE(e.metadata->>'consumed_cost_basis',e.metadata->>'entry_value_in_base',
                    e.metadata->>'value_in_base')::numeric END AS cost_basis,
            e.comment
        FROM portfolio_events e JOIN portfolio_positions p ON p.id=e.position_id
        WHERE p.owner_type=_p.owner_type
          AND p.owner_user_id IS NOT DISTINCT FROM _p.owner_user_id
          AND p.owner_family_id IS NOT DISTINCT FROM _p.owner_family_id
          AND (e.metadata->>'protocol_position_id'=_position_id::text
            OR e.metadata->>'source_protocol_position_id'=_position_id::text
            OR e.id IN (SELECT ledger_id FROM initial_links))
    ), rows AS (
        SELECT * FROM asset_rows
        UNION ALL
        SELECT 'debt:'||e.id, e.event_at, e.id, e.event_kind,
            abs(e.quantity), a.symbol, NULL::numeric,
            CASE WHEN e.event_kind='liquidation' THEN 'Погашение долга за счёт залога' ELSE NULL END
        FROM crypto_liability_events e JOIN crypto_assets a ON a.id=e.crypto_asset_id
        WHERE e.protocol_position_id=_position_id AND e.portfolio_event_id IS NULL
        UNION ALL
        SELECT 'accrual:'||e.id,e.event_at,e.id,'collateral_accrual',
            e.collateral_quantity,_p.asset_symbol,NULL::numeric,NULL::text
        FROM crypto_protocol_accrual_events e
        WHERE e.protocol_position_id=_position_id AND e.collateral_quantity>0
        UNION ALL
        SELECT 'liquidation-collateral:'||e.id,e.event_at,e.id,'collateral_liquidation',
            (e.metadata->'result'->>'collateral_quantity')::numeric,COALESCE(a.symbol,_p.asset_symbol),
            (e.metadata->'result'->>'collateral_cost_consumed_in_base')::numeric,
            'Стоимость на момент изъятия. Часть погашает тело займа и переносится его держателям; вся сумма не является расходом.'::text
        FROM crypto_liability_events e LEFT JOIN crypto_assets a ON a.id=(e.metadata->'result'->>'collateral_asset_id')::bigint
        WHERE (e.protocol_position_id=_position_id OR e.metadata->'result'->>'collateral_position_id'=_position_id::text) AND e.event_kind='liquidation'
        UNION ALL
        SELECT 'liquidation-principal:'||e.id,e.event_at,e.id,'liquidation_principal',
            abs(e.quantity)-abs(e.interest_quantity),a.symbol,
            (e.metadata->>'funding_principal_cost')::numeric,
            'Входит в погашенный долг. Эта стоимость распределена между активами, DeFi и прежними расходами, содержащими единицы займа; это не новый расход. Сумма зафиксирована на дату операции.'::text
        FROM crypto_liability_events e JOIN crypto_assets a ON a.id=e.crypto_asset_id
        WHERE e.protocol_position_id=_position_id AND e.event_kind='liquidation'
        UNION ALL
        SELECT 'liquidation-interest:'||e.id,e.event_at,e.id,'liquidation_interest',
            abs(e.interest_quantity),a.symbol,NULL::numeric,
            'Входит в погашенный долг; не дополнительное списание.'::text
        FROM crypto_liability_events e JOIN crypto_assets a ON a.id=e.crypto_asset_id
        WHERE e.protocol_position_id=_position_id AND e.event_kind='liquidation'
        UNION ALL
        SELECT 'liquidation-fee:'||e.id,e.event_at,e.id,'liquidation_fee',
            CASE WHEN e.metadata->'request'->>'collateral_fee_known'='true' THEN (e.metadata->'request'->>'collateral_fee_quantity')::numeric
                ELSE NULLIF((e.metadata->'request'->>'collateral_fee_quantity')::numeric,0) END,
            COALESCE(a.symbol,_p.asset_symbol),NULL::numeric,
            CASE WHEN COALESCE((e.metadata->'request'->>'collateral_fee_quantity')::numeric,0)>0
                THEN 'Входит в изъятый залог; не дополнительное списание.'
                WHEN e.metadata->'request'->>'collateral_fee_known'='true' THEN 'Нулевой штраф подтверждён при ручном вводе.'
                ELSE 'Количество отдельно не установлено. Ноль в расчёте не подтверждает отсутствие штрафа; себестоимость распределена условно без отдельной штрафной части.' END
        FROM crypto_liability_events e LEFT JOIN crypto_assets a ON a.id=(e.metadata->'result'->>'collateral_asset_id')::bigint
        WHERE (e.protocol_position_id=_position_id OR e.metadata->'result'->>'collateral_position_id'=_position_id::text) AND e.event_kind='liquidation'
        UNION ALL
        SELECT 'custody:'||s.id||':'||c.ordinality,s.accounting_date,s.id,
            CASE WHEN c.value->'payload'->>'to_custody'='main' THEN 'lp_return' ELSE 'lp_farm' END,
            (c.value->'payload'->>'quantity')::numeric,'LP',NULL::numeric,NULL::text
        FROM crypto_source_events s CROSS JOIN LATERAL jsonb_array_elements(s.commands) WITH ORDINALITY c
        WHERE c.value->>'kind'='lp_custody'
          AND c.value->'payload'->>'position_id'=_position_id::text
          AND s.owner_key=CASE WHEN _p.owner_type='user' THEN 'user:'||_p.owner_user_id ELSE 'family:'||_p.owner_family_id END
        UNION ALL
        -- Older manually created positions may have no immutable opening link.
        -- Do not pass their current balance off as the original deposit.
        SELECT 'opening:'||_p.id,_p.deposited_at,0,'opening',NULL::numeric,
            _p.asset_symbol,NULL::numeric,'Размещение зарегистрировано; состав первоначальной операции не сохранён.'
        WHERE NOT EXISTS (SELECT 1 FROM asset_rows WHERE kind='stake_to_protocol')
    ), ordered AS (
        SELECT r.*, (r.id NOT LIKE 'asset:%' OR budgeting.is__crypto_audit_comment('portfolio_events', split_part(r.id,':',2)::bigint)) AS comment_is_system,
            COALESCE(s.occurred_at,r.event_at::timestamptz) AS sort_at,
            COALESCE(s.order_in_timestamp,0) AS sort_order,
            COALESCE(l.command_index,0) AS sort_command
        FROM rows r
        LEFT JOIN crypto_source_event_links l ON l.ledger_id=split_part(r.id,':',2)::bigint
          AND l.ledger_table=CASE split_part(r.id,':',1)
            WHEN 'asset' THEN 'portfolio_events' WHEN 'debt' THEN 'crypto_liability_events'
            WHEN 'liquidation-collateral' THEN 'crypto_liability_events'
            WHEN 'liquidation-interest' THEN 'crypto_liability_events'
            WHEN 'liquidation-principal' THEN 'crypto_liability_events'
            WHEN 'liquidation-fee' THEN 'crypto_liability_events'
            WHEN 'accrual' THEN 'crypto_protocol_accrual_events' END
        LEFT JOIN crypto_source_events s ON s.id=COALESCE(l.source_event_id,
            CASE WHEN r.id LIKE 'custody:%' THEN split_part(r.id,':',2)::bigint END)
    ), page AS (
        SELECT * FROM ordered ORDER BY event_at DESC,sort_at DESC,sort_order DESC,sort_command DESC,sequence DESC,id DESC
        LIMIT _limit OFFSET _offset
    )
    SELECT jsonb_build_object('total',(SELECT count(*) FROM rows),
        'entries',COALESCE((SELECT jsonb_agg(to_jsonb(page)-'sort_at'-'sort_order'-'sort_command' ORDER BY event_at DESC,sort_at DESC,sort_order DESC,sort_command DESC,sequence DESC,id DESC) FROM page),'[]'::jsonb))
    INTO _result;
    RETURN _result;
END
$function$;
