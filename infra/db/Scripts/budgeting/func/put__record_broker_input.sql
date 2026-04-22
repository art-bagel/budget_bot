DROP FUNCTION IF EXISTS budgeting.put__record_broker_input;
CREATE FUNCTION budgeting.put__record_broker_input(
    _user_id               bigint,
    _owner_type            text,
    _owner_user_id         bigint,
    _owner_family_id       bigint,
    _investment_account_id bigint,
    _currency_code         char(3),
    _amount                numeric,          -- 0 means "already recorded" marker
    _external_id           text             DEFAULT NULL,
    _import_source         varchar(30)      DEFAULT NULL,
    _comment               text             DEFAULT NULL,
    _operation_at          timestamptz      DEFAULT CURRENT_TIMESTAMP
)
RETURNS jsonb
LANGUAGE plpgsql
AS $function$
DECLARE
    _operation_id       bigint;
    _base_currency_code char(3);
    _cost_in_base       numeric(20, 2);
    _rows_inserted      int;
BEGIN
    SET search_path TO budgeting;

    IF _amount < 0 THEN
        RAISE EXCEPTION 'Broker input amount must be non-negative';
    END IF;

    PERFORM 1
    FROM bank_accounts
    WHERE id = _investment_account_id
      AND is_active
      AND account_kind = 'investment';

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Unknown active investment account %', _investment_account_id;
    END IF;

    IF NOT budgeting.has__owner_access(_user_id, _owner_type, _owner_user_id, _owner_family_id) THEN
        RAISE EXCEPTION 'Access denied to investment account %', _investment_account_id;
    END IF;

    INSERT INTO operations (
        actor_user_id, owner_type, owner_user_id, owner_family_id, type, comment, operated_on
    )
    VALUES (
        _user_id, _owner_type, _owner_user_id, _owner_family_id,
        'broker_input', _comment, COALESCE(_operation_at::date, CURRENT_DATE)
    )
    RETURNING id INTO _operation_id;

    INSERT INTO bank_entries (
        operation_id, bank_account_id, currency_code, amount, external_id, import_source
    )
    VALUES (
        _operation_id, _investment_account_id, _currency_code, _amount, _external_id, _import_source
    )
    ON CONFLICT DO NOTHING;

    GET DIAGNOSTICS _rows_inserted = ROW_COUNT;

    -- Skip balance update for 0-amount markers or idempotent duplicates
    IF _rows_inserted > 0 AND _amount > 0 THEN
        _base_currency_code := budgeting.get__owner_base_currency(_owner_type, _owner_user_id, _owner_family_id);

        -- No historical exchange rate available from import — use 1:1 as cost basis
        _cost_in_base := round(_amount, 2);

        PERFORM budgeting.put__apply_current_bank_delta(
            _investment_account_id, _currency_code, _amount, _cost_in_base
        );

        IF _currency_code <> _base_currency_code THEN
            INSERT INTO fx_lots (
                bank_account_id, currency_code,
                amount_initial, amount_remaining,
                buy_rate_in_base,
                cost_base_initial, cost_base_remaining,
                opened_by_operation_id
            )
            VALUES (
                _investment_account_id, _currency_code,
                _amount, _amount,
                _cost_in_base / _amount,
                _cost_in_base, _cost_in_base,
                _operation_id
            );
        END IF;
    END IF;

    RETURN jsonb_build_object(
        'operation_id', _operation_id,
        'skipped',      _rows_inserted = 0
    );
END
$function$;
