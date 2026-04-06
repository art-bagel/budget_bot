DROP FUNCTION IF EXISTS budgeting.get__scheduled_expenses_for_category;
CREATE FUNCTION budgeting.get__scheduled_expenses_for_category(
    _user_id    bigint,
    _category_id bigint
)
RETURNS jsonb
LANGUAGE plpgsql
AS $function$
DECLARE
    _result jsonb;
BEGIN
    SET search_path TO budgeting;

    IF NOT EXISTS (
        SELECT 1 FROM categories c
        WHERE c.id = _category_id
          AND budgeting.has__owner_access(_user_id, c.owner_type, c.owner_user_id, c.owner_family_id)
    ) THEN
        RAISE EXCEPTION 'Access denied to category %', _category_id;
    END IF;

    SELECT COALESCE(
        jsonb_agg(
            jsonb_build_object(
                'id',               se.id,
                'category_id',      se.category_id,
                'amount',           se.amount,
                'currency_code',    se.currency_code,
                'comment',          se.comment,
                'frequency',        se.frequency,
                'day_of_week',      se.day_of_week,
                'day_of_month',     se.day_of_month,
                'next_run_at',      se.next_run_at,
                'last_run_at',      se.last_run_at,
                'last_error',       se.last_error,
                'is_active',        se.is_active,
                'created_at',       se.created_at
            )
            ORDER BY se.id
        ),
        '[]'::jsonb
    )
    INTO _result
    FROM scheduled_expenses se
    WHERE se.category_id = _category_id
      AND se.is_active = TRUE;

    RETURN _result;
END
$function$;
