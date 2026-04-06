DROP FUNCTION IF EXISTS budgeting.get__tinkoff_imported_ids;
CREATE FUNCTION budgeting.get__tinkoff_imported_ids(
    _external_ids text[]
)
RETURNS jsonb
LANGUAGE sql
AS $function$
    WITH imported AS (
        SELECT external_id
        FROM budgeting.portfolio_events
        WHERE import_source = 'tinkoff'
          AND external_id = ANY(COALESCE(_external_ids, ARRAY[]::text[]))
        UNION
        SELECT external_id
        FROM budgeting.bank_entries
        WHERE import_source = 'tinkoff'
          AND external_id = ANY(COALESCE(_external_ids, ARRAY[]::text[]))
    )
    SELECT COALESCE(jsonb_agg(external_id ORDER BY external_id), '[]'::jsonb)
    FROM imported
$function$;
