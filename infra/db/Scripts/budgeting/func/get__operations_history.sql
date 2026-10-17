DROP FUNCTION IF EXISTS budgeting.get__operations_history(bigint, integer, integer, text);
DROP FUNCTION IF EXISTS budgeting.get__operations_history(bigint, integer, integer, text, text);
DROP FUNCTION IF EXISTS budgeting.get__operations_history(bigint, integer, integer, text, text, bigint[], bigint[]);
-- The history lists live operations, manual journal events without an operations
-- row, and frozen rows of cancelled journal operations (cancelled_operations).
-- _operation_ids / _source_event_ids (internal, not exposed by the API) render
-- just those rows: put__delete_crypto_source keeps them before the rollback.
CREATE FUNCTION budgeting.get__operations_history(
    _user_id bigint,
    _limit integer DEFAULT 20,
    _offset integer DEFAULT 0,
    _operation_type text DEFAULT NULL,
    _investment_asset_type text DEFAULT NULL,
    _operation_ids bigint[] DEFAULT NULL,
    _source_event_ids bigint[] DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
AS $function$
DECLARE
    _result jsonb;
    _normalized_operation_type text;
    _normalized_investment_asset_type text;
    _family_id bigint;
    _snapshot boolean := _operation_ids IS NOT NULL OR _source_event_ids IS NOT NULL;
BEGIN
    SET search_path TO budgeting;

    _family_id := budgeting.get__user_family_id(_user_id);
    _normalized_operation_type := nullif(trim(_operation_type), '');
    _normalized_investment_asset_type := nullif(trim(_investment_asset_type), '');
    IF _normalized_investment_asset_type = 'all' THEN
        _normalized_investment_asset_type := NULL;
    END IF;

    IF _limit IS NULL OR _limit <= 0 THEN
        RAISE EXCEPTION 'History limit must be positive';
    END IF;

    IF _offset IS NULL OR _offset < 0 THEN
        RAISE EXCEPTION 'History offset must be zero or positive';
    END IF;

    IF _normalized_operation_type IS NOT NULL THEN
        PERFORM 1
        FROM unnest(string_to_array(_normalized_operation_type, ',')) AS t(val)
        WHERE trim(val) NOT IN (
            'investment',
            'banking',
            'income',
            'allocate',
            'group_allocate',
            'exchange',
            'expense',
            'account_transfer',
            'investment_trade',
            'investment_income',
            'investment_adjustment',
            'investment_journal',
            'reversal',
            'cancelled'
        );
        IF FOUND THEN
            RAISE EXCEPTION 'Unsupported operation type filter: %', _normalized_operation_type;
        END IF;
    END IF;

    IF _normalized_investment_asset_type IS NOT NULL
       AND _normalized_investment_asset_type NOT IN ('security', 'deposit', 'crypto', 'other', 'collectible', 'currency') THEN
        RAISE EXCEPTION 'Unsupported investment asset type filter: %', _normalized_investment_asset_type;
    END IF;

    -- total_count is computed once via a window function to avoid a second
    -- full-scan query for pagination metadata.
    WITH account_movements AS (
        SELECT pe.linked_operation_id AS operation_id, pp.investment_account_id AS account_id
        FROM portfolio_events pe
        JOIN portfolio_positions pp ON pp.id = pe.position_id
        WHERE pe.linked_operation_id IS NOT NULL
        UNION ALL
        SELECT operation_id, bank_account_id FROM bank_entries
        UNION ALL
        SELECT operation_id, bank_account_id FROM crypto_bank_entries
    ), account_visibility AS (
        SELECT am.operation_id,
               bool_or(ba.is_archived) AS has_archived,
               bool_or(NOT ba.is_archived) AS has_visible
        FROM account_movements am
        JOIN bank_accounts ba ON ba.id = am.account_id
        JOIN operations scoped_operation ON scoped_operation.id = am.operation_id
        WHERE (scoped_operation.owner_type = 'user' AND scoped_operation.owner_user_id = _user_id)
           OR (scoped_operation.owner_type = 'family' AND scoped_operation.owner_family_id = _family_id)
        GROUP BY am.operation_id
    ), live_operations AS (
        SELECT o.id, o.operated_on, o.created_at
        FROM operations o
        LEFT JOIN account_visibility av ON av.operation_id = o.id
        WHERE (NOT _snapshot OR COALESCE(o.id = ANY(_operation_ids), false))
          AND (
                (o.owner_type = 'user' AND o.owner_user_id = _user_id)
                OR
                (o.owner_type = 'family' AND o.owner_family_id = _family_id)
              )
          -- Hide only movements entirely inside reconstruction accounts. Bank purchases,
          -- withdrawals and transfers touching a real wallet remain visible.
          -- Apply before pagination so totals and pages agree.
          AND NOT (COALESCE(av.has_archived, false) AND NOT COALESCE(av.has_visible, false))
          AND (_normalized_operation_type IS NOT NULL OR o.type <> 'reversal')
          AND (
                _normalized_operation_type IS NULL
                OR (
                    _normalized_operation_type = 'investment'
                    AND (
                        o.type IN ('investment_trade', 'investment_income', 'investment_adjustment')
                        OR EXISTS (
                            SELECT 1
                            FROM bank_entries be_filter
                            JOIN bank_accounts ba_filter
                              ON ba_filter.id = be_filter.bank_account_id
                            WHERE be_filter.operation_id = o.id
                              AND ba_filter.account_kind = 'investment'
                        )
                    )
                )
                OR (
                    _normalized_operation_type = 'banking'
                    AND (
                        o.type IN ('allocate', 'group_allocate')
                        OR EXISTS (
                            SELECT 1
                            FROM bank_entries be_filter
                            JOIN bank_accounts ba_filter
                              ON ba_filter.id = be_filter.bank_account_id
                            WHERE be_filter.operation_id = o.id
                              AND ba_filter.account_kind <> 'investment'
                        )
                        OR EXISTS (
                            SELECT 1
                            FROM crypto_bank_entries cbe_filter
                            JOIN bank_accounts cba_filter
                              ON cba_filter.id = cbe_filter.bank_account_id
                            WHERE cbe_filter.operation_id = o.id
                              AND cba_filter.account_kind <> 'investment'
                        )
                    )
                )
                OR (
                    _normalized_operation_type = 'cancelled'
                    AND EXISTS (
                        SELECT 1
                        FROM operations ro_filter
                        WHERE ro_filter.reversal_of_operation_id = o.id
                    )
                )
                OR (
                    _normalized_operation_type NOT IN ('investment', 'banking', 'cancelled')
                    AND o.type = ANY(string_to_array(_normalized_operation_type, ','))
                )
          )
          AND (
                _normalized_investment_asset_type IS NULL
                OR EXISTS (
                    SELECT 1
                    FROM portfolio_events pe_asset_filter
                    JOIN portfolio_positions pp_asset_filter
                      ON pp_asset_filter.id = pe_asset_filter.position_id
                    WHERE pe_asset_filter.linked_operation_id = o.id
                      AND pp_asset_filter.asset_type_code = _normalized_investment_asset_type
                )
                OR EXISTS (
                    SELECT 1
                    FROM bank_entries be_asset_filter
                    JOIN bank_accounts ba_asset_filter
                      ON ba_asset_filter.id = be_asset_filter.bank_account_id
                    WHERE be_asset_filter.operation_id = o.id
                      AND ba_asset_filter.account_kind = 'investment'
                      AND (ba_asset_filter.investment_asset_type = _normalized_investment_asset_type OR (_normalized_investment_asset_type = 'other' AND ba_asset_filter.investment_asset_type = 'currency'))
                )
                OR EXISTS (
                    SELECT 1
                    FROM crypto_bank_entries cbe_asset_filter
                    JOIN bank_accounts cba_asset_filter
                      ON cba_asset_filter.id = cbe_asset_filter.bank_account_id
                    WHERE cbe_asset_filter.operation_id = o.id
                      AND cba_asset_filter.account_kind = 'investment'
                      AND (cba_asset_filter.investment_asset_type = _normalized_investment_asset_type OR (_normalized_investment_asset_type = 'other' AND cba_asset_filter.investment_asset_type = 'currency'))
                )
          )
    ),
    -- Manual journal events that wrote no operations row (DeFi fees, protocol
    -- yield...). Item parameter edits are not financial operations.
    journal_events AS (
        SELECT
            s.id,
            COALESCE((s.evidence->>'requested_date')::date, (s.commands->0->'payload'->>'operated_at')::date, s.accounting_date) AS operated_on,
            s.created_at,
            s.created_by_user_id,
            s.commands,
            a.owner_type,
            a.owner_user_id,
            a.owner_family_id
        FROM crypto_source_events s
        JOIN bank_accounts a ON a.id = s.anchor_account_id
        WHERE s.source_namespace IN ('manual-portfolio-v1', 'manual-collection-v1')
          AND s.reversible
          AND NOT a.is_archived
          AND ((a.owner_type = 'user' AND a.owner_user_id = _user_id)
               OR (a.owner_type = 'family' AND a.owner_family_id = _family_id))
          AND (NOT _snapshot OR COALESCE(s.id = ANY(_source_event_ids), false))
          AND NOT EXISTS (
              SELECT 1 FROM crypto_source_event_links l
              WHERE l.source_event_id = s.id AND l.ledger_table = 'operations')
          AND EXISTS (
              SELECT 1 FROM jsonb_array_elements(s.commands) c
              WHERE c->>'kind' <> 'collectible_details')
          AND (
                _normalized_operation_type IS NULL
                OR _normalized_operation_type = 'investment'
                OR (_normalized_operation_type NOT IN ('investment', 'banking', 'cancelled')
                    AND 'investment_journal' = ANY(string_to_array(_normalized_operation_type, ',')))
          )
          AND (
                _normalized_investment_asset_type IS NULL
                OR a.investment_asset_type = _normalized_investment_asset_type
                OR (_normalized_investment_asset_type = 'other' AND a.investment_asset_type = 'currency')
          )
    ),
    -- Cancelled journal operations: filters were evaluated by this query before the rollback.
    snapshots AS (
        SELECT co.id, co.operated_on, co.created_at, co.item
        FROM cancelled_operations co
        WHERE NOT _snapshot
          AND co.item IS NOT NULL
          AND ((co.owner_type = 'user' AND co.owner_user_id = _user_id)
               OR (co.owner_type = 'family' AND co.owner_family_id = _family_id))
          AND (
                _normalized_operation_type IS NULL
                OR _normalized_operation_type = 'cancelled'
                OR (_normalized_operation_type = 'investment' AND co.is_investment)
                OR (_normalized_operation_type = 'banking' AND co.is_banking)
                OR (_normalized_operation_type NOT IN ('investment', 'banking', 'cancelled')
                    AND co.item->>'type' = ANY(string_to_array(_normalized_operation_type, ',')))
          )
          AND (_normalized_investment_asset_type IS NULL OR _normalized_investment_asset_type = ANY(co.asset_types))
    ),
    page AS (
        SELECT
            u.kind,
            u.id,
            row_number() OVER (ORDER BY u.operated_on DESC, u.created_at DESC, u.id DESC) AS ord,
            count(*) OVER () AS total_count
        FROM (
            SELECT 'op'::text AS kind, id, operated_on, created_at FROM live_operations
            UNION ALL
            SELECT 'journal', id, operated_on, created_at FROM journal_events
            UNION ALL
            SELECT 'snapshot', id, operated_on, created_at FROM snapshots
        ) u
        ORDER BY u.operated_on DESC, u.created_at DESC, u.id DESC
        LIMIT _limit OFFSET _offset
    ),
    selected_operations AS (
        SELECT
            o.id,
            o.type,
            o.comment,
            o.operated_on,
            o.created_at,
            o.reversal_of_operation_id,
            o.actor_user_id,
            actor.username AS actor_username,
            o.owner_type,
            o.owner_user_id,
            o.owner_family_id,
            EXISTS (
                SELECT 1
                FROM operations ro
                WHERE ro.reversal_of_operation_id = o.id
            ) AS has_reversal,
            ins.name AS income_source_name,
            p.ord,
            p.total_count
        FROM page p
        JOIN operations o ON o.id = p.id
        LEFT JOIN users actor
          ON actor.id = o.actor_user_id
        LEFT JOIN income_sources ins
          ON ins.id = o.income_source_id
        WHERE p.kind = 'op'
    ),
    fiat_bank_entries AS (
        SELECT
            be.operation_id,
            be.id AS sort_id,
            jsonb_build_object(
                'asset_type', 'fiat',
                'bank_account_id', be.bank_account_id,
                'bank_account_name', ba.name,
                'bank_account_owner_type', ba.owner_type,
                'bank_account_kind', ba.account_kind,
                'currency_code', be.currency_code,
                'crypto_asset_id', NULL,
                'network_code', NULL,
                'amount', be.amount
            ) AS entry
        FROM bank_entries be
        JOIN bank_accounts ba
          ON ba.id = be.bank_account_id
        JOIN selected_operations so
          ON so.id = be.operation_id
        WHERE NOT ba.is_archived
    ),
    crypto_bank_entries_rows AS (
        SELECT
            cbe.operation_id,
            cbe.id AS sort_id,
            jsonb_build_object(
                'asset_type', 'crypto',
                'bank_account_id', cbe.bank_account_id,
                'bank_account_name', ba.name,
                'bank_account_owner_type', ba.owner_type,
                'bank_account_kind', ba.account_kind,
                'currency_code', ca.symbol,
                'crypto_asset_id', ca.id,
                'network_code', ca.network_code,
                'amount', cbe.amount
            ) AS entry
        FROM crypto_bank_entries cbe
        JOIN bank_accounts ba
          ON ba.id = cbe.bank_account_id
        JOIN crypto_assets ca
          ON ca.id = cbe.crypto_asset_id
        JOIN selected_operations so
          ON so.id = cbe.operation_id
        WHERE NOT ba.is_archived
    ),
    bank_entry_rows AS (
        SELECT * FROM fiat_bank_entries
        UNION ALL
        SELECT * FROM crypto_bank_entries_rows
    ),
    bank_agg AS (
        SELECT
            operation_id,
            jsonb_agg(
                entry
                ORDER BY sort_id
            ) AS bank_entries
        FROM bank_entry_rows
        GROUP BY operation_id
    ),
    budget_agg AS (
        SELECT
            bue.operation_id,
            jsonb_agg(
                jsonb_build_object(
                    'category_id', c.id,
                    'category_name', CASE
                        WHEN c.kind = 'system' AND c.name = 'Unallocated' AND c.owner_type = 'user' THEN 'Личный свободный остаток'
                        WHEN c.kind = 'system' AND c.name = 'Unallocated' AND c.owner_type = 'family' THEN 'Семейный свободный остаток'
                        ELSE c.name
                    END,
                    'category_kind', c.kind,
                    'category_owner_type', c.owner_type,
                    'currency_code', bue.currency_code,
                    'amount', bue.amount
                )
                ORDER BY bue.id
            ) AS budget_entries
        FROM budget_entries bue
        JOIN categories c
          ON c.id = bue.category_id
        JOIN selected_operations so
          ON so.id = bue.operation_id
        GROUP BY bue.operation_id
    ),
    portfolio_event_targets AS (
        SELECT 'op'::text AS kind, so.id AS target_id, pe.id AS event_id
        FROM portfolio_events pe
        JOIN selected_operations so
          ON so.id = pe.linked_operation_id
        UNION ALL
        SELECT 'journal', p.id, l.ledger_id
        FROM page p
        JOIN crypto_source_event_links l
          ON l.source_event_id = p.id AND l.ledger_table = 'portfolio_events'
        WHERE p.kind = 'journal'
    ),
    portfolio_event_agg AS (
        SELECT
            t.kind,
            t.target_id,
            jsonb_agg(
                jsonb_build_object(
                    'id', pe.id,
                    'position_id', pe.position_id,
                    'event_type', pe.event_type,
                    'event_at', pe.event_at,
                    'quantity', pe.quantity,
                    'amount', pe.amount,
                    'currency_code', pe.currency_code,
                    'linked_operation_id', pe.linked_operation_id,
                    'comment', pe.comment,
                    'comment_is_system', budgeting.is__crypto_audit_comment('portfolio_events', pe.id),
                    'metadata', pe.metadata,
                    'position_title', pp.title,
                    'position_asset_type_code', pp.asset_type_code,
                    'position_metadata', pp.metadata,
                    'investment_account_id', pp.investment_account_id,
                    'investment_account_name', ba.name,
                    'investment_account_owner_type', ba.owner_type,
                    'created_by_user_id', pe.created_by_user_id,
                    'created_at', pe.created_at
                )
                ORDER BY pe.event_at, pe.id
            ) AS portfolio_events
        FROM portfolio_event_targets t
        JOIN portfolio_events pe
          ON pe.id = t.event_id
        JOIN portfolio_positions pp
          ON pp.id = pe.position_id
        JOIN bank_accounts ba
          ON ba.id = pp.investment_account_id
        WHERE NOT ba.is_archived
        GROUP BY t.kind, t.target_id
    ),
    items AS (
        SELECT
            jsonb_build_object(
                'operation_id', so.id,
                'type', so.type,
                'comment', so.comment,
                'comment_is_system', budgeting.is__crypto_audit_comment('operations', so.id),
                'operated_at', so.operated_on,
                'created_at', so.created_at,
                'reversal_of_operation_id', so.reversal_of_operation_id,
                'has_reversal', so.has_reversal,
                'actor_user_id', so.actor_user_id,
                'actor_username', so.actor_username,
                'owner_type', so.owner_type,
                'owner_user_id', so.owner_user_id,
                'owner_family_id', so.owner_family_id,
                'income_source_name', so.income_source_name,
                'bank_entries', COALESCE(ba.bank_entries, '[]'::jsonb),
                'budget_entries', COALESCE(bga.budget_entries, '[]'::jsonb),
                'portfolio_events', COALESCE(pea.portfolio_events, '[]'::jsonb)
            ) AS item,
            so.ord,
            so.total_count
        FROM selected_operations so
        LEFT JOIN bank_agg ba
          ON ba.operation_id = so.id
        LEFT JOIN budget_agg bga
          ON bga.operation_id = so.id
        LEFT JOIN portfolio_event_agg pea
          ON pea.kind = 'op' AND pea.target_id = so.id
        UNION ALL
        SELECT
            jsonb_build_object(
                'operation_id', NULL,
                'source_event_id', je.id,
                'type', 'investment_journal',
                'comment', NULL,
                'comment_is_system', false,
                'operated_at', je.operated_on,
                'created_at', je.created_at,
                'reversal_of_operation_id', NULL,
                'has_reversal', false,
                'actor_user_id', je.created_by_user_id,
                'actor_username', actor.username,
                'owner_type', je.owner_type,
                'owner_user_id', je.owner_user_id,
                'owner_family_id', je.owner_family_id,
                'income_source_name', NULL,
                'bank_entries', '[]'::jsonb,
                'budget_entries', '[]'::jsonb,
                'portfolio_events', COALESCE(pea.portfolio_events, '[]'::jsonb),
                'commands', (
                    SELECT jsonb_agg(jsonb_build_object(
                        'kind', c->>'kind',
                        'context', COALESCE(cpp.protocol_name, pos.title, c->'payload'->>'title', ca.symbol)
                    ) ORDER BY ord)
                    FROM jsonb_array_elements(je.commands) WITH ORDINALITY v(c, ord)
                    LEFT JOIN portfolio_positions pos
                      ON pos.id = COALESCE(c->'payload'->>'source_position_id', c->'payload'->>'position_id')::bigint
                     AND c->>'kind' NOT IN ('borrow', 'repay', 'liquidate', 'accrue_interest', 'protocol_yield',
                         'close_protocol', 'partial_close_protocol', 'top_up_protocol', 'group_lending',
                         'lp_snapshot', 'lp_withdraw', 'lp_reward')
                    LEFT JOIN crypto_protocol_positions cpp
                      ON cpp.id = (c->'payload'->>'position_id')::bigint
                     AND c->>'kind' IN ('borrow', 'repay', 'liquidate', 'accrue_interest', 'protocol_yield',
                         'close_protocol', 'partial_close_protocol', 'top_up_protocol', 'group_lending',
                         'lp_snapshot', 'lp_withdraw', 'lp_reward')
                    LEFT JOIN crypto_assets ca
                      ON ca.id = COALESCE(c->'payload'->>'crypto_asset_id', c->'payload'->>'to_crypto_asset_id')::bigint
                )
            ),
            p.ord,
            p.total_count
        FROM page p
        JOIN journal_events je ON je.id = p.id
        LEFT JOIN users actor ON actor.id = je.created_by_user_id
        LEFT JOIN portfolio_event_agg pea
          ON pea.kind = 'journal' AND pea.target_id = je.id
        WHERE p.kind = 'journal'
        UNION ALL
        -- Read-time flags: older snapshots never need a rewrite.
        SELECT sn.item || jsonb_build_object('has_reversal', true, 'is_cancelled', true), p.ord, p.total_count
        FROM page p
        JOIN snapshots sn ON sn.id = p.id
        WHERE p.kind = 'snapshot'
    )
    SELECT jsonb_build_object(
        'items',       COALESCE((SELECT jsonb_agg(item ORDER BY ord) FROM items), '[]'::jsonb),
        'total_count', COALESCE((SELECT total_count FROM items LIMIT 1), 0),
        'limit',       _limit,
        'offset',      _offset
    )
    INTO _result;

    RETURN _result;
END
$function$;
