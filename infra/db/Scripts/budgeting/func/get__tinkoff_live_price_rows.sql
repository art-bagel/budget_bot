CREATE OR REPLACE FUNCTION budgeting.get__tinkoff_live_price_rows(
    _user_id bigint
)
RETURNS jsonb
LANGUAGE sql
AS $function$
    SELECT COALESCE(
        jsonb_agg(
            jsonb_build_object(
                'connection_id', ec.id,
                'provider_account_id', ec.provider_account_id,
                'linked_account_id', ec.linked_account_id,
                'credentials', ec.credentials,
                'position_id', pp.id,
                'title', pp.title,
                'quantity', pp.quantity,
                'currency_code', pp.currency_code,
                'metadata', pp.metadata
            )
            ORDER BY ec.id, pp.id
        ),
        '[]'::jsonb
    )
    FROM budgeting.external_connections ec
    JOIN budgeting.portfolio_positions pp
      ON pp.investment_account_id = ec.linked_account_id
     AND pp.status = 'open'
    WHERE ec.provider = 'tinkoff'
      AND ec.is_active = true
      AND ec.linked_account_id IS NOT NULL
      AND (
          (ec.owner_type = 'user' AND ec.owner_user_id = _user_id)
          OR
          (ec.owner_type = 'family' AND ec.owner_family_id = budgeting.get__user_family_id(_user_id))
      )
$function$;
