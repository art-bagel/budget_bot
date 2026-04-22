DROP FUNCTION IF EXISTS budgeting.put__record_portfolio_income;
CREATE FUNCTION budgeting.put__record_portfolio_income(
    _user_id bigint,
    _position_id bigint,
    _amount numeric,
    _currency_code char(3),
    _amount_in_base numeric DEFAULT NULL,
    _income_kind text DEFAULT NULL,
    _received_at date DEFAULT CURRENT_DATE,
    _comment text DEFAULT NULL,
    _operation_at timestamptz DEFAULT CURRENT_TIMESTAMP
)
RETURNS jsonb
LANGUAGE plpgsql
AS $function$
DECLARE
    _owner_type text;
    _owner_user_id bigint;
    _owner_family_id bigint;
    _investment_account_id bigint;
    _asset_type_code text;
    _status text;
    _base_currency_code char(3);
    _effective_amount_in_base numeric(20, 2);
    _current_income_in_base numeric(20, 2);
    _operation_id bigint;
    _normalized_income_kind text := lower(coalesce(nullif(btrim(_income_kind), ''), 'income'));
BEGIN
    SET search_path TO budgeting;

    IF _amount IS NULL OR _amount <= 0 THEN
        RAISE EXCEPTION 'Portfolio income amount must be positive';
    END IF;

    IF _normalized_income_kind !~ '^[a-z][a-z0-9_]{1,29}$' THEN
        RAISE EXCEPTION 'Unsupported portfolio income kind: %', _income_kind;
    END IF;

    SELECT
        pp.owner_type,
        pp.owner_user_id,
        pp.owner_family_id,
        pp.investment_account_id,
        pp.asset_type_code,
        pp.status
    INTO
        _owner_type,
        _owner_user_id,
        _owner_family_id,
        _investment_account_id,
        _asset_type_code,
        _status
    FROM portfolio_positions pp
    WHERE pp.id = _position_id;

    IF _owner_type IS NULL THEN
        RAISE EXCEPTION 'Unknown portfolio position %', _position_id;
    END IF;

    IF NOT budgeting.has__owner_access(_user_id, _owner_type, _owner_user_id, _owner_family_id) THEN
        RAISE EXCEPTION 'Access denied to portfolio position %', _position_id;
    END IF;

    IF _status <> 'open' THEN
        RAISE EXCEPTION 'Portfolio income can only be recorded for open positions';
    END IF;

    PERFORM 1
    FROM bank_accounts ba
    WHERE ba.id = _investment_account_id
      AND ba.is_active
      AND ba.account_kind = 'investment';

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Active investment account is missing for portfolio position %', _position_id;
    END IF;

    PERFORM 1
    FROM currencies
    WHERE code = _currency_code;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Unknown currency code: %', _currency_code;
    END IF;

    _base_currency_code := budgeting.get__owner_base_currency(_owner_type, _owner_user_id, _owner_family_id);

    IF _base_currency_code IS NULL THEN
        RAISE EXCEPTION 'Base currency is missing for portfolio position %', _position_id;
    END IF;

    SELECT COALESCE((metadata ->> 'income_in_base')::numeric, 0)
    INTO _current_income_in_base
    FROM portfolio_positions
    WHERE id = _position_id;

    IF _currency_code = _base_currency_code THEN
        _effective_amount_in_base := round(_amount, 2);
    ELSE
        IF _amount_in_base IS NULL OR _amount_in_base <= 0 THEN
            RAISE EXCEPTION 'Historical base amount is required for non-base currency portfolio income';
        END IF;

        _effective_amount_in_base := round(_amount_in_base, 2);
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
        _owner_type,
        _owner_user_id,
        _owner_family_id,
        'investment_income',
        _comment,
        COALESCE(_operation_at::date, CURRENT_DATE)
    )
    RETURNING id
    INTO _operation_id;

    INSERT INTO bank_entries (operation_id, bank_account_id, currency_code, amount)
    VALUES (_operation_id, _investment_account_id, _currency_code, _amount);

    PERFORM budgeting.put__apply_current_bank_delta(
        _investment_account_id,
        _currency_code,
        _amount,
        _effective_amount_in_base
    );

    IF _currency_code <> _base_currency_code THEN
        INSERT INTO fx_lots (
            bank_account_id,
            currency_code,
            amount_initial,
            amount_remaining,
            buy_rate_in_base,
            cost_base_initial,
            cost_base_remaining,
            opened_by_operation_id
        )
        VALUES (
            _investment_account_id,
            _currency_code,
            _amount,
            _amount,
            _effective_amount_in_base / _amount,
            _effective_amount_in_base,
            _effective_amount_in_base,
            _operation_id
        );
    END IF;

    UPDATE portfolio_positions
    SET metadata = jsonb_set(
        COALESCE(metadata, '{}'::jsonb),
        '{income_in_base}',
        to_jsonb(_current_income_in_base + _effective_amount_in_base),
        true
    )
    WHERE id = _position_id;

    INSERT INTO portfolio_events (
        position_id,
        event_type,
        event_at,
        amount,
        currency_code,
        linked_operation_id,
        comment,
        metadata,
        created_by_user_id
    )
    VALUES (
        _position_id,
        'income',
        COALESCE(_received_at, CURRENT_DATE),
        _amount,
        _currency_code,
        _operation_id,
        NULLIF(btrim(_comment), ''),
        jsonb_build_object(
            'income_kind', _normalized_income_kind,
            'asset_type_code', _asset_type_code,
            'amount_in_base', _effective_amount_in_base
        ),
        _user_id
    );

    RETURN jsonb_build_object(
        'operation_id', _operation_id,
        'amount_in_base', _effective_amount_in_base,
        'base_currency_code', _base_currency_code
    );
END
$function$;
