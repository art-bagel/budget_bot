CREATE OR REPLACE FUNCTION budgeting.get__tinkoff_connections(
    _user_id bigint
)
RETURNS jsonb
LANGUAGE sql
AS $function$
    SELECT COALESCE(
        jsonb_agg(
            jsonb_build_object(
                'id', ec.id,
                'provider', ec.provider,
                'provider_account_id', ec.provider_account_id,
                'linked_account_id', ec.linked_account_id,
                'linked_account_name', ba.name,
                'last_synced_at', ec.last_synced_at,
                'is_active', ec.is_active,
                'settings', ec.settings,
                'created_at', ec.created_at
            )
            ORDER BY ec.created_at
        ),
        '[]'::jsonb
    )
    FROM budgeting.external_connections ec
    LEFT JOIN budgeting.bank_accounts ba ON ba.id = ec.linked_account_id
    WHERE ec.provider = 'tinkoff'
      AND ec.is_active = true
      AND (
          (ec.owner_type = 'user' AND ec.owner_user_id = _user_id)
          OR
          (ec.owner_type = 'family' AND ec.owner_family_id = budgeting.get__user_family_id(_user_id))
      )
$function$;
