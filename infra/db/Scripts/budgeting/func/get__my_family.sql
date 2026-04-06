DROP FUNCTION IF EXISTS budgeting.get__my_family;
CREATE FUNCTION budgeting.get__my_family(
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
        RETURN NULL;
    END IF;

    SELECT jsonb_build_object(
        'family_id', f.id,
        'name', f.name,
        'base_currency_code', f.base_currency_code,
        'created_by_user_id', f.created_by_user_id,
        'created_at', f.created_at
    )
    INTO _result
    FROM families f
    WHERE f.id = _family_id
      AND f.is_active;

    RETURN _result;
END
$function$;
