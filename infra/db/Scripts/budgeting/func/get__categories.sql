-- Description:
--   Returns active or archived categories accessible to the user.
CREATE OR REPLACE FUNCTION budgeting.get__categories(
    _user_id bigint,
    _is_active boolean DEFAULT NULL
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

    SELECT COALESCE(
        jsonb_agg(
            jsonb_build_object(
                'id', c.id,
                'name', c.name,
                'kind', c.kind,
                'owner_type', c.owner_type,
                'owner_user_id', c.owner_user_id,
                'owner_family_id', c.owner_family_id,
                'owner_name', CASE
                    WHEN c.owner_type = 'user' THEN COALESCE(u.first_name, u.username, 'Personal')
                    ELSE f.name
                END,
                'is_active', c.is_active,
                'created_at', c.created_at
            )
            ORDER BY c.owner_type, c.kind, c.id
        ),
        '[]'::jsonb
    )
    INTO _result
    FROM categories c
    LEFT JOIN users u
      ON u.id = c.owner_user_id
    LEFT JOIN families f
      ON f.id = c.owner_family_id
    WHERE (
            (c.owner_type = 'user' AND c.owner_user_id = _user_id)
            OR
            (c.owner_type = 'family' AND c.owner_family_id = _family_id)
          )
      AND (_is_active IS NULL OR c.is_active = _is_active);

    RETURN _result;
END
$function$;
