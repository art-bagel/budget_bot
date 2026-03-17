CREATE OR REPLACE FUNCTION budgeting.get__portfolio_position(
    _user_id bigint,
    _position_id bigint
)
RETURNS jsonb
LANGUAGE plpgsql
AS $function$
DECLARE
    _result jsonb;
BEGIN
    SET search_path TO budgeting;

    SELECT jsonb_build_object(
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
    INTO _result
    FROM portfolio_positions pp
    JOIN bank_accounts ba
      ON ba.id = pp.investment_account_id
    LEFT JOIN users u
      ON u.id = ba.owner_user_id
    LEFT JOIN families f
      ON f.id = ba.owner_family_id
    WHERE pp.id = _position_id
      AND budgeting.has__owner_access(_user_id, pp.owner_type, pp.owner_user_id, pp.owner_family_id);

    RETURN _result;
END
$function$;
