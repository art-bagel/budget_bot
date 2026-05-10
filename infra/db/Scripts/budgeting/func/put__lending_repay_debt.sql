DROP FUNCTION IF EXISTS budgeting.put__lending_repay_debt;
CREATE FUNCTION budgeting.put__lending_repay_debt(
    _user_id bigint,
    _position_id bigint,
    _source_position_id bigint,
    _repay_qty numeric,
    _value_in_base numeric DEFAULT NULL,
    _comment text DEFAULT NULL,
    _operated_at date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
AS $function$
DECLARE
    _existing record;
    _source_position record;
    _borrow_asset_id bigint;
    _source_asset_id bigint;
    _source_quantity numeric(30, 12);
    _remaining_quantity numeric(30, 12);
    _current_borrowed numeric(30, 12);
    _new_borrowed numeric(30, 12);
    _existing_value numeric(20, 2);
    _new_value numeric(20, 2);
    _resolved_value numeric(20, 2);
    _entry_summary jsonb;
    _remaining_basis numeric(20, 2);
    _consumed_basis numeric(20, 2);
BEGIN
    SET search_path TO budgeting;

    IF _repay_qty IS NULL OR _repay_qty <= 0 THEN
        RAISE EXCEPTION 'Repay quantity must be positive';
    END IF;
    _repay_qty := round(_repay_qty, 12);

    SELECT *
    INTO _existing
    FROM crypto_protocol_positions
    WHERE id = _position_id
    FOR UPDATE;

    IF _existing.id IS NULL THEN
        RAISE EXCEPTION 'Unknown crypto protocol position %', _position_id;
    END IF;

    IF _existing.position_type <> 'lending' THEN
        RAISE EXCEPTION 'Only lending positions can repay debt';
    END IF;

    IF _existing.status <> 'open' THEN
        RAISE EXCEPTION 'Closed lending position cannot repay debt';
    END IF;

    IF NOT budgeting.has__owner_access(_user_id, _existing.owner_type, _existing.owner_user_id, _existing.owner_family_id) THEN
        RAISE EXCEPTION 'Access denied to protocol position %', _position_id;
    END IF;

    _borrow_asset_id := NULLIF((_existing.metadata ->> 'borrowed_crypto_asset_id'), '')::bigint;
    IF _borrow_asset_id IS NULL THEN
        RAISE EXCEPTION 'Lending position has no borrowed asset configured';
    END IF;

    _current_borrowed := COALESCE(NULLIF(_existing.metadata ->> 'borrowed_quantity', ''), '0')::numeric;
    IF _current_borrowed <= 0 THEN
        RAISE EXCEPTION 'Долг уже погашен';
    END IF;

    IF _repay_qty > _current_borrowed THEN
        RAISE EXCEPTION 'Сумма погашения превышает текущий долг';
    END IF;

    SELECT *
    INTO _source_position
    FROM portfolio_positions
    WHERE id = _source_position_id
      AND status = 'open'
    FOR UPDATE;

    IF _source_position.id IS NULL THEN
        RAISE EXCEPTION 'Unknown open crypto asset position %', _source_position_id;
    END IF;

    IF _source_position.investment_account_id <> _existing.investment_account_id
       OR _source_position.asset_type_code <> 'crypto' THEN
        RAISE EXCEPTION 'Source position must be an open crypto asset on the same account';
    END IF;

    _source_asset_id := COALESCE((_source_position.metadata ->> 'crypto_asset_id')::bigint, 0);
    IF _source_asset_id <> _borrow_asset_id THEN
        RAISE EXCEPTION 'Repay must use the borrowed asset';
    END IF;

    _source_quantity := COALESCE(_source_position.quantity, 0);
    IF _source_quantity < _repay_qty THEN
        RAISE EXCEPTION 'Сумма превышает остаток';
    END IF;

    _remaining_quantity := round(_source_quantity - _repay_qty, 12);

    -- Compute consumed cost basis (so cost basis on remaining position stays consistent).
    _entry_summary := budgeting.get__crypto_position_entry_summary(_source_position_id);
    _remaining_basis := COALESCE((_entry_summary ->> 'remaining_cost_basis')::numeric, 0);
    _consumed_basis := CASE
        WHEN _source_quantity > 0
            THEN round(_remaining_basis * _repay_qty / _source_quantity, 2)
        ELSE 0
    END;

    _resolved_value := round(COALESCE(_value_in_base, _consumed_basis, 0), 2);

    IF _remaining_quantity <= 0 THEN
        UPDATE portfolio_positions
        SET status = 'closed',
            quantity = 0,
            closed_at = COALESCE(_operated_at, current_date),
            close_amount_in_currency = 0,
            close_currency_code = currency_code
        WHERE id = _source_position_id;
    ELSE
        UPDATE portfolio_positions
        SET quantity = _remaining_quantity,
            amount_in_currency = 0
        WHERE id = _source_position_id;
    END IF;

    INSERT INTO portfolio_events (
        position_id, event_type, event_at, quantity, amount, currency_code,
        linked_operation_id, comment, metadata, created_by_user_id
    )
    VALUES (
        _source_position_id,
        'transfer_out',
        COALESCE(_operated_at, current_date),
        _repay_qty,
        NULL, NULL, NULL,
        COALESCE(NULLIF(btrim(_comment), ''), 'Погашение долга (лендинг)'),
        jsonb_build_object(
            'action', 'lending_repay',
            'protocol_position_id', _position_id,
            'protocol_name', _existing.protocol_name,
            'value_in_base', _resolved_value,
            'consumed_cost_basis', _consumed_basis,
            'realized_in_base', 0,
            'target_kind', 'lending_repay'
        ),
        _user_id
    );

    _new_borrowed := round(_current_borrowed - _repay_qty, 12);
    _existing_value := COALESCE(NULLIF(_existing.metadata ->> 'borrowed_value_in_base', ''), '0')::numeric;
    _new_value := round(GREATEST(_existing_value - _resolved_value, 0), 2);

    UPDATE crypto_protocol_positions
    SET metadata = metadata || jsonb_build_object(
            'borrowed_quantity', _new_borrowed,
            'borrowed_value_in_base', _new_value
        ),
        updated_at = current_timestamp
    WHERE id = _position_id;

    RETURN (
        SELECT item
        FROM jsonb_array_elements(budgeting.get__crypto_protocol_positions(_user_id, _existing.investment_account_id, NULL)) item
        WHERE (item ->> 'id')::bigint = _position_id
    );
END
$function$;
