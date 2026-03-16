-- Returns all active scheduled expenses whose next_run_at <= today.
-- Called by the background scheduler (no user auth required).
CREATE OR REPLACE FUNCTION budgeting.get__due_scheduled_expenses()
RETURNS jsonb
LANGUAGE plpgsql
AS $function$
DECLARE
    _result jsonb;
BEGIN
    SET search_path TO budgeting;

    SELECT COALESCE(
        jsonb_agg(
            jsonb_build_object(
                'id',                   se.id,
                'category_id',          se.category_id,
                'bank_account_id',      se.bank_account_id,
                'created_by_user_id',   se.created_by_user_id,
                'amount',               se.amount,
                'currency_code',        se.currency_code,
                'comment',              se.comment,
                'frequency',            se.frequency,
                'day_of_week',          se.day_of_week,
                'day_of_month',         se.day_of_month
            )
            ORDER BY se.id
        ),
        '[]'::jsonb
    )
    INTO _result
    FROM scheduled_expenses se
    WHERE se.is_active = TRUE
      AND se.next_run_at <= CURRENT_DATE;

    RETURN _result;
END
$function$;
