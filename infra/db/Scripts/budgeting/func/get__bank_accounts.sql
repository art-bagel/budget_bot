DROP FUNCTION IF EXISTS budgeting.get__bank_accounts;
CREATE FUNCTION budgeting.get__bank_accounts(
    _user_id bigint,
    _is_active boolean DEFAULT true,
    _account_kind text DEFAULT 'cash'
)
RETURNS jsonb
LANGUAGE plpgsql
AS $function$
DECLARE
    _family_id bigint;
    _normalized_account_kind text := nullif(trim(_account_kind), '');
    _result jsonb;
BEGIN
    SET search_path TO budgeting;

    _family_id := budgeting.get__user_family_id(_user_id);

    IF _normalized_account_kind IS NOT NULL
       AND _normalized_account_kind NOT IN ('cash', 'investment', 'credit') THEN
        RAISE EXCEPTION 'Unsupported bank account kind filter: %', _normalized_account_kind;
    END IF;

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
                'account_kind', ba.account_kind,
                'investment_asset_type', ba.investment_asset_type,
                'credit_kind', ba.credit_kind,
                'interest_rate', ba.interest_rate,
                'payment_day', ba.payment_day,
                'credit_started_at', ba.credit_started_at,
                'credit_ends_at', ba.credit_ends_at,
                'credit_limit', ba.credit_limit,
                'provider_name', ba.provider_name,
                'provider_account_ref', ba.provider_account_ref,
                'is_primary', ba.is_primary,
                'is_active', ba.is_active,
                'created_at', ba.created_at
            )
            ORDER BY ba.owner_type, ba.account_kind, ba.is_primary DESC, ba.id
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
      AND (_is_active IS NULL OR ba.is_active = _is_active)
      AND (_normalized_account_kind IS NULL OR ba.account_kind = _normalized_account_kind);

    RETURN _result;
END
$function$;
