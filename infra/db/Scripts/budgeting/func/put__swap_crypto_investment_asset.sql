DROP FUNCTION IF EXISTS budgeting.put__swap_crypto_investment_asset;
CREATE FUNCTION budgeting.put__swap_crypto_investment_asset(
    _user_id bigint,
    _position_id bigint,
    _from_amount numeric,
    _to_crypto_asset_id bigint,
    _to_amount numeric,
    _target_investment_account_id bigint DEFAULT NULL,
    _comment text DEFAULT NULL,
    _operated_at date DEFAULT NULL,
    _value_in_base numeric DEFAULT NULL,
    _valuation_source text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
AS $function$
DECLARE
    _manual_carry boolean := NULLIF(current_setting('budgeting.crypto_source_event_id',true),'') IS NULL;
    _source record;
    _target_account record;
    _from_asset record;
    _to_asset record;
    _from_crypto_asset_id bigint;
    _source_quantity numeric(50, 18);
    _remaining_quantity numeric(50, 18);
    _resolved_target_account_id bigint;
    _target_position_id bigint;
    _operation_id bigint;
    _metadata jsonb;
    _entry_summary jsonb;
    _remaining_basis numeric(20, 2);
    _consumed_cost_basis numeric(20, 2);
    _resolved_value_in_base numeric(20, 2);
BEGIN
    SET search_path TO budgeting;

    IF _from_amount IS NULL OR _to_amount IS NULL OR _from_amount<=0 OR _to_amount<=0
        OR _from_amount::text IN ('NaN','Infinity','-Infinity')
        OR _to_amount::text IN ('NaN','Infinity','-Infinity')
        OR _from_amount<>round(_from_amount,18) OR _to_amount<>round(_to_amount,18) THEN
        RAISE EXCEPTION 'Swap quantities must be finite and positive with at most 18 decimals';
    END IF;
    IF _value_in_base IS NOT NULL AND (_value_in_base<0
        OR _value_in_base::text IN ('NaN','Infinity','-Infinity')
        OR _value_in_base<>round(_value_in_base,2)
        OR NULLIF(btrim(_valuation_source),'') IS NULL OR _operated_at IS NULL) THEN
        RAISE EXCEPTION 'Swap valuation requires a finite non-negative amount, date and source';
    END IF;

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

    -- Compute weighted-average consumed cost basis for the FROM side.
    _entry_summary := budgeting.get__crypto_position_movable_entry_summary(_position_id);
    _remaining_basis := (_entry_summary ->> 'remaining_cost_basis')::numeric;
    _consumed_cost_basis := CASE
        WHEN _source_quantity > 0
            THEN round(_remaining_basis * _from_amount / _source_quantity, 2)
        ELSE 0
    END;

    -- Manual personal accounting carries acquisition cost, as agreed for the
    -- imported history. A legacy market observation must not reprice capital.
    -- Journal callers keep their explicit policy and annotate both events there.
    _resolved_value_in_base := CASE WHEN _manual_carry THEN _consumed_cost_basis ELSE _value_in_base END;

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
        'to_amount', _to_amount,
        'value_at_swap_in_base', _value_in_base,
        'basis_policy', CASE WHEN _manual_carry THEN 'carry' ELSE 'journal' END,
        'valuation_source', NULLIF(btrim(_valuation_source),''),
        'valuation_date', _operated_at
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
        PERFORM budgeting.get__crypto_position_movable_entry_summary(_target_position_id);
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
        _metadata || jsonb_build_object(
            'target_position_id', _target_position_id,
            'value_in_base', _resolved_value_in_base,
            'consumed_cost_basis', _consumed_cost_basis,
            'basis_quality', _entry_summary->>'basis_quality',
            'realized_in_base', _resolved_value_in_base - _consumed_cost_basis,
            'target_kind', 'swap'
        ),
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
        _metadata || jsonb_build_object(
            'target_position_id', _target_position_id,
            'entry_value_in_base', _resolved_value_in_base,
            'basis_quality', CASE WHEN _manual_carry THEN _entry_summary->>'basis_quality' WHEN _resolved_value_in_base IS NULL THEN 'unknown' WHEN _resolved_value_in_base=0 THEN 'confirmed_zero' ELSE 'known' END,
            'source_kind', 'swap',
            'source_position_id', _position_id
        ),
        _user_id
    );

    IF _from_amount = _source_quantity THEN
        UPDATE portfolio_positions
        SET status = 'closed',
            quantity = 0,
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
