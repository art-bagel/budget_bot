CREATE OR REPLACE FUNCTION budgeting.get__tinkoff_connection(
    _user_id bigint,
    _connection_id bigint
)
RETURNS jsonb
LANGUAGE sql
AS $function$
    SELECT to_jsonb(ec)
    FROM budgeting.external_connections ec
    WHERE ec.id = _connection_id
      AND ec.is_active = true
      AND (
          (ec.owner_type = 'user' AND ec.owner_user_id = _user_id)
          OR
          (ec.owner_type = 'family' AND ec.owner_family_id = budgeting.get__user_family_id(_user_id))
      )
$function$;
