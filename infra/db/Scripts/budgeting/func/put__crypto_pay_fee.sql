DROP FUNCTION IF EXISTS budgeting.put__crypto_pay_fee;
CREATE FUNCTION budgeting.put__crypto_pay_fee(
    _user_id bigint,
    _source_position_id bigint,
    _quantity numeric,
    _comment text DEFAULT NULL,
    _operated_at date DEFAULT NULL,
    _link_protocol_position_id bigint DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
AS $function$
DECLARE
    _source_position record;
    _source_quantity numeric(30, 12);
    _remaining_quantity numeric(30, 12);
    _entry_summary jsonb;
    _remaining_basis numeric(20, 2);
    _consumed_cost_basis numeric(20, 2);
BEGIN
    SET search_path TO budgeting;

    IF _quantity IS NULL OR _quantity <= 0 THEN
        RAISE EXCEPTION 'Fee quantity must be positive';
    END IF;
    _quantity := round(_quantity, 12);

    SELECT *
    INTO _source_position
    FROM portfolio_positions
    WHERE id = _source_position_id
      AND status = 'open'
    FOR UPDATE;

    IF _source_position.id IS NULL THEN
        RAISE EXCEPTION 'Unknown open crypto asset position %', _source_position_id;
    END IF;

    IF _source_position.asset_type_code <> 'crypto' THEN
        RAISE EXCEPTION 'Fee can only be paid from a crypto asset position';
    END IF;

    IF NOT budgeting.has__owner_access(_user_id, _source_position.owner_type, _source_position.owner_user_id, _source_position.owner_family_id) THEN
        RAISE EXCEPTION 'Access denied to position %', _source_position_id;
    END IF;

    _source_quantity := COALESCE(_source_position.quantity, 0);
    IF _source_quantity < _quantity THEN
        RAISE EXCEPTION 'Сумма превышает остаток';
    END IF;

    _remaining_quantity := round(_source_quantity - _quantity, 12);

    _entry_summary := budgeting.get__crypto_position_entry_summary(_source_position_id);
    _remaining_basis := COALESCE((_entry_summary ->> 'remaining_cost_basis')::numeric, 0);
    _consumed_cost_basis := CASE
        WHEN _source_quantity > 0
            THEN round(_remaining_basis * _quantity / _source_quantity, 2)
        ELSE 0
    END;

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
        'fee',
        COALESCE(_operated_at, current_date),
        _quantity,
        NULL, NULL, NULL,
        COALESCE(NULLIF(btrim(_comment), ''), 'Газ за DeFi-операцию'),
        jsonb_build_object(
            'action', 'defi_gas_fee',
            'consumed_cost_basis', _consumed_cost_basis,
            'value_in_base', _consumed_cost_basis,
            'realized_in_base', -_consumed_cost_basis,
            'protocol_position_id', _link_protocol_position_id
        ),
        _user_id
    );

    RETURN jsonb_build_object(
        'position_id', _source_position_id,
        'remaining_quantity', _remaining_quantity,
        'consumed_cost_basis', _consumed_cost_basis
    );
END
$function$;
