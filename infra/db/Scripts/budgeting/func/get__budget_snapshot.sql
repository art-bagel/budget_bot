CREATE OR REPLACE FUNCTION budgeting.get__budget_snapshot(
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

    -- base_currency_code is resolved via JOIN instead of per-row function calls.
    WITH accessible_categories AS (
        SELECT
            c.id,
            c.name,
            c.kind,
            c.owner_type,
            c.owner_user_id,
            c.owner_family_id,
            COALESCE(u.base_currency_code, f.base_currency_code) AS base_currency_code
        FROM categories c
        LEFT JOIN users u
          ON u.id = c.owner_user_id AND c.owner_type = 'user'
        LEFT JOIN families f
          ON f.id = c.owner_family_id AND c.owner_type = 'family'
        WHERE (
                (c.owner_type = 'user'   AND c.owner_user_id   = _user_id)
                OR
                (c.owner_type = 'family' AND c.owner_family_id = _family_id)
              )
          AND (_is_active IS NULL OR c.is_active = _is_active)
    )
    SELECT COALESCE(
        jsonb_agg(
            jsonb_build_object(
                'category_id',    ac.id,
                'name',           ac.name,
                'kind',           ac.kind,
                'owner_type',     ac.owner_type,
                'owner_user_id',  ac.owner_user_id,
                'owner_family_id', ac.owner_family_id,
                'balance',        COALESCE(cbb.amount, 0),
                'currency_code',  ac.base_currency_code
            )
            ORDER BY ac.owner_type, ac.id
        ),
        '[]'::jsonb
    )
    INTO _result
    FROM accessible_categories ac
    LEFT JOIN current_budget_balances cbb
      ON cbb.category_id   = ac.id
     AND cbb.currency_code = ac.base_currency_code;

    RETURN _result;
END
$function$;
