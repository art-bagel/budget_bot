CREATE OR REPLACE FUNCTION budgeting.get__portfolio_positions(
    _user_id bigint,
    _status text DEFAULT NULL,
    _investment_account_id bigint DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
AS $function$
DECLARE
    _family_id bigint;
    _normalized_status text := nullif(trim(_status), '');
    _result jsonb;
BEGIN
    SET search_path TO budgeting;

    _family_id := budgeting.get__user_family_id(_user_id);

    IF _normalized_status IS NOT NULL
       AND _normalized_status NOT IN ('open', 'closed') THEN
        RAISE EXCEPTION 'Unsupported portfolio status filter: %', _normalized_status;
    END IF;

    SELECT COALESCE(
        jsonb_agg(
            jsonb_build_object(
                'id', pp.id,
                'investment_account_id', pp.investment_account_id,
                'investment_account_name', ba.name,
                'investment_account_owner_type', ba.owner_type,
                'investment_account_owner_name', CASE
                    WHEN ba.owner_type = 'user' THEN COALESCE(u.first_name, u.username, 'Personal')
                    ELSE f.name
                END,
                'asset_type_code', pp.asset_type_code,
                'title', pp.title,
                'status', pp.status,
                'quantity', pp.quantity,
                'amount_in_currency', pp.amount_in_currency,
                'currency_code', pp.currency_code,
                'opened_at', pp.opened_at,
                'closed_at', pp.closed_at,
                'close_amount_in_currency', pp.close_amount_in_currency,
                'close_currency_code', pp.close_currency_code,
                'comment', pp.comment,
                'metadata', pp.metadata,
                'created_by_user_id', pp.created_by_user_id,
                'created_at', pp.created_at
            )
            ORDER BY
                CASE WHEN pp.status = 'open' THEN 0 ELSE 1 END,
                pp.opened_at DESC,
                pp.id DESC
        ),
        '[]'::jsonb
    )
    INTO _result
    FROM portfolio_positions pp
    JOIN bank_accounts ba
      ON ba.id = pp.investment_account_id
    LEFT JOIN users u
      ON u.id = ba.owner_user_id
    LEFT JOIN families f
      ON f.id = ba.owner_family_id
    WHERE (
            (pp.owner_type = 'user' AND pp.owner_user_id = _user_id)
            OR
            (pp.owner_type = 'family' AND pp.owner_family_id = _family_id)
          )
      AND (_normalized_status IS NULL OR pp.status = _normalized_status)
      AND (_investment_account_id IS NULL OR pp.investment_account_id = _investment_account_id);

    RETURN _result;
END
$function$;
