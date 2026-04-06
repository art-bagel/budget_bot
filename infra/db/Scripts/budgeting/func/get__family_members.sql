DROP FUNCTION IF EXISTS budgeting.get__family_members;
CREATE FUNCTION budgeting.get__family_members(
    _user_id bigint
)
RETURNS jsonb
LANGUAGE plpgsql
AS $function$
DECLARE
    _family_id bigint;
    _result jsonb;
BEGIN
    SET search_path TO budgeting;

    _family_id := budgeting.get__user_family_id(_user_id);

    IF _family_id IS NULL THEN
        RETURN '[]'::jsonb;
    END IF;

    SELECT COALESCE(
        jsonb_agg(
            jsonb_build_object(
                'user_id', u.id,
                'username', u.username,
                'first_name', u.first_name,
                'last_name', u.last_name,
                'role', fm.role,
                'joined_at', fm.joined_at
            )
            ORDER BY fm.joined_at, u.id
        ),
        '[]'::jsonb
    )
    INTO _result
    FROM family_members fm
    JOIN users u
      ON u.id = fm.user_id
    WHERE fm.family_id = _family_id;

    RETURN _result;
END
$function$;
