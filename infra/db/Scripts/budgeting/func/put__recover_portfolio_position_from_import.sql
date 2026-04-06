DROP FUNCTION IF EXISTS budgeting.put__recover_portfolio_position_from_import;
CREATE FUNCTION budgeting.put__recover_portfolio_position_from_import(
    _user_id bigint,
    _owner_type text,
    _owner_user_id bigint,
    _owner_family_id bigint,
    _investment_account_id bigint,
    _title text,
    _quantity numeric,
    _amount_in_currency numeric,
    _currency_code char(3),
    _comment text,
    _metadata jsonb
)
RETURNS bigint
LANGUAGE plpgsql
AS $function$
DECLARE
    _position_id bigint;
BEGIN
    SET search_path TO budgeting;

    INSERT INTO portfolio_positions (
        owner_type,
        owner_user_id,
        owner_family_id,
        investment_account_id,
        asset_type_code,
        title,
        status,
        quantity,
        amount_in_currency,
        currency_code,
        opened_at,
        comment,
        metadata,
        created_by_user_id
    )
    VALUES (
        _owner_type,
        _owner_user_id,
        _owner_family_id,
        _investment_account_id,
        'security',
        _title,
        'open',
        _quantity,
        _amount_in_currency,
        _currency_code,
        CURRENT_DATE,
        _comment,
        COALESCE(_metadata, '{}'::jsonb),
        _user_id
    )
    RETURNING id INTO _position_id;

    INSERT INTO portfolio_events (
        position_id,
        event_type,
        event_at,
        quantity,
        amount,
        currency_code,
        comment,
        metadata,
        created_by_user_id
    )
    VALUES (
        _position_id,
        'open',
        CURRENT_DATE,
        _quantity,
        _amount_in_currency,
        _currency_code,
        _comment,
        jsonb_build_object(
            'action', 'recovered_current_position',
            'import_source', 'tinkoff'
        ),
        _user_id
    );

    RETURN _position_id;
END
$function$;
