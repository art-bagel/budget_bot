DROP FUNCTION IF EXISTS budgeting.put__lending_repay_debt;
CREATE FUNCTION budgeting.put__lending_repay_debt(
    _user_id bigint,
    _position_id bigint,
    _source_position_id bigint,
    _repay_qty numeric,
    _value_in_base numeric DEFAULT NULL,
    _comment text DEFAULT NULL,
    _operated_at date DEFAULT NULL,
    _interest_qty numeric DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
AS $function$
DECLARE
    _existing record;
    _source_position record;
    _borrow_asset_id bigint;
    _source_asset_id bigint;
    _source_quantity numeric(50, 18);
    _remaining_quantity numeric(50, 18);
    _current_borrowed numeric(50, 18);
    _new_borrowed numeric(50, 18);
    _existing_value numeric(20, 2);
    _new_value numeric(20, 2);
    _resolved_value numeric(20, 2);
    _entry_summary jsonb;
    _remaining_basis numeric(20, 2);
    _consumed_basis numeric(20, 2);
    _debt_basis_consumed numeric(20, 2);
    _event_id bigint;
    _interest_remaining numeric(50,18);
    _interest_basis numeric(20,2);
    _interest_basis_consumed numeric(20,2);
    _principal_qty numeric(50,18);
    _principal_remaining numeric(50,18);
BEGIN
    SET search_path TO budgeting;

    IF _repay_qty IS NULL OR _repay_qty <= 0 THEN
        RAISE EXCEPTION 'Repay quantity must be positive';
    END IF;
    _repay_qty := round(_repay_qty, 18);
    IF _repay_qty <= 0 OR _repay_qty::text IN ('NaN', 'Infinity', '-Infinity') THEN
        RAISE EXCEPTION 'Repay quantity must be finite and positive';
    END IF;
    IF _value_in_base IS NOT NULL AND (_value_in_base <= 0
       OR _value_in_base::text IN ('NaN', 'Infinity', '-Infinity')) THEN
        RAISE EXCEPTION 'Repayment valuation must be finite and positive';
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

    IF (_existing.metadata ->> 'debt_accounting_version') IS DISTINCT FROM '2'
       OR NOT (_existing.metadata ? 'debt_cost_basis_in_base') THEN
        RAISE EXCEPTION 'Legacy loan must be reconstructed before repayment';
    END IF;

    _interest_remaining := COALESCE((_existing.metadata ->> 'debt_interest_quantity')::numeric, 0);
    _interest_basis := COALESCE((_existing.metadata ->> 'debt_interest_basis_in_base')::numeric, 0);
    IF _interest_qty IS NULL OR _interest_qty < 0 OR _interest_qty > _repay_qty
       OR _interest_qty > _interest_remaining
       OR _interest_qty::text IN ('NaN', 'Infinity', '-Infinity') THEN
        RAISE EXCEPTION 'Invalid interest repayment quantity';
    END IF;
    _principal_qty := _repay_qty - _interest_qty;
    _principal_remaining := _current_borrowed - _interest_remaining;
    IF _principal_qty > _principal_remaining THEN
        RAISE EXCEPTION 'Repayment exceeds principal; specify accrued interest separately';
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

    _remaining_quantity := round(_source_quantity - _repay_qty, 18);

    -- Compute consumed cost basis (so cost basis on remaining position stays consistent).
    _entry_summary := budgeting.get__crypto_position_known_entry_summary(_source_position_id);
    _remaining_basis := COALESCE((_entry_summary ->> 'remaining_cost_basis')::numeric, 0);
    _consumed_basis := CASE
        WHEN _source_quantity > 0
            THEN round(_remaining_basis * _repay_qty / _source_quantity, 2)
        ELSE 0
    END;

    -- Historical debt cost is released proportionally, never by today's price
    -- or by the cost of the coins used for repayment.
    _existing_value := (_existing.metadata ->> 'debt_cost_basis_in_base')::numeric;
    _interest_basis_consumed := CASE WHEN _interest_qty = 0 THEN 0
        WHEN _interest_qty = _interest_remaining THEN _interest_basis
        ELSE round(_interest_basis * _interest_qty / _interest_remaining, 2) END;
    _debt_basis_consumed := _interest_basis_consumed + CASE WHEN _principal_qty = 0 THEN 0
        WHEN _principal_qty = _principal_remaining THEN _existing_value - _interest_basis
        ELSE round((_existing_value - _interest_basis) * _principal_qty / _principal_remaining, 2) END;
    -- Without a settlement quote, combined realized result is still known,
    -- but the asset/debt price components remain unknown rather than invented.
    _resolved_value := round(_value_in_base, 2);

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
            'realized_in_base', _debt_basis_consumed - _consumed_basis,
            'asset_realized_in_base', _resolved_value - _consumed_basis,
            'liability_realized_in_base', _debt_basis_consumed - _resolved_value,
            'debt_basis_consumed_in_base', _debt_basis_consumed,
            'interest_quantity', _interest_qty,
            'principal_quantity', _principal_qty,
            'interest_basis_consumed_in_base', _interest_basis_consumed,
            'debt_accounting_version', 2,
            'target_kind', 'lending_repay'
        ),
        _user_id
    ) RETURNING id INTO _event_id;

    _new_borrowed := round(_current_borrowed - _repay_qty, 18);
    _new_value := _existing_value - _debt_basis_consumed;

    UPDATE crypto_protocol_positions
    SET metadata = metadata || jsonb_build_object(
            'borrowed_quantity', _new_borrowed,
            'borrowed_value_in_base', _new_value,
            'debt_cost_basis_in_base', _new_value,
            'debt_interest_quantity', _interest_remaining - _interest_qty,
            'debt_interest_basis_in_base', _interest_basis - _interest_basis_consumed
        ),
        updated_at = current_timestamp
    WHERE id = _position_id;

    INSERT INTO crypto_liability_events(protocol_position_id, portfolio_event_id,
        crypto_asset_id, event_kind, event_at, quantity, debt_basis_change_in_base,
        settlement_value_in_base, asset_cost_consumed_in_base,
        realized_in_base, interest_quantity, interest_basis_change_in_base, created_by_user_id)
    VALUES (_position_id, _event_id, _borrow_asset_id, CASE WHEN _interest_qty > 0 THEN 'repayment' ELSE 'principal_repayment' END,
        COALESCE(_operated_at, current_date), -_repay_qty, -_debt_basis_consumed,
        _resolved_value, _consumed_basis, _debt_basis_consumed - _consumed_basis, -_interest_qty, -_interest_basis_consumed, _user_id);

    RETURN (
        SELECT item
        FROM jsonb_array_elements(budgeting.get__crypto_protocol_positions(_user_id, _existing.investment_account_id, NULL)) item
        WHERE (item ->> 'id')::bigint = _position_id
    );
END
$function$;
