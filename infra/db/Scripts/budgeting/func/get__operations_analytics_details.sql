DROP FUNCTION IF EXISTS budgeting.get__operations_analytics_details;
CREATE FUNCTION budgeting.get__operations_analytics_details(
    _user_id bigint,
    _anchor_date date DEFAULT NULL,
    _period_mode text DEFAULT 'month',
    _operation_type text DEFAULT 'expense',
    _owner_scope text DEFAULT 'all',
    _entry_key text DEFAULT NULL,
    _limit integer DEFAULT 50,
    _offset integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
AS $function$
DECLARE
    _result jsonb;
    _family_id bigint;
    _normalized_operation_type text;
    _normalized_owner_scope text;
    _normalized_period_mode text;
    _normalized_entry_key text;
    _effective_anchor_date date;
    _selected_period_start date;
    _selected_period_end date;
BEGIN
    SET search_path TO budgeting;

    _family_id := budgeting.get__user_family_id(_user_id);
    _effective_anchor_date := COALESCE(_anchor_date, current_date);
    _normalized_period_mode := COALESCE(nullif(trim(_period_mode), ''), 'month');
    _normalized_operation_type := COALESCE(nullif(trim(_operation_type), ''), 'expense');
    _normalized_owner_scope := COALESCE(nullif(trim(_owner_scope), ''), 'all');
    -- Ключ может содержать несколько значений через запятую: так «Прочее»
    -- запрашивает операции сразу по всем категориям хвоста.
    _normalized_entry_key := nullif(trim(_entry_key), '');

    IF _normalized_period_mode NOT IN ('week', 'month', 'year') THEN
        RAISE EXCEPTION 'Unsupported analytics period mode: %', _normalized_period_mode;
    END IF;

    IF _normalized_operation_type NOT IN ('expense', 'income') THEN
        RAISE EXCEPTION 'Unsupported analytics operation type: %', _normalized_operation_type;
    END IF;

    IF _normalized_owner_scope NOT IN ('all', 'user', 'family') THEN
        RAISE EXCEPTION 'Unsupported analytics owner scope: %', _normalized_owner_scope;
    END IF;

    IF _normalized_entry_key IS NULL THEN
        RAISE EXCEPTION 'Analytics entry key is required';
    END IF;

    IF _limit IS NULL OR _limit <= 0 THEN
        RAISE EXCEPTION 'Details limit must be positive';
    END IF;

    IF _offset IS NULL OR _offset < 0 THEN
        RAISE EXCEPTION 'Details offset must be zero or positive';
    END IF;

    IF _normalized_period_mode = 'week' THEN
        _selected_period_start := date_trunc('week', _effective_anchor_date)::date;
        _selected_period_end := (_selected_period_start + 7);
    ELSIF _normalized_period_mode = 'month' THEN
        _selected_period_start := date_trunc('month', _effective_anchor_date)::date;
        _selected_period_end := (_selected_period_start + INTERVAL '1 month')::date;
    ELSE
        _selected_period_start := date_trunc('year', _effective_anchor_date)::date;
        _selected_period_end := (_selected_period_start + INTERVAL '1 year')::date;
    END IF;

    WITH filtered_operations AS (
        SELECT
            o.id,
            o.operated_on,
            o.created_at,
            o.comment,
            o.owner_type,
            o.income_source_id,
            o.actor_user_id
        FROM operations o
        WHERE o.type = _normalized_operation_type
          AND o.operated_on >= _selected_period_start
          AND o.operated_on < _selected_period_end
          AND NOT EXISTS (
              SELECT 1 FROM operations ro
              WHERE ro.reversal_of_operation_id = o.id
          )
          AND (
              (_normalized_owner_scope = 'all' AND (
                  (o.owner_type = 'user' AND o.owner_user_id = _user_id)
                  OR (_family_id IS NOT NULL AND o.owner_type = 'family' AND o.owner_family_id = _family_id)
              ))
              OR (_normalized_owner_scope = 'user' AND o.owner_type = 'user' AND o.owner_user_id = _user_id)
              OR (_normalized_owner_scope = 'family' AND _family_id IS NOT NULL AND o.owner_type = 'family' AND o.owner_family_id = _family_id)
          )
    ),
    entry_keys AS (
        SELECT trim(k.value) AS entry_key
        FROM unnest(string_to_array(_normalized_entry_key, ',')) AS k(value)
        WHERE trim(k.value) <> ''
    ),
    expense_details AS (
        SELECT
            fo.id,
            fo.operated_on,
            fo.created_at,
            fo.comment,
            fo.owner_type,
            fo.actor_user_id,
            string_agg(DISTINCT c.name, ' · ') AS label,
            round(sum(abs(bue.amount)), 2) AS amount
        FROM filtered_operations fo
        JOIN budget_entries bue
          ON bue.operation_id = fo.id
        JOIN categories c
          ON c.id = bue.category_id
        WHERE _normalized_operation_type = 'expense'
          AND c.kind = 'regular'
          AND bue.amount < 0
          AND c.id::text IN (SELECT ek.entry_key FROM entry_keys ek)
        GROUP BY fo.id, fo.operated_on, fo.created_at, fo.comment, fo.owner_type, fo.actor_user_id
    ),
    income_details AS (
        SELECT
            fo.id,
            fo.operated_on,
            fo.created_at,
            fo.comment,
            fo.owner_type,
            fo.actor_user_id,
            COALESCE(min(ins.name), 'Без источника') AS label,
            round(sum(bue.amount), 2) AS amount
        FROM filtered_operations fo
        JOIN budget_entries bue
          ON bue.operation_id = fo.id
        JOIN categories c
          ON c.id = bue.category_id
        LEFT JOIN income_sources ins
          ON ins.id = fo.income_source_id
        WHERE _normalized_operation_type = 'income'
          AND c.kind = 'system'
          AND c.name = 'Unallocated'
          AND bue.amount > 0
          AND COALESCE(fo.income_source_id::text, 'unknown') IN (SELECT ek.entry_key FROM entry_keys ek)
        GROUP BY fo.id, fo.operated_on, fo.created_at, fo.comment, fo.owner_type, fo.actor_user_id
    ),
    details AS (
        SELECT * FROM expense_details
        UNION ALL
        SELECT * FROM income_details
    ),
    paged AS (
        SELECT
            d.*,
            actor.username AS actor_username,
            count(*) OVER () AS total_count
        FROM details d
        LEFT JOIN users actor
          ON actor.id = d.actor_user_id
        ORDER BY d.operated_on DESC, d.created_at DESC, d.id DESC
        LIMIT _limit OFFSET _offset
    )
    SELECT jsonb_build_object(
        'items', COALESCE(
            (
                SELECT jsonb_agg(
                    jsonb_build_object(
                        'operation_id', p.id,
                        'operated_at', p.operated_on,
                        'created_at', p.created_at,
                        'comment', p.comment,
                        'owner_type', p.owner_type,
                        'actor_username', p.actor_username,
                        'label', p.label,
                        'amount', p.amount
                    )
                    ORDER BY p.operated_on DESC, p.created_at DESC, p.id DESC
                )
                FROM paged p
            ),
            '[]'::jsonb
        ),
        'total_count', COALESCE((SELECT p.total_count FROM paged p LIMIT 1), 0),
        'limit', _limit,
        'offset', _offset
    )
    INTO _result;

    RETURN _result;
END
$function$;
