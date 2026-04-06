DROP FUNCTION IF EXISTS budgeting.get__operations_analytics;
CREATE FUNCTION budgeting.get__operations_analytics(
    _user_id bigint,
    _anchor_date date DEFAULT NULL,
    _period_mode text DEFAULT 'month',
    _operation_type text DEFAULT 'expense',
    _owner_scope text DEFAULT 'all',
    _periods integer DEFAULT 6
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
    _effective_anchor_date date;
    _selected_period_start date;
    _selected_period_end date;
    _series_start date;
    _series_step interval;
    _base_currency_code char(3);
BEGIN
    SET search_path TO budgeting;

    _family_id := budgeting.get__user_family_id(_user_id);
    _effective_anchor_date := COALESCE(_anchor_date, current_date);
    _normalized_period_mode := COALESCE(nullif(trim(_period_mode), ''), 'month');
    _normalized_operation_type := COALESCE(nullif(trim(_operation_type), ''), 'expense');
    _normalized_owner_scope := COALESCE(nullif(trim(_owner_scope), ''), 'all');

    IF _normalized_period_mode NOT IN ('week', 'month', 'year') THEN
        RAISE EXCEPTION 'Unsupported analytics period mode: %', _normalized_period_mode;
    END IF;

    IF _normalized_operation_type NOT IN ('expense', 'income') THEN
        RAISE EXCEPTION 'Unsupported analytics operation type: %', _normalized_operation_type;
    END IF;

    IF _normalized_owner_scope NOT IN ('all', 'user', 'family') THEN
        RAISE EXCEPTION 'Unsupported analytics owner scope: %', _normalized_owner_scope;
    END IF;

    IF _periods IS NULL OR _periods <= 0 OR _periods > 24 THEN
        RAISE EXCEPTION 'Analytics periods count must be between 1 and 24';
    END IF;

    IF _normalized_period_mode = 'week' THEN
        _selected_period_start := date_trunc('week', _effective_anchor_date)::date;
        _selected_period_end := (_selected_period_start + 7);
        _series_start := (_selected_period_start - ((_periods - 1) * 7));
        _series_step := INTERVAL '1 week';
    ELSIF _normalized_period_mode = 'month' THEN
        _selected_period_start := date_trunc('month', _effective_anchor_date)::date;
        _selected_period_end := (_selected_period_start + INTERVAL '1 month')::date;
        _series_start := (_selected_period_start - make_interval(months => _periods - 1))::date;
        _series_step := INTERVAL '1 month';
    ELSE
        _selected_period_start := date_trunc('year', _effective_anchor_date)::date;
        _selected_period_end := (_selected_period_start + INTERVAL '1 year')::date;
        _series_start := (_selected_period_start - make_interval(years => _periods - 1))::date;
        _series_step := INTERVAL '1 year';
    END IF;

    SELECT u.base_currency_code
    INTO _base_currency_code
    FROM users u
    WHERE u.id = _user_id;

    IF _base_currency_code IS NULL THEN
        RAISE EXCEPTION 'Unknown user %', _user_id;
    END IF;

    WITH filtered_operations AS (
        SELECT
            o.id,
            o.created_at,
            o.owner_type,
            o.income_source_id
        FROM operations o
        WHERE o.type = _normalized_operation_type
          AND o.created_at >= _series_start
          AND o.created_at < _selected_period_end
          AND (
              (_normalized_owner_scope = 'all' AND (
                  (o.owner_type = 'user' AND o.owner_user_id = _user_id)
                  OR (_family_id IS NOT NULL AND o.owner_type = 'family' AND o.owner_family_id = _family_id)
              ))
              OR (_normalized_owner_scope = 'user' AND o.owner_type = 'user' AND o.owner_user_id = _user_id)
              OR (_normalized_owner_scope = 'family' AND _family_id IS NOT NULL AND o.owner_type = 'family' AND o.owner_family_id = _family_id)
          )
    ),
    period_expense_breakdown AS (
        SELECT
            c.id::text AS entry_key,
            c.name AS label,
            c.owner_type,
            round(sum(abs(bue.amount)), 2) AS amount,
            count(DISTINCT fo.id)::integer AS operations_count
        FROM filtered_operations fo
        JOIN budget_entries bue
          ON bue.operation_id = fo.id
        JOIN categories c
          ON c.id = bue.category_id
        WHERE _normalized_operation_type = 'expense'
          AND fo.created_at >= _selected_period_start
          AND fo.created_at < _selected_period_end
          AND c.kind = 'regular'
          AND bue.amount < 0
        GROUP BY c.id, c.name, c.owner_type
    ),
    period_income_breakdown AS (
        SELECT
            COALESCE(ins.id::text, 'unknown') AS entry_key,
            COALESCE(ins.name, 'Без источника') AS label,
            fo.owner_type,
            round(sum(bue.amount), 2) AS amount,
            count(DISTINCT fo.id)::integer AS operations_count
        FROM filtered_operations fo
        JOIN budget_entries bue
          ON bue.operation_id = fo.id
        JOIN categories c
          ON c.id = bue.category_id
        LEFT JOIN income_sources ins
          ON ins.id = fo.income_source_id
        WHERE _normalized_operation_type = 'income'
          AND fo.created_at >= _selected_period_start
          AND fo.created_at < _selected_period_end
          AND c.kind = 'system'
          AND c.name = 'Unallocated'
          AND bue.amount > 0
        GROUP BY COALESCE(ins.id::text, 'unknown'), COALESCE(ins.name, 'Без источника'), fo.owner_type
    ),
    period_breakdown AS (
        SELECT * FROM period_expense_breakdown
        UNION ALL
        SELECT * FROM period_income_breakdown
    ),
    period_totals AS (
        SELECT
            COALESCE(round(sum(pb.amount), 2), 0) AS total_amount,
            COALESCE(sum(pb.operations_count), 0) AS total_operations
        FROM period_breakdown pb
    ),
    series_source_expense AS (
        SELECT
            CASE
                WHEN _normalized_period_mode = 'week' THEN date_trunc('week', fo.created_at)::date
                WHEN _normalized_period_mode = 'month' THEN date_trunc('month', fo.created_at)::date
                ELSE date_trunc('year', fo.created_at)::date
            END AS period_start,
            abs(bue.amount) AS amount
        FROM filtered_operations fo
        JOIN budget_entries bue
          ON bue.operation_id = fo.id
        JOIN categories c
          ON c.id = bue.category_id
        WHERE _normalized_operation_type = 'expense'
          AND c.kind = 'regular'
          AND bue.amount < 0
    ),
    series_source_income AS (
        SELECT
            CASE
                WHEN _normalized_period_mode = 'week' THEN date_trunc('week', fo.created_at)::date
                WHEN _normalized_period_mode = 'month' THEN date_trunc('month', fo.created_at)::date
                ELSE date_trunc('year', fo.created_at)::date
            END AS period_start,
            bue.amount AS amount
        FROM filtered_operations fo
        JOIN budget_entries bue
          ON bue.operation_id = fo.id
        JOIN categories c
          ON c.id = bue.category_id
        WHERE _normalized_operation_type = 'income'
          AND c.kind = 'system'
          AND c.name = 'Unallocated'
          AND bue.amount > 0
    ),
    series_source AS (
        SELECT * FROM series_source_expense
        UNION ALL
        SELECT * FROM series_source_income
    ),
    series_totals AS (
        SELECT
            ss.period_start,
            round(sum(ss.amount), 2) AS amount
        FROM series_source ss
        GROUP BY ss.period_start
    ),
    period_series AS (
        SELECT generate_series(
            _series_start::timestamp,
            _selected_period_start::timestamp,
            _series_step
        )::date AS period_start
    ),
    period_items AS (
        SELECT jsonb_build_object(
            'period_start', ps.period_start,
            'amount', COALESCE(st.amount, 0),
            'is_selected', ps.period_start = _selected_period_start
        ) AS item
        FROM period_series ps
        LEFT JOIN series_totals st
          ON st.period_start = ps.period_start
        ORDER BY ps.period_start
    ),
    breakdown_items AS (
        SELECT jsonb_build_object(
            'entry_key', pb.entry_key,
            'label', pb.label,
            'owner_type', pb.owner_type,
            'amount', pb.amount,
            'operations_count', pb.operations_count
        ) AS item
        FROM period_breakdown pb
        ORDER BY pb.amount DESC, pb.label
    )
    SELECT jsonb_build_object(
        'period_start', _selected_period_start,
        'period_mode', _normalized_period_mode,
        'operation_type', _normalized_operation_type,
        'owner_scope', _normalized_owner_scope,
        'base_currency_code', _base_currency_code,
        'has_family', _family_id IS NOT NULL,
        'total_amount', (SELECT pt.total_amount FROM period_totals pt),
        'total_operations', (SELECT pt.total_operations FROM period_totals pt),
        'items', COALESCE((SELECT jsonb_agg(bi.item) FROM breakdown_items bi), '[]'::jsonb),
        'periods', COALESCE((SELECT jsonb_agg(pi.item) FROM period_items pi), '[]'::jsonb)
    )
    INTO _result;

    RETURN _result;
END
$function$;
