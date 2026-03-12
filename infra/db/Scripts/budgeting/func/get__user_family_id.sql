CREATE OR REPLACE FUNCTION budgeting.get__user_family_id(
    _user_id bigint
)
RETURNS bigint
LANGUAGE sql
AS $function$
    SELECT fm.family_id
    FROM budgeting.family_members fm
    JOIN budgeting.families f
      ON f.id = fm.family_id
    WHERE fm.user_id = _user_id
      AND f.is_active
    LIMIT 1
$function$;
