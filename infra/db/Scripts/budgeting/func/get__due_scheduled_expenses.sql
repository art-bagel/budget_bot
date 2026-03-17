-- Returns all active scheduled expenses whose next_run_at <= today.
-- The primary bank account for each category's owner is resolved here
-- (personal category → personal primary account, family category → family primary account).
-- Called by the background scheduler — no user auth required.
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
                'bank_account_id',      ba.id,
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
    -- Resolve the primary bank account that belongs to the same owner as the category.
    -- Personal category → user's primary account; family category → family's primary account.
    JOIN bank_accounts ba
      ON ba.owner_type = se.owner_type
     AND (
             (se.owner_type = 'user'   AND ba.owner_user_id   = se.owner_user_id)
          OR (se.owner_type = 'family' AND ba.owner_family_id = se.owner_family_id)
         )
     AND ba.is_primary = TRUE
     AND ba.account_kind = 'cash'
     AND ba.is_active  = TRUE
    WHERE se.is_active    = TRUE
      AND se.next_run_at <= CURRENT_DATE;

    RETURN _result;
END
$function$;
