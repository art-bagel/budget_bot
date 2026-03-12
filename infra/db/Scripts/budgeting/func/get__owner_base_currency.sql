CREATE OR REPLACE FUNCTION budgeting.get__owner_base_currency(
    _owner_type text,
    _owner_user_id bigint,
    _owner_family_id bigint
)
RETURNS char(3)
LANGUAGE sql
AS $function$
    SELECT CASE
        WHEN _owner_type = 'user' THEN (
            SELECT u.base_currency_code
            FROM budgeting.users u
            WHERE u.id = _owner_user_id
        )
        WHEN _owner_type = 'family' THEN (
            SELECT f.base_currency_code
            FROM budgeting.families f
            WHERE f.id = _owner_family_id
              AND f.is_active
        )
        ELSE NULL
    END
$function$;
