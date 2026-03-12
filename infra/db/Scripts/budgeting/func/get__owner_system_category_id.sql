CREATE OR REPLACE FUNCTION budgeting.get__owner_system_category_id(
    _owner_type text,
    _owner_user_id bigint,
    _owner_family_id bigint,
    _name text
)
RETURNS bigint
LANGUAGE sql
AS $function$
    SELECT c.id
    FROM budgeting.categories c
    WHERE c.owner_type = _owner_type
      AND c.name = _name
      AND c.kind = 'system'
      AND c.is_active
      AND (
          (_owner_type = 'user' AND c.owner_user_id = _owner_user_id)
          OR
          (_owner_type = 'family' AND c.owner_family_id = _owner_family_id)
      )
    LIMIT 1
$function$;
