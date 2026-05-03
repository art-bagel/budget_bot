DROP FUNCTION IF EXISTS budgeting.put__swap_crypto_investment_asset;
CREATE FUNCTION budgeting.put__swap_crypto_investment_asset(
    _user_id bigint,
    _position_id bigint,
    _from_amount numeric,
    _to_crypto_asset_id bigint,
    _to_amount numeric,
    _target_investment_account_id bigint DEFAULT NULL,
    _comment text DEFAULT NULL,
    _operated_at date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
AS $function$
DECLARE
    _source record;
    _target_account record;
    _from_asset record;
    _to_asset record;
    _from_crypto_asset_id bigint;
    _source_quantity numeric(30, 12);
    _remaining_quantity numeric(30, 12);
    _resolved_target_account_id bigint;
    _target_position_id bigint;
    _operation_id bigint;
    _metadata jsonb;
BEGIN
    SET search_path TO budgeting;

    IF _from_amount <= 0 OR _to_amount <= 0 THEN
        RAISE EXCEPTION 'Amounts must be positive';
    END IF;
    _from_amount := round(_from_amount, 12);
    _to_amount := round(_to_amount, 12);

    SELECT *
    INTO _source
    FROM portfolio_positions
    WHERE id = _position_id
      AND status = 'open'
      AND asset_type_code = 'crypto'
    FOR UPDATE;

    IF _source.id IS NULL THEN
        RAISE EXCEPTION 'Unknown open crypto portfolio position %', _position_id;
    END IF;

    IF NOT budgeting.has__owner_access(_user_id, _source.owner_type, _source.owner_user_id, _source.owner_family_id) THEN
        RAISE EXCEPTION 'Access denied to portfolio position %', _position_id;
    END IF;

    _from_crypto_asset_id := (_source.metadata ->> 'crypto_asset_id')::bigint;
    IF _from_crypto_asset_id IS NULL THEN
        RAISE EXCEPTION 'Crypto asset metadata is missing for portfolio position %', _position_id;
    END IF;

    IF _from_crypto_asset_id = _to_crypto_asset_id THEN
        RAISE EXCEPTION 'Swap target asset must be different';
    END IF;

    SELECT *
    INTO _from_asset
    FROM crypto_assets
    WHERE id = _from_crypto_asset_id;

    SELECT *
    INTO _to_asset
    FROM crypto_assets
    WHERE id = _to_crypto_asset_id;

    IF _from_asset.id IS NULL THEN
        RAISE EXCEPTION 'Unknown crypto asset %', _from_crypto_asset_id;
    END IF;

    IF _to_asset.id IS NULL THEN
        RAISE EXCEPTION 'Unknown crypto asset %', _to_crypto_asset_id;
    END IF;

    _resolved_target_account_id := COALESCE(_target_investment_account_id, _source.investment_account_id);

    SELECT *
    INTO _target_account
    FROM bank_accounts
    WHERE id = _resolved_target_account_id
      AND is_active;

    IF _target_account.id IS NULL THEN
        RAISE EXCEPTION 'Unknown active investment account %', _resolved_target_account_id;
    END IF;

    IF _target_account.account_kind <> 'investment' OR _target_account.investment_asset_type <> 'crypto' THEN
        RAISE EXCEPTION 'Target account must be a crypto investment account';
    END IF;

    IF _target_account.owner_type <> _source.owner_type
       OR COALESCE(_target_account.owner_user_id, 0) <> COALESCE(_source.owner_user_id, 0)
       OR COALESCE(_target_account.owner_family_id, 0) <> COALESCE(_source.owner_family_id, 0) THEN
        RAISE EXCEPTION 'Target account and crypto position must have the same owner';
    END IF;

    _source_quantity := COALESCE(_source.quantity, 0);
    IF _source_quantity < _from_amount THEN
        RAISE EXCEPTION 'Сумма превышает остаток';
    END IF;

    INSERT INTO operations (
        actor_user_id,
        owner_type,
        owner_user_id,
        owner_family_id,
        type,
        comment,
        operated_on
    )
    VALUES (
        _user_id,
        _source.owner_type,
        _source.owner_user_id,
        _source.owner_family_id,
        'investment_trade',
        COALESCE(_comment, 'Обмен криптовалюты внутри портфеля'),
        COALESCE(_operated_at, current_date)
    )
    RETURNING id INTO _operation_id;

    _metadata := jsonb_build_object(
        'source_position_id', _position_id,
        'source_investment_account_id', _source.investment_account_id,
        'target_investment_account_id', _resolved_target_account_id,
        'from_crypto_asset_id', _from_crypto_asset_id,
        'from_asset_symbol', COALESCE(_from_asset.symbol, _source.metadata ->> 'asset_symbol', _source.title),
        'from_amount', _from_amount,
        'to_crypto_asset_id', _to_crypto_asset_id,
        'to_asset_symbol', _to_asset.symbol,
        'to_asset_name', _to_asset.name,
        'to_network_code', _to_asset.network_code,
        'to_contract_address', _to_asset.contract_address,
        'to_amount', _to_amount
    );

    SELECT id
    INTO _target_position_id
    FROM portfolio_positions
    WHERE investment_account_id = _resolved_target_account_id
      AND asset_type_code = 'crypto'
      AND status = 'open'
      AND metadata ->> 'crypto_asset_id' ~ '^[0-9]+$'
      AND (metadata ->> 'crypto_asset_id')::bigint = _to_crypto_asset_id
    ORDER BY opened_at ASC, id ASC
    LIMIT 1
    FOR UPDATE;

    IF _target_position_id IS NULL THEN
        INSERT INTO portfolio_positions (
            owner_type,
            owner_user_id,
            owner_family_id,
            investment_account_id,
            asset_type_code,
            title,
            quantity,
            amount_in_currency,
            currency_code,
            opened_at,
            comment,
            metadata,
            created_by_user_id
        )
        VALUES (
            _source.owner_type,
            _source.owner_user_id,
            _source.owner_family_id,
            _resolved_target_account_id,
            'crypto',
            _to_asset.symbol,
            _to_amount,
            0,
            _source.currency_code,
            COALESCE(_operated_at, current_date),
            NULLIF(btrim(_comment), ''),
            jsonb_build_object(
                'crypto_kind', 'spot',
                'crypto_asset_id', _to_crypto_asset_id,
                'asset_symbol', _to_asset.symbol,
                'asset_name', _to_asset.name,
                'network_code', _to_asset.network_code,
                'contract_address', _to_asset.contract_address
            ),
            _user_id
        )
        RETURNING id INTO _target_position_id;
    ELSE
        UPDATE portfolio_positions
        SET quantity = COALESCE(quantity, 0) + _to_amount,
            amount_in_currency = 0,
            metadata = metadata || jsonb_build_object(
                'crypto_kind', 'spot',
                'crypto_asset_id', _to_crypto_asset_id,
                'asset_symbol', _to_asset.symbol,
                'asset_name', _to_asset.name,
                'network_code', _to_asset.network_code,
                'contract_address', _to_asset.contract_address
            )
        WHERE id = _target_position_id;
    END IF;

    INSERT INTO portfolio_events (
        position_id,
        event_type,
        event_at,
        quantity,
        amount,
        currency_code,
        linked_operation_id,
        comment,
        metadata,
        created_by_user_id
    )
    VALUES
    (
        _position_id,
        'swap_out',
        COALESCE(_operated_at, current_date),
        _from_amount,
        NULL,
        NULL,
        _operation_id,
        NULLIF(btrim(_comment), ''),
        _metadata || jsonb_build_object('target_position_id', _target_position_id),
        _user_id
    ),
    (
        _target_position_id,
        'swap_in',
        COALESCE(_operated_at, current_date),
        _to_amount,
        NULL,
        NULL,
        _operation_id,
        NULLIF(btrim(_comment), ''),
        _metadata || jsonb_build_object('target_position_id', _target_position_id),
        _user_id
    );

    IF _from_amount = _source_quantity THEN
        UPDATE portfolio_positions
        SET status = 'closed',
            closed_at = COALESCE(_operated_at, current_date),
            close_amount_in_currency = 0,
            close_currency_code = currency_code
        WHERE id = _position_id;
    ELSE
        _remaining_quantity := _source_quantity - _from_amount;

        UPDATE portfolio_positions
        SET quantity = _remaining_quantity,
            amount_in_currency = 0
        WHERE id = _position_id;
    END IF;

    RETURN jsonb_build_object(
        'operation_id', _operation_id,
        'position_id', _target_position_id,
        'base_currency_code', budgeting.get__owner_base_currency(_source.owner_type, _source.owner_user_id, _source.owner_family_id)
    );
END
$function$;
