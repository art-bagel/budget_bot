DROP FUNCTION IF EXISTS budgeting.put__transfer_crypto_from_investment;
CREATE FUNCTION budgeting.put__transfer_crypto_from_investment(
    _user_id bigint,
    _position_id bigint,
    _bank_account_id bigint,
    _amount numeric,
    _value_in_base numeric DEFAULT NULL,
    _comment text DEFAULT NULL,
    _operated_at date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
AS $function$
DECLARE
    _position record;
    _bank_owner_type text;
    _bank_owner_user_id bigint;
    _bank_owner_family_id bigint;
    _bank_account_kind text;
    _bank_asset_type text;
    _base_currency_code char(3);
    _to_unallocated_id bigint;
    _crypto_asset_id bigint;
    _position_quantity numeric(50, 18);
    _operation_id bigint;
    _event_type text;
    _remaining_quantity numeric(50, 18);
    _entry_summary jsonb;
    _remaining_basis numeric(20, 2);
    _consumed_cost_basis numeric(20, 2);
BEGIN
    SET search_path TO budgeting;

    IF _amount IS NULL OR _amount::text IN ('NaN','Infinity','-Infinity')
       OR _amount <= 0 OR _amount <> round(_amount,18) THEN
        RAISE EXCEPTION 'Crypto transfer amount must be positive with at most 18 decimals';
    END IF;
    -- Kept for old clients as an optional observation, never as transfer cost.
    IF _value_in_base IS NOT NULL AND
       (_value_in_base::text IN ('NaN','Infinity','-Infinity') OR _value_in_base < 0) THEN
        RAISE EXCEPTION 'Observed value must be finite and non-negative';
    END IF;

    SELECT *
    INTO _position
    FROM portfolio_positions
    WHERE id = _position_id
      AND status = 'open'
      AND asset_type_code = 'crypto'
    FOR UPDATE;

    IF _position.id IS NULL THEN
        RAISE EXCEPTION 'Unknown open crypto portfolio position %', _position_id;
    END IF;

    IF NOT budgeting.has__owner_access(_user_id, _position.owner_type, _position.owner_user_id, _position.owner_family_id) THEN
        RAISE EXCEPTION 'Access denied to portfolio position %', _position_id;
    END IF;

    SELECT owner_type, owner_user_id, owner_family_id, account_kind, investment_asset_type
    INTO _bank_owner_type, _bank_owner_user_id, _bank_owner_family_id, _bank_account_kind, _bank_asset_type
    FROM bank_accounts
    WHERE id = _bank_account_id
      AND is_active;

    IF _bank_owner_type IS NULL THEN
        RAISE EXCEPTION 'Unknown active bank account %', _bank_account_id;
    END IF;

    -- A collection account keeps coins like a bank, but it is an investment
    -- account: the move stays outside the budget.
    IF NOT (_bank_account_kind = 'cash' OR _bank_asset_type = 'collectible') THEN
        RAISE EXCEPTION 'Target account must be a cash or collection account';
    END IF;

    IF _bank_owner_type <> _position.owner_type
       OR COALESCE(_bank_owner_user_id, 0) <> COALESCE(_position.owner_user_id, 0)
       OR COALESCE(_bank_owner_family_id, 0) <> COALESCE(_position.owner_family_id, 0) THEN
        RAISE EXCEPTION 'Bank account and crypto position must have the same owner';
    END IF;

    _crypto_asset_id := (_position.metadata ->> 'crypto_asset_id')::bigint;
    IF _crypto_asset_id IS NULL THEN
        RAISE EXCEPTION 'Crypto asset metadata is missing for portfolio position %', _position_id;
    END IF;

    _position_quantity := COALESCE(_position.quantity, 0);
    IF _position_quantity < _amount THEN
        RAISE EXCEPTION 'Сумма превышает остаток';
    END IF;

    _base_currency_code := budgeting.get__owner_base_currency(_position.owner_type, _position.owner_user_id, _position.owner_family_id);
    _to_unallocated_id := budgeting.get__owner_system_category_id(
        _bank_owner_type,
        _bank_owner_user_id,
        _bank_owner_family_id,
        'Unallocated'
    );

    IF _to_unallocated_id IS NULL THEN
        RAISE EXCEPTION 'Unallocated category missing for target account %', _bank_account_id;
    END IF;

    -- Compute weighted-average consumed cost basis for this exit.
    IF NULLIF(current_setting('budgeting.crypto_source_event_id',true),'') IS NOT NULL THEN
        _entry_summary := budgeting.get__crypto_position_movable_entry_summary(_position_id);
        IF _entry_summary->>'remaining_cost_basis' IS NULL THEN
            RAISE EXCEPTION 'Cannot transfer unknown cost to a bank';
        END IF;
    ELSE
        _entry_summary := budgeting.get__crypto_position_known_entry_summary(_position_id);
    END IF;
    _remaining_basis := COALESCE((_entry_summary ->> 'remaining_cost_basis')::numeric, 0);
    _consumed_cost_basis := CASE
        WHEN _position_quantity > 0
            THEN round(_remaining_basis * _amount / _position_quantity, 2)
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
        _position.owner_type,
        _position.owner_user_id,
        _position.owner_family_id,
        'investment_trade',
        COALESCE(_comment, 'Вывод криптовалюты из инвестиций'),
        COALESCE(_operated_at, current_date)
    )
    RETURNING id INTO _operation_id;

    INSERT INTO crypto_bank_entries (operation_id, bank_account_id, crypto_asset_id, amount)
    VALUES (_operation_id, _bank_account_id, _crypto_asset_id, _amount);

    IF _bank_account_kind = 'cash' THEN
        INSERT INTO budget_entries (operation_id, category_id, currency_code, amount)
        VALUES (_operation_id, _to_unallocated_id, _base_currency_code, _consumed_cost_basis);
    END IF;

    INSERT INTO crypto_lots (
        bank_account_id,
        crypto_asset_id,
        amount_initial,
        amount_remaining,
        cost_base_initial,
        cost_base_remaining,
        opened_by_operation_id,
        metadata
    )
    VALUES (
        _bank_account_id,
        _crypto_asset_id,
        _amount,
        _amount,
        _consumed_cost_basis,
        _consumed_cost_basis,
        _operation_id,
        jsonb_build_object('source', 'investment_withdrawal', 'position_id', _position_id,
            'basis_quality', _entry_summary->>'basis_quality')
    );

    _event_type := 'transfer_out';

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
    VALUES (
        _position_id,
        _event_type,
        COALESCE(_operated_at, current_date),
        _amount,
        _consumed_cost_basis,
        _base_currency_code,
        _operation_id,
        NULLIF(btrim(_comment), ''),
        jsonb_build_object(
            'amount_in_base', _consumed_cost_basis,
            'value_in_base', _consumed_cost_basis,
            'consumed_cost_basis', _consumed_cost_basis,
            'realized_in_base', 0,
            'basis_quality', _entry_summary->>'basis_quality',
            'observed_value_in_base', _value_in_base,
            'crypto_asset_id', _crypto_asset_id,
            'action', 'transfer_to_banking',
            'target_kind', CASE WHEN _bank_account_kind = 'cash' THEN 'bank' ELSE 'collection' END,
            'target_bank_account_id', _bank_account_id
        ),
        _user_id
    );

    IF _amount = _position_quantity THEN
        UPDATE portfolio_positions
        SET status = 'closed',
            quantity = 0,
            amount_in_currency = 0,
            closed_at = COALESCE(_operated_at, current_date),
            close_amount_in_currency = _consumed_cost_basis,
            close_currency_code = _base_currency_code,
            metadata = metadata || jsonb_build_object(
                'close_value_in_base', _consumed_cost_basis
            )
        WHERE id = _position_id;
    ELSE
        _remaining_quantity := _position_quantity - _amount;

        UPDATE portfolio_positions
        SET quantity = _remaining_quantity,
            amount_in_currency = 0
        WHERE id = _position_id;
    END IF;

    PERFORM budgeting.put__apply_current_crypto_delta(
        _bank_account_id,
        _crypto_asset_id,
        _amount,
        _consumed_cost_basis
    );

    IF _bank_account_kind = 'cash' THEN
        PERFORM budgeting.put__apply_current_budget_delta(
            _to_unallocated_id,
            _base_currency_code,
            _consumed_cost_basis
        );
    END IF;

    RETURN jsonb_build_object(
        'operation_id', _operation_id,
        'position_id', _position_id,
        'amount_in_base', _consumed_cost_basis,
        'base_currency_code', _base_currency_code
    );
END
$function$;
