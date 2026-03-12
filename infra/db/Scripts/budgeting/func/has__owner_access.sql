CREATE OR REPLACE FUNCTION budgeting.has__owner_access(
    _actor_user_id bigint,
    _owner_type text,
    _owner_user_id bigint,
    _owner_family_id bigint
)
RETURNS boolean
LANGUAGE sql
AS $function$
    SELECT CASE
        WHEN _owner_type = 'user' THEN _owner_user_id = _actor_user_id
        WHEN _owner_type = 'family' THEN EXISTS (
            SELECT 1
            FROM budgeting.family_members fm
            JOIN budgeting.families f
              ON f.id = fm.family_id
            WHERE fm.family_id = _owner_family_id
              AND fm.user_id = _actor_user_id
              AND f.is_active
        )
        ELSE false
    END
$function$;
