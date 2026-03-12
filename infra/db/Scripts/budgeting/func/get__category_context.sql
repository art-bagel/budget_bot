CREATE OR REPLACE FUNCTION budgeting.get__category_context(
    _category_id bigint
)
RETURNS TABLE (
    id bigint,
    owner_type text,
    owner_user_id bigint,
    owner_family_id bigint,
    name varchar(100),
    kind varchar(20),
    is_active boolean,
    created_at timestamptz
)
LANGUAGE sql
AS $function$
    SELECT
        c.id,
        c.owner_type::text,
        c.owner_user_id,
        c.owner_family_id,
        c.name,
        c.kind,
        c.is_active,
        c.created_at
    FROM budgeting.categories c
    WHERE c.id = _category_id
$function$;
