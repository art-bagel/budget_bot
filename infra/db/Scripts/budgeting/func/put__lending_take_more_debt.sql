DROP FUNCTION IF EXISTS budgeting.put__lending_take_more_debt;
CREATE FUNCTION budgeting.put__lending_take_more_debt(
    _user_id bigint,
    _position_id bigint,
    _debt_qty numeric,
    _value_in_base numeric DEFAULT NULL,
    _comment text DEFAULT NULL,
    _operated_at date DEFAULT NULL,
    _borrowed_crypto_asset_id bigint DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
AS $function$
DECLARE
    _existing record;
    _borrow_asset_id bigint;
    _borrow_asset record;
    _borrow_position record;
    _target_position_id bigint;
    _base_currency_code char(3);
    _asset_metadata jsonb;
    _current_borrowed numeric(50, 18);
    _new_borrowed numeric(50, 18);
    _existing_value numeric(20, 2);
    _new_value numeric(20, 2);
    _resolved_value numeric(20, 2);
    _event_id bigint;
BEGIN
    SET search_path TO budgeting;
    IF NULLIF(current_setting('budgeting.crypto_source_event_id',true),'') IS NULL AND EXISTS(
        SELECT 1 FROM crypto_protocol_positions WHERE id=_position_id AND
        (metadata->>'funding_policy'='components' OR COALESCE(metadata->'funding_units0','{}')<>'{}'::jsonb
            OR COALESCE(metadata->'funding_units1','{}')<>'{}'::jsonb)) THEN
        RAISE EXCEPTION 'Операции с заёмным финансированием проводятся через журнал криптоистории';
    END IF;


    IF _debt_qty IS NULL OR _debt_qty <= 0
       OR _debt_qty::text IN ('NaN', 'Infinity', '-Infinity') OR _debt_qty<>round(_debt_qty,18) THEN
        RAISE EXCEPTION 'Debt quantity must be positive';
    END IF;
    _debt_qty := round(_debt_qty, 18);
    IF _debt_qty <= 0 OR (_value_in_base IS NOT NULL AND (_value_in_base < 0
       OR _value_in_base::text IN ('NaN', 'Infinity', '-Infinity'))) THEN
        RAISE EXCEPTION 'Для займа нужна положительная историческая оценка в базовой валюте';
    END IF;

    SELECT *
    INTO _existing
    FROM crypto_protocol_positions
    WHERE id = _position_id
    FOR UPDATE;

    IF _existing.id IS NULL THEN
        RAISE EXCEPTION 'Unknown crypto protocol position %', _position_id;
    END IF;

    IF _existing.position_type <> 'lending' THEN
        RAISE EXCEPTION 'Only lending positions can take debt';
    END IF;

    IF _existing.status <> 'open' THEN
        RAISE EXCEPTION 'Closed lending position cannot take more debt';
    END IF;

    IF NOT budgeting.has__owner_access(_user_id, _existing.owner_type, _existing.owner_user_id, _existing.owner_family_id) THEN
        RAISE EXCEPTION 'Access denied to protocol position %', _position_id;
    END IF;

    IF COALESCE((_existing.metadata ->> 'borrowed_quantity')::numeric, 0) > 0
       AND (_existing.metadata ->> 'debt_accounting_version') IS DISTINCT FROM '2' THEN
        RAISE EXCEPTION 'Legacy loan must be reconstructed before changing its debt';
    END IF;

    _borrow_asset_id := NULLIF((_existing.metadata ->> 'borrowed_crypto_asset_id'), '')::bigint;
    IF _borrow_asset_id IS NULL THEN
        IF _borrowed_crypto_asset_id IS NULL THEN
            RAISE EXCEPTION 'Lending position has no borrowed asset; pass _borrowed_crypto_asset_id';
        END IF;
        _borrow_asset_id := _borrowed_crypto_asset_id;
    ELSIF _borrowed_crypto_asset_id IS NOT NULL AND _borrowed_crypto_asset_id <> _borrow_asset_id THEN
        RAISE EXCEPTION 'Заём по этому лендингу уже идёт в другой монете';
    END IF;

    -- One live debt per currency within the same on-chain lending account.
    IF _existing.metadata->>'lending_account_key' IS NOT NULL AND EXISTS (
        SELECT 1 FROM crypto_protocol_positions p
        WHERE p.id<>_existing.id AND p.investment_account_id=_existing.investment_account_id
          AND p.network_code IS NOT DISTINCT FROM _existing.network_code
          AND p.status='open' AND p.position_type='lending'
          AND p.metadata->>'lending_account_key'=_existing.metadata->>'lending_account_key'
          AND (p.metadata->>'borrowed_crypto_asset_id')::bigint=_borrow_asset_id
          AND COALESCE((p.metadata->>'borrowed_quantity')::numeric,0)>0
    ) THEN
        RAISE EXCEPTION 'По этому счёту уже есть долг в данной монете; используйте позицию общего долга';
    END IF;

    SELECT *
    INTO _borrow_asset
    FROM crypto_assets
    WHERE id = _borrow_asset_id;

    IF _borrow_asset.id IS NULL THEN
        RAISE EXCEPTION 'Unknown borrowed crypto asset %', _borrow_asset_id;
    END IF;

    _base_currency_code := budgeting.get__owner_base_currency(_existing.owner_type, _existing.owner_user_id, _existing.owner_family_id);

    _asset_metadata := jsonb_build_object(
        'crypto_kind', 'spot',
        'crypto_asset_id', _borrow_asset.id,
        'asset_symbol', _borrow_asset.symbol,
        'asset_name', _borrow_asset.name,
        'network_code', _borrow_asset.network_code,
        'contract_address', _borrow_asset.contract_address
    );

    SELECT *
    INTO _borrow_position
    FROM portfolio_positions
    WHERE investment_account_id = _existing.investment_account_id
      AND asset_type_code = 'crypto'
      AND status = 'open'
      AND COALESCE((metadata ->> 'crypto_asset_id')::bigint, 0) = _borrow_asset.id
    ORDER BY opened_at ASC, id ASC
    LIMIT 1
    FOR UPDATE;

    IF COALESCE((_existing.metadata->>'borrowed_quantity')::numeric,0)>0 THEN
        PERFORM budgeting.check__crypto_lending_state(_existing.metadata);
    END IF;
    _resolved_value := round(_value_in_base, 2);

    IF _borrow_position.id IS NOT NULL THEN
        UPDATE portfolio_positions
        SET quantity = COALESCE(quantity, 0) + _debt_qty,
            amount_in_currency = 0,
            metadata = metadata || _asset_metadata
        WHERE id = _borrow_position.id;
        _target_position_id := _borrow_position.id;

        INSERT INTO portfolio_events (
            position_id, event_type, event_at, quantity, amount, currency_code,
            linked_operation_id, comment, metadata, created_by_user_id
        )
        VALUES (
            _target_position_id,
            'top_up',
            COALESCE(_operated_at, current_date),
            _debt_qty,
            NULL, NULL, NULL,
            COALESCE(NULLIF(btrim(_comment), ''), 'Дополнительный заём (лендинг)'),
            _asset_metadata || jsonb_build_object(
                'action', 'lending_take_more_debt',
                'protocol_position_id', _position_id,
                'protocol_name', _existing.protocol_name,
                'entry_value_in_base', _resolved_value,
                'basis_quality', CASE WHEN _resolved_value IS NULL THEN 'unknown' WHEN _resolved_value=0 THEN 'confirmed_zero' ELSE 'known' END,
                'own_funding_in_base', 0,
                'debt_accounting_version', 2,
                'source_kind', 'lending_borrow',
                'value_in_base', _resolved_value
            ),
            _user_id
        ) RETURNING id INTO _event_id;
    ELSE
        INSERT INTO portfolio_positions (
            owner_type, owner_user_id, owner_family_id, investment_account_id,
            asset_type_code, title, quantity, amount_in_currency, currency_code,
            opened_at, comment, metadata, created_by_user_id
        )
        VALUES (
            _existing.owner_type, _existing.owner_user_id, _existing.owner_family_id,
            _existing.investment_account_id,
            'crypto', _borrow_asset.symbol, _debt_qty, 0, _base_currency_code,
            COALESCE(_operated_at, current_date),
            COALESCE(NULLIF(btrim(_comment), ''), 'Дополнительный заём (лендинг)'),
            _asset_metadata,
            _user_id
        )
        RETURNING id INTO _target_position_id;

        INSERT INTO portfolio_events (
            position_id, event_type, event_at, quantity, amount, currency_code,
            linked_operation_id, comment, metadata, created_by_user_id
        )
        VALUES (
            _target_position_id,
            'open',
            COALESCE(_operated_at, current_date),
            _debt_qty,
            NULL, NULL, NULL,
            COALESCE(NULLIF(btrim(_comment), ''), 'Дополнительный заём (лендинг)'),
            _asset_metadata || jsonb_build_object(
                'action', 'lending_take_more_debt',
                'protocol_position_id', _position_id,
                'protocol_name', _existing.protocol_name,
                'entry_value_in_base', _resolved_value,
                'basis_quality', CASE WHEN _resolved_value IS NULL THEN 'unknown' WHEN _resolved_value=0 THEN 'confirmed_zero' ELSE 'known' END,
                'own_funding_in_base', 0,
                'debt_accounting_version', 2,
                'source_kind', 'lending_borrow',
                'value_in_base', _resolved_value
            ),
            _user_id
        ) RETURNING id INTO _event_id;
    END IF;

    _current_borrowed := COALESCE(NULLIF(_existing.metadata ->> 'borrowed_quantity', ''), '0')::numeric;
    _new_borrowed := round(_current_borrowed + _debt_qty, 18);
    _existing_value := CASE WHEN _current_borrowed=0 THEN 0 ELSE (_existing.metadata ->> 'debt_cost_basis_in_base')::numeric END;
    _new_value := round(_existing_value + _resolved_value, 2);

    UPDATE crypto_protocol_positions
    SET metadata = metadata || jsonb_build_object(
            'borrowed_crypto_asset_id', _borrow_asset.id,
            'borrowed_asset', _borrow_asset.symbol,
            'borrowed_asset_symbol', _borrow_asset.symbol,
            'borrowed_quantity', _new_borrowed,
            'borrowed_position_id', _target_position_id,
            'borrowed_value_in_base', _new_value,
            'debt_cost_basis_in_base', _new_value,
            'debt_basis_quality', CASE WHEN _new_value IS NULL THEN 'unknown' WHEN _existing.metadata->>'debt_basis_quality'='estimated' THEN 'estimated' ELSE 'known' END,
            'debt_accounting_version', 2
        ),
        updated_at = current_timestamp
    WHERE id = _position_id;

    INSERT INTO crypto_liability_events(protocol_position_id, portfolio_event_id,
        crypto_asset_id, event_kind, event_at, quantity, debt_basis_change_in_base,
        settlement_value_in_base, created_by_user_id)
    VALUES (_position_id, _event_id, _borrow_asset.id, 'borrow',
        COALESCE(_operated_at, current_date), _debt_qty, _resolved_value,
        _resolved_value, _user_id);

    RETURN (
        SELECT item
        FROM jsonb_array_elements(budgeting.get__crypto_protocol_positions(_user_id, _existing.investment_account_id, NULL)) item
        WHERE (item ->> 'id')::bigint = _position_id
    );
END
$function$;
