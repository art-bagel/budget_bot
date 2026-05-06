DROP FUNCTION IF EXISTS budgeting.put__transfer_crypto_between_investment_accounts;
CREATE FUNCTION budgeting.put__transfer_crypto_between_investment_accounts(
    _user_id bigint,
    _position_id bigint,
    _target_investment_account_id bigint,
    _amount numeric,
    _comment text DEFAULT NULL,
    _operated_at date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
AS $function$
DECLARE
    _source record;
    _target_account record;
    _asset record;
    _crypto_asset_id bigint;
    _source_quantity numeric(30, 12);
    _remaining_quantity numeric(30, 12);
    _target_position_id bigint;
    _operation_id bigint;
    _metadata jsonb;
    _entry_summary jsonb;
    _remaining_basis numeric(20, 2);
    _consumed_cost_basis numeric(20, 2);
BEGIN
    SET search_path TO budgeting;

    IF _amount <= 0 THEN
        RAISE EXCEPTION 'Amount must be positive';
    END IF;
    _amount := round(_amount, 12);

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

    IF _source.investment_account_id = _target_investment_account_id THEN
        RAISE EXCEPTION 'Target account must be different';
    END IF;

    _crypto_asset_id := (_source.metadata ->> 'crypto_asset_id')::bigint;
    IF _crypto_asset_id IS NULL THEN
        RAISE EXCEPTION 'Crypto asset metadata is missing for portfolio position %', _position_id;
    END IF;

    SELECT *
    INTO _asset
    FROM crypto_assets
    WHERE id = _crypto_asset_id;

    IF _asset.id IS NULL THEN
        RAISE EXCEPTION 'Unknown crypto asset %', _crypto_asset_id;
    END IF;

    SELECT *
    INTO _target_account
    FROM bank_accounts
    WHERE id = _target_investment_account_id
      AND is_active;

    IF _target_account.id IS NULL THEN
        RAISE EXCEPTION 'Unknown active investment account %', _target_investment_account_id;
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
    IF _source_quantity < _amount THEN
        RAISE EXCEPTION 'Сумма превышает остаток';
    END IF;

    -- Compute weighted-average consumed cost basis to carry over to target.
    _entry_summary := budgeting.get__crypto_position_entry_summary(_position_id);
    _remaining_basis := COALESCE((_entry_summary ->> 'remaining_cost_basis')::numeric, 0);
    _consumed_cost_basis := CASE
        WHEN _source_quantity > 0
            THEN round(_remaining_basis * _amount / _source_quantity, 2)
        ELSE 0
    END;

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
        COALESCE(_comment, 'Перевод криптовалюты между инвестиционными счетами'),
        COALESCE(_operated_at, current_date)
    )
    RETURNING id INTO _operation_id;

    _metadata := jsonb_build_object(
        'crypto_asset_id', _crypto_asset_id,
        'asset_symbol', _asset.symbol,
        'asset_name', _asset.name,
        'network_code', _asset.network_code,
        'contract_address', _asset.contract_address,
        'source_position_id', _position_id,
        'source_investment_account_id', _source.investment_account_id,
        'target_investment_account_id', _target_investment_account_id
    );

    SELECT id
    INTO _target_position_id
    FROM portfolio_positions
    WHERE investment_account_id = _target_investment_account_id
      AND asset_type_code = 'crypto'
      AND status = 'open'
      AND metadata ->> 'crypto_asset_id' ~ '^[0-9]+$'
      AND (metadata ->> 'crypto_asset_id')::bigint = _crypto_asset_id
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
            _target_investment_account_id,
            'crypto',
            COALESCE(NULLIF(btrim(_source.title), ''), _asset.symbol),
            _amount,
            0,
            _source.currency_code,
            COALESCE(_operated_at, current_date),
            NULLIF(btrim(_comment), ''),
            _metadata,
            _user_id
        )
        RETURNING id INTO _target_position_id;
    ELSE
        UPDATE portfolio_positions
        SET quantity = COALESCE(quantity, 0) + _amount,
            amount_in_currency = 0,
            metadata = metadata || _metadata
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
        'transfer_out',
        COALESCE(_operated_at, current_date),
        _amount,
        NULL,
        NULL,
        _operation_id,
        NULLIF(btrim(_comment), ''),
        _metadata || jsonb_build_object(
            'target_position_id', _target_position_id,
            'value_in_base', _consumed_cost_basis,
            'consumed_cost_basis', _consumed_cost_basis,
            'realized_in_base', 0,
            'target_kind', 'cross_account'
        ),
        _user_id
    ),
    (
        _target_position_id,
        'transfer_in',
        COALESCE(_operated_at, current_date),
        _amount,
        NULL,
        NULL,
        _operation_id,
        NULLIF(btrim(_comment), ''),
        _metadata || jsonb_build_object(
            'target_position_id', _target_position_id,
            'entry_value_in_base', _consumed_cost_basis,
            'source_kind', 'cross_account',
            'source_position_id', _position_id
        ),
        _user_id
    );

    IF _amount = _source_quantity THEN
        UPDATE portfolio_positions
        SET status = 'closed',
            closed_at = COALESCE(_operated_at, current_date),
            close_amount_in_currency = 0,
            close_currency_code = currency_code
        WHERE id = _position_id;
    ELSE
        _remaining_quantity := _source_quantity - _amount;

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
