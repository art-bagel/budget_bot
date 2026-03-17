CREATE OR REPLACE FUNCTION budgeting.get__operations_history(
    _user_id bigint,
    _limit integer DEFAULT 20,
    _offset integer DEFAULT 0,
    _operation_type text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
AS $function$
DECLARE
    _result jsonb;
    _normalized_operation_type text;
    _family_id bigint;
BEGIN
    SET search_path TO budgeting;

    _family_id := budgeting.get__user_family_id(_user_id);
    _normalized_operation_type := nullif(trim(_operation_type), '');

    IF _limit IS NULL OR _limit <= 0 THEN
        RAISE EXCEPTION 'History limit must be positive';
    END IF;

    IF _offset IS NULL OR _offset < 0 THEN
        RAISE EXCEPTION 'History offset must be zero or positive';
    END IF;

    IF _normalized_operation_type IS NOT NULL
       AND _normalized_operation_type NOT IN (
           'investment',
           'income',
           'allocate',
           'group_allocate',
           'exchange',
           'expense',
           'account_transfer',
           'investment_trade',
           'investment_income',
           'investment_adjustment',
           'reversal'
       ) THEN
        RAISE EXCEPTION 'Unsupported operation type filter: %', _normalized_operation_type;
    END IF;

    -- total_count is computed once via a window function to avoid a second
    -- full-scan query for pagination metadata.
    WITH selected_operations AS (
        SELECT
            o.id,
            o.type,
            o.comment,
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
                    _normalized_operation_type <> 'investment'
                    AND o.type = _normalized_operation_type
                )
          )
        ORDER BY o.created_at DESC, o.id DESC
        LIMIT _limit OFFSET _offset
    ),
    bank_agg AS (
        SELECT
            be.operation_id,
            jsonb_agg(
                jsonb_build_object(
                    'bank_account_id', be.bank_account_id,
                    'bank_account_name', ba.name,
                    'bank_account_owner_type', ba.owner_type,
                    'bank_account_kind', ba.account_kind,
                    'currency_code', be.currency_code,
                    'amount', be.amount
                )
                ORDER BY be.id
            ) AS bank_entries
        FROM bank_entries be
        JOIN bank_accounts ba
          ON ba.id = be.bank_account_id
        JOIN selected_operations so
          ON so.id = be.operation_id
        GROUP BY be.operation_id
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
    items AS (
        SELECT
            jsonb_build_object(
                'operation_id', so.id,
                'type', so.type,
                'comment', so.comment,
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
                'budget_entries', COALESCE(bga.budget_entries, '[]'::jsonb)
            ) AS item,
            so.total_count
        FROM selected_operations so
        LEFT JOIN bank_agg ba
          ON ba.operation_id = so.id
        LEFT JOIN budget_agg bga
          ON bga.operation_id = so.id
        ORDER BY so.created_at DESC, so.id DESC
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
