CREATE OR REPLACE FUNCTION budgeting.set__deactivate_tinkoff_connection(
    _connection_id bigint,
    _user_id bigint
)
RETURNS boolean
LANGUAGE plpgsql
AS $function$
DECLARE
    _updated_count integer;
BEGIN
    SET search_path TO budgeting;

    UPDATE external_connections
    SET is_active = false
    WHERE id = _connection_id
      AND provider = 'tinkoff'
      AND (
          (owner_type = 'user' AND owner_user_id = _user_id)
          OR
          (owner_type = 'family' AND owner_family_id = budgeting.get__user_family_id(_user_id))
      );

    GET DIAGNOSTICS _updated_count = ROW_COUNT;
    RETURN _updated_count > 0;
END
$function$;
