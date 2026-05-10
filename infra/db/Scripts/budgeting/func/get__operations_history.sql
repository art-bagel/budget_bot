DROP FUNCTION IF EXISTS budgeting.get__operations_history(bigint, integer, integer, text);
DROP FUNCTION IF EXISTS budgeting.get__operations_history(bigint, integer, integer, text, text);
CREATE FUNCTION budgeting.get__operations_history(
    _user_id bigint,
    _limit integer DEFAULT 20,
    _offset integer DEFAULT 0,
    _operation_type text DEFAULT NULL,
    _investment_asset_type text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
AS $function$
DECLARE
    _result jsonb;
    _normalized_operation_type text;
    _normalized_investment_asset_type text;
    _family_id bigint;
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
            'reversal',
            'cancelled'
        );
        IF FOUND THEN
            RAISE EXCEPTION 'Unsupported operation type filter: %', _normalized_operation_type;
        END IF;
    END IF;

    IF _normalized_investment_asset_type IS NOT NULL
       AND _normalized_investment_asset_type NOT IN ('security', 'deposit', 'crypto', 'other') THEN
        RAISE EXCEPTION 'Unsupported investment asset type filter: %', _normalized_investment_asset_type;
    END IF;

    -- total_count is computed once via a window function to avoid a second
    -- full-scan query for pagination metadata.
    WITH selected_operations AS (
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
            count(*) OVER () AS total_count
        FROM operations o
        LEFT JOIN users actor
          ON actor.id = o.actor_user_id
        LEFT JOIN income_sources ins
          ON ins.id = o.income_source_id
        WHERE (
                (o.owner_type = 'user' AND o.owner_user_id = _user_id)
                OR
                (o.owner_type = 'family' AND o.owner_family_id = _family_id)
              )
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
                      AND ba_asset_filter.investment_asset_type = _normalized_investment_asset_type
                )
                OR EXISTS (
                    SELECT 1
                    FROM crypto_bank_entries cbe_asset_filter
                    JOIN bank_accounts cba_asset_filter
                      ON cba_asset_filter.id = cbe_asset_filter.bank_account_id
                    WHERE cbe_asset_filter.operation_id = o.id
                      AND cba_asset_filter.account_kind = 'investment'
                      AND cba_asset_filter.investment_asset_type = _normalized_investment_asset_type
                )
          )
        ORDER BY o.operated_on DESC, o.created_at DESC, o.id DESC
        LIMIT _limit OFFSET _offset
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
    portfolio_event_agg AS (
        SELECT
            pe.linked_operation_id AS operation_id,
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
        FROM portfolio_events pe
        JOIN portfolio_positions pp
          ON pp.id = pe.position_id
        JOIN bank_accounts ba
          ON ba.id = pp.investment_account_id
        JOIN selected_operations so
          ON so.id = pe.linked_operation_id
        WHERE pe.linked_operation_id IS NOT NULL
        GROUP BY pe.linked_operation_id
    ),
    items AS (
        SELECT
            jsonb_build_object(
                'operation_id', so.id,
                'type', so.type,
                'comment', so.comment,
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
            so.total_count
        FROM selected_operations so
        LEFT JOIN bank_agg ba
          ON ba.operation_id = so.id
        LEFT JOIN budget_agg bga
          ON bga.operation_id = so.id
        LEFT JOIN portfolio_event_agg pea
          ON pea.operation_id = so.id
        ORDER BY so.operated_on DESC, so.created_at DESC, so.id DESC
    )
    SELECT jsonb_build_object(
        'items',       COALESCE((SELECT jsonb_agg(item) FROM items), '[]'::jsonb),
        'total_count', COALESCE((SELECT total_count FROM items LIMIT 1), 0),
        'limit',       _limit,
        'offset',      _offset
    )
    INTO _result;

    RETURN _result;
END
$function$;
