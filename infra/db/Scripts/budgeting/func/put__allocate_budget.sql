DROP FUNCTION IF EXISTS budgeting.put__allocate_budget;
CREATE FUNCTION budgeting.put__allocate_budget(
    _user_id bigint,
    _from_category_id bigint,
    _to_category_id bigint,
    _amount_in_base numeric,
    _comment text DEFAULT NULL
)
RETURNS bigint
LANGUAGE plpgsql
AS $function$
DECLARE
    _journal_anchor bigint;
    _base_currency_code char(3);
    _from_kind text;
    _from_name text;
    _to_kind text;
    _to_name text;
    _from_balance numeric(20, 2);
    _fx_category_id bigint;
    _operation_id bigint;
    _owner_type text;
    _owner_user_id bigint;
    _owner_family_id bigint;
    _to_owner_type text;
    _to_owner_user_id bigint;
    _to_owner_family_id bigint;
BEGIN
    SET search_path TO budgeting;
    IF NULLIF(current_setting('budgeting.crypto_source_event_id',true),'') IS NULL THEN
        SELECT s.anchor_account_id INTO _journal_anchor FROM crypto_source_events s JOIN categories c ON c.id=_from_category_id
        WHERE s.owner_key=c.owner_type||':'||CASE WHEN c.owner_type='user' THEN c.owner_user_id ELSE c.owner_family_id END
        ORDER BY s.id LIMIT 1;
        IF _journal_anchor IS NOT NULL THEN
            RETURN (budgeting.put__journal_bank_operation(_user_id,_journal_anchor,'budget_allocate',jsonb_build_object(
                'from_category_id',_from_category_id,'to_category_id',_to_category_id,'amount',_amount_in_base::text,
                'comment',_comment,'operated_at',current_date))->>'operation_id')::bigint;
        END IF;
    END IF;

    IF _from_category_id = _to_category_id THEN
        RAISE EXCEPTION 'Budget source and destination categories must be different';
    END IF;

    IF _amount_in_base IS NULL OR _amount_in_base::text IN ('NaN', 'Infinity', '-Infinity')
       OR round(_amount_in_base, 2) <= 0 THEN
        RAISE EXCEPTION 'Allocated amount must be positive';
    END IF;

    SELECT kind, name, owner_type, owner_user_id, owner_family_id
    INTO _from_kind, _from_name, _owner_type, _owner_user_id, _owner_family_id
    FROM categories
    WHERE id = _from_category_id
      AND (is_active OR current_setting('budgeting.crypto_replaying',true)='on');

    IF _from_kind IS NULL THEN
        RAISE EXCEPTION 'Unknown active source category %', _from_category_id;
    END IF;

    IF NOT budgeting.has__owner_access(_user_id, _owner_type, _owner_user_id, _owner_family_id) THEN
        RAISE EXCEPTION 'Access denied to source category %', _from_category_id;
    END IF;

    IF _from_kind = 'group' THEN
        RAISE EXCEPTION 'Source category % cannot be of kind %', _from_category_id, _from_kind;
    END IF;

    IF _from_kind = 'system' AND _from_name <> 'Unallocated' THEN
        RAISE EXCEPTION 'Source system category % is not supported', _from_category_id;
    END IF;

    SELECT kind, name, owner_type, owner_user_id, owner_family_id
    INTO _to_kind, _to_name, _to_owner_type, _to_owner_user_id, _to_owner_family_id
    FROM categories
    WHERE id = _to_category_id
      AND (is_active OR current_setting('budgeting.crypto_replaying',true)='on');

    IF _to_kind IS NULL THEN
        RAISE EXCEPTION 'Unknown active destination category %', _to_category_id;
    END IF;

    IF _to_kind = 'group' THEN
        RAISE EXCEPTION 'Destination category % cannot be of kind %', _to_category_id, _to_kind;
    END IF;

    IF _to_kind = 'system' AND _to_name <> 'Unallocated' THEN
        RAISE EXCEPTION 'Destination system category % is not supported', _to_category_id;
    END IF;

    IF _owner_type <> _to_owner_type
       OR COALESCE(_owner_user_id, 0) <> COALESCE(_to_owner_user_id, 0)
       OR COALESCE(_owner_family_id, 0) <> COALESCE(_to_owner_family_id, 0) THEN
        RAISE EXCEPTION 'Budget allocation across different owners is not supported';
    END IF;

    _base_currency_code := budgeting.get__owner_base_currency(_owner_type, _owner_user_id, _owner_family_id);

    -- The UI presents Unallocated + FX Result as one spendable envelope.
    -- Keep FX Result intact as an analytical total; allocations debit only
    -- Unallocated, so the combined available amount falls exactly once.
    IF _from_kind = 'system' AND _from_name = 'Unallocated' THEN
        _fx_category_id := budgeting.get__owner_system_category_id(
            _owner_type, _owner_user_id, _owner_family_id, 'FX Result');
    END IF;

    PERFORM 1 FROM current_budget_balances
    WHERE category_id IN (_from_category_id, _to_category_id, _fx_category_id)
      AND currency_code = _base_currency_code
    ORDER BY category_id
    FOR UPDATE;

    SELECT COALESCE(sum(amount), 0) INTO _from_balance
    FROM current_budget_balances
    WHERE category_id IN (_from_category_id, _fx_category_id)
      AND currency_code = _base_currency_code;

    -- A regular category may go negative, as after an expense; the free
    -- budget (Unallocated + FX Result) may not.
    IF _from_kind = 'system' AND _from_balance < round(_amount_in_base, 2) THEN
        RAISE EXCEPTION 'Insufficient budget in category %', _from_category_id;
    END IF;

    INSERT INTO operations (
        actor_user_id,
        owner_type,
        owner_user_id,
        owner_family_id,
        type,
        comment
    )
    VALUES (
        _user_id,
        _owner_type,
        _owner_user_id,
        _owner_family_id,
        'allocate',
        _comment
    )
    RETURNING id
    INTO _operation_id;

    INSERT INTO budget_entries (operation_id, category_id, currency_code, amount)
    VALUES
        (_operation_id, _from_category_id, _base_currency_code, -round(_amount_in_base, 2)),
        (_operation_id, _to_category_id, _base_currency_code, round(_amount_in_base, 2));

    PERFORM budgeting.put__apply_current_budget_delta(
        _from_category_id,
        _base_currency_code,
        -round(_amount_in_base, 2)
    );

    PERFORM budgeting.put__apply_current_budget_delta(
        _to_category_id,
        _base_currency_code,
        round(_amount_in_base, 2)
    );

    RETURN _operation_id;
END
$function$;
