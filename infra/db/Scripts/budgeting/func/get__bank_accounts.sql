CREATE OR REPLACE FUNCTION budgeting.get__bank_accounts(
    _user_id bigint,
    _is_active boolean DEFAULT true
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
                'id', ba.id,
                'name', ba.name,
                'owner_type', ba.owner_type,
                'owner_user_id', ba.owner_user_id,
                'owner_family_id', ba.owner_family_id,
                'owner_name', CASE
                    WHEN ba.owner_type = 'user' THEN COALESCE(u.first_name, u.username, 'Personal')
                    ELSE f.name
                END,
                'is_primary', ba.is_primary,
                'is_active', ba.is_active,
                'created_at', ba.created_at
            )
            ORDER BY ba.owner_type, ba.is_primary DESC, ba.id
        ),
        '[]'::jsonb
    )
    INTO _result
    FROM bank_accounts ba
    LEFT JOIN users u
      ON u.id = ba.owner_user_id
    LEFT JOIN families f
      ON f.id = ba.owner_family_id
    WHERE (
            (ba.owner_type = 'user' AND ba.owner_user_id = _user_id)
            OR
            (ba.owner_type = 'family' AND ba.owner_family_id = _family_id)
          )
      AND (_is_active IS NULL OR ba.is_active = _is_active);

    RETURN _result;
END
$function$;
