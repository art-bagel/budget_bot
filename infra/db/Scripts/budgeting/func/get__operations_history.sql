-- Description:
--   Returns the user's operations history in reverse chronological order with bank and budget lines.
-- Parameters:
--   _user_id bigint - Operation owner.
--   _limit integer - Number of operations to return.
--   _offset integer - Number of operations to skip.
-- Returns:
--   jsonb - Paginated operations history with total count.
CREATE OR REPLACE FUNCTION budgeting.get__operations_history(
    _user_id bigint,
    _limit integer DEFAULT 20,
    _offset integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
AS $function$
DECLARE
    _result jsonb;
BEGIN
    SET search_path TO budgeting;

    IF _limit IS NULL OR _limit <= 0 THEN
        RAISE EXCEPTION 'History limit must be positive';
    END IF;

    IF _offset IS NULL OR _offset < 0 THEN
        RAISE EXCEPTION 'History offset must be zero or positive';
    END IF;

    WITH selected_operations AS (
        SELECT
            o.id,
            o.type,
            o.comment,
            o.created_at,
            o.reversal_of_operation_id,
            ins.name AS income_source_name
        FROM operations o
        LEFT JOIN income_sources ins
          ON ins.id = o.income_source_id
        WHERE o.user_id = _user_id
        ORDER BY o.created_at DESC, o.id DESC
        LIMIT _limit OFFSET _offset
    ),
    bank_agg AS (
        SELECT
            be.operation_id,
            jsonb_agg(
                jsonb_build_object(
                    'currency_code', be.currency_code,
                    'amount', be.amount
                )
                ORDER BY be.id
            ) AS bank_entries
        FROM bank_entries be
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
                        WHEN c.kind = 'system' AND c.name = 'Unallocated' THEN 'Свободный остаток'
                        ELSE c.name
                    END,
                    'category_kind', c.kind,
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
        SELECT jsonb_build_object(
            'operation_id', so.id,
            'type', so.type,
            'comment', so.comment,
            'created_at', so.created_at,
            'reversal_of_operation_id', so.reversal_of_operation_id,
            'income_source_name', so.income_source_name,
            'bank_entries', COALESCE(ba.bank_entries, '[]'::jsonb),
            'budget_entries', COALESCE(bga.budget_entries, '[]'::jsonb)
        ) AS item
        FROM selected_operations so
        LEFT JOIN bank_agg ba
          ON ba.operation_id = so.id
        LEFT JOIN budget_agg bga
          ON bga.operation_id = so.id
        ORDER BY so.created_at DESC, so.id DESC
    )
    SELECT jsonb_build_object(
        'items', COALESCE((SELECT jsonb_agg(item) FROM items), '[]'::jsonb),
        'total_count', (
            SELECT count(*)
            FROM operations o
            WHERE o.user_id = _user_id
        ),
        'limit', _limit,
        'offset', _offset
    )
    INTO _result;

    RETURN _result;
END
$function$;
