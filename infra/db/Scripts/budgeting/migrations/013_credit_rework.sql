-- 1. Add credit_limit column
ALTER TABLE budgeting.bank_accounts
    ADD COLUMN IF NOT EXISTS credit_limit numeric(20, 2);

-- 2. Extend credit_fields constraint to cover credit_limit
ALTER TABLE budgeting.bank_accounts
    DROP CONSTRAINT IF EXISTS chk_bank_accounts_credit_fields;

ALTER TABLE budgeting.bank_accounts
    ADD CONSTRAINT chk_bank_accounts_credit_fields
    CHECK (
        account_kind = 'credit'
        OR (credit_kind IS NULL AND interest_rate IS NULL AND payment_day IS NULL
            AND credit_started_at IS NULL AND credit_ends_at IS NULL AND credit_limit IS NULL)
    );

-- 3. Migrate existing credit account balances to new model (positive debt → negative balance).
--    Old model: balance = debt (positive).
--    New model: balance = drawn amount (negative = debt).
UPDATE budgeting.current_bank_balances cbb
SET amount                  = -cbb.amount,
    historical_cost_in_base = -cbb.historical_cost_in_base
WHERE cbb.bank_account_id IN (
    SELECT id FROM budgeting.bank_accounts WHERE account_kind = 'credit'
)
  AND cbb.amount > 0;

-- 4. Update put__create_credit_account: remove credit_taken, add credit_limit + target_account_id
CREATE OR REPLACE FUNCTION budgeting.put__create_credit_account(
    _user_id              bigint,
    _name                 text,
    _credit_kind          text,
    _currency_code        char(3),
    _initial_debt         numeric DEFAULT 0,
    _owner_type           text DEFAULT 'user',
    _interest_rate        numeric DEFAULT NULL,
    _payment_day          smallint DEFAULT NULL,
    _credit_started_at    date DEFAULT NULL,
    _credit_ends_at       date DEFAULT NULL,
    _provider_name        text DEFAULT NULL,
    _provider_account_ref text DEFAULT NULL,
    _credit_limit         numeric DEFAULT NULL,
    _target_account_id    bigint DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
AS $function$
DECLARE
    _normalized_name  text := btrim(_name);
    _owner_user_id    bigint;
    _owner_family_id  bigint;
    _account_id       bigint;
BEGIN
    SET search_path TO budgeting;

    IF _normalized_name = '' THEN
        RAISE EXCEPTION 'Bank account name cannot be empty';
    END IF;

    IF _credit_kind NOT IN ('loan', 'credit_card', 'mortgage') THEN
        RAISE EXCEPTION 'Unsupported credit kind: %. Use loan, credit_card, or mortgage', _credit_kind;
    END IF;

    IF _initial_debt < 0 THEN
        RAISE EXCEPTION 'Initial debt cannot be negative';
    END IF;

    IF _payment_day IS NOT NULL AND (_payment_day < 1 OR _payment_day > 31) THEN
        RAISE EXCEPTION 'Payment day must be between 1 and 31';
    END IF;

    IF _credit_kind IN ('loan', 'mortgage') AND _credit_started_at IS NOT NULL AND _credit_ends_at IS NOT NULL
       AND _credit_ends_at <= _credit_started_at THEN
        RAISE EXCEPTION 'Credit end date must be after start date';
    END IF;

    IF _owner_type = 'user' THEN
        _owner_user_id := _user_id;
    ELSIF _owner_type = 'family' THEN
        _owner_family_id := budgeting.get__user_family_id(_user_id);
        IF _owner_family_id IS NULL THEN
            RAISE EXCEPTION 'User % does not belong to a family', _user_id;
        END IF;
    ELSE
        RAISE EXCEPTION 'Unsupported owner type: %', _owner_type;
    END IF;

    IF EXISTS (
        SELECT 1 FROM bank_accounts ba
        WHERE ba.owner_type = _owner_type
          AND ((_owner_type = 'user'   AND ba.owner_user_id   = _owner_user_id)
               OR (_owner_type = 'family' AND ba.owner_family_id = _owner_family_id))
          AND ba.name = _normalized_name
          AND ba.is_active
    ) THEN
        RAISE EXCEPTION 'Active bank account with name "%" already exists', _normalized_name;
    END IF;

    INSERT INTO bank_accounts (
        owner_type, owner_user_id, owner_family_id,
        name, account_kind, credit_kind, interest_rate, payment_day,
        credit_started_at, credit_ends_at, credit_limit,
        provider_name, provider_account_ref,
        is_primary, is_active
    )
    VALUES (
        _owner_type, _owner_user_id, _owner_family_id,
        _normalized_name, 'credit', _credit_kind, _interest_rate, _payment_day,
        _credit_started_at, _credit_ends_at, _credit_limit,
        NULLIF(btrim(_provider_name), ''),
        NULLIF(btrim(_provider_account_ref), ''),
        false, true
    )
    RETURNING id INTO _account_id;

    -- Disburse funds to a cash account (for loans/mortgages).
    -- The credit account goes negative (debt), the cash account gets the money.
    IF _target_account_id IS NOT NULL AND _initial_debt > 0 THEN
        PERFORM budgeting.put__transfer_between_accounts(
            _user_id,
            _account_id,
            _target_account_id,
            _currency_code,
            _initial_debt,
            'Выдача кредита · ' || _normalized_name
        );
    END IF;

    RETURN (
        SELECT jsonb_build_object(
            'id',                   ba.id,
            'name',                 ba.name,
            'owner_type',           ba.owner_type,
            'owner_user_id',        ba.owner_user_id,
            'owner_family_id',      ba.owner_family_id,
            'owner_name',           CASE
                                        WHEN ba.owner_type = 'user' THEN COALESCE(u.first_name, u.username, 'Personal')
                                        ELSE f.name
                                    END,
            'account_kind',         ba.account_kind,
            'credit_kind',          ba.credit_kind,
            'interest_rate',        ba.interest_rate,
            'payment_day',          ba.payment_day,
            'credit_started_at',    ba.credit_started_at,
            'credit_ends_at',       ba.credit_ends_at,
            'credit_limit',         ba.credit_limit,
            'provider_name',        ba.provider_name,
            'provider_account_ref', ba.provider_account_ref,
            'is_primary',           ba.is_primary,
            'is_active',            ba.is_active,
            'created_at',           ba.created_at
        )
        FROM bank_accounts ba
        LEFT JOIN users u ON u.id = ba.owner_user_id
        LEFT JOIN families f ON f.id = ba.owner_family_id
        WHERE ba.id = _account_id
    );
END
$function$;

-- 5. Update get__bank_accounts to expose credit_limit
CREATE OR REPLACE FUNCTION budgeting.get__bank_accounts(
    _user_id bigint,
    _is_active boolean DEFAULT true,
    _account_kind text DEFAULT 'cash'
)
RETURNS jsonb
LANGUAGE plpgsql
AS $function$
DECLARE
    _family_id bigint;
    _normalized_account_kind text := nullif(trim(_account_kind), '');
    _result jsonb;
BEGIN
    SET search_path TO budgeting;

    _family_id := budgeting.get__user_family_id(_user_id);

    IF _normalized_account_kind IS NOT NULL
       AND _normalized_account_kind NOT IN ('cash', 'investment', 'credit') THEN
        RAISE EXCEPTION 'Unsupported bank account kind filter: %', _normalized_account_kind;
    END IF;

    SELECT COALESCE(
        jsonb_agg(
            jsonb_build_object(
                'id', ba.id,
                'name', ba.name,
                'owner_type', ba.owner_type,
                'owner_user_id', ba.owner_user_id,
                'owner_family_id', ba.owner_family_id,
                'owner_name', CASE
                    WHEN ba.owner_type = 'user' THEN COALESCE(u.first_name, u.username, 'Personal')
                    ELSE f.name
                END,
                'account_kind', ba.account_kind,
                'credit_kind', ba.credit_kind,
                'interest_rate', ba.interest_rate,
                'payment_day', ba.payment_day,
                'credit_started_at', ba.credit_started_at,
                'credit_ends_at', ba.credit_ends_at,
                'credit_limit', ba.credit_limit,
                'provider_name', ba.provider_name,
                'provider_account_ref', ba.provider_account_ref,
                'is_primary', ba.is_primary,
                'is_active', ba.is_active,
                'created_at', ba.created_at
            )
            ORDER BY ba.owner_type, ba.account_kind, ba.is_primary DESC, ba.id
        ),
        '[]'::jsonb
    )
    INTO _result
    FROM bank_accounts ba
    LEFT JOIN users u ON u.id = ba.owner_user_id
    LEFT JOIN families f ON f.id = ba.owner_family_id
    WHERE (
            (ba.owner_type = 'user' AND ba.owner_user_id = _user_id)
            OR
            (ba.owner_type = 'family' AND ba.owner_family_id = _family_id)
          )
      AND (_is_active IS NULL OR ba.is_active = _is_active)
      AND (_normalized_account_kind IS NULL OR ba.account_kind = _normalized_account_kind);

    RETURN _result;
END
$function$;

-- 6. Update put__record_expense to allow credit accounts
CREATE OR REPLACE FUNCTION budgeting.put__record_expense(
    _user_id bigint,
    _bank_account_id bigint,
    _category_id bigint,
    _amount numeric,
    _currency_code char(3),
    _comment text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
AS $function$
DECLARE
    _base_currency_code char(3);
    _category_kind text;
    _bank_balance numeric(20, 8);
    _category_balance numeric(20, 2);
    _operation_id bigint;
    _remaining_to_consume numeric(20, 8);
    _expense_cost_base numeric(20, 2) := 0;
    _lot_ids bigint[] := '{}';
    _lot_amounts numeric[] := '{}';
    _lot_costs numeric[] := '{}';
    _lot_idx integer;
    _consume_amount numeric(20, 8);
    _consume_cost numeric(20, 2);
    _lot record;
    _category_owner_type text;
    _category_owner_user_id bigint;
    _category_owner_family_id bigint;
    _bank_owner_type text;
    _bank_owner_user_id bigint;
    _bank_owner_family_id bigint;
    _bank_account_kind text;
BEGIN
    SET search_path TO budgeting;

    IF _amount <= 0 THEN
        RAISE EXCEPTION 'Expense amount must be positive';
    END IF;

    SELECT kind, owner_type, owner_user_id, owner_family_id
    INTO _category_kind, _category_owner_type, _category_owner_user_id, _category_owner_family_id
    FROM categories
    WHERE id = _category_id AND is_active;

    IF _category_kind IS NULL THEN
        RAISE EXCEPTION 'Unknown active category %', _category_id;
    END IF;

    IF NOT budgeting.has__owner_access(
        _user_id, _category_owner_type, _category_owner_user_id, _category_owner_family_id
    ) THEN
        RAISE EXCEPTION 'Access denied to category %', _category_id;
    END IF;

    IF _category_kind <> 'regular' THEN
        RAISE EXCEPTION 'Expense category % must be of kind regular', _category_id;
    END IF;

    SELECT owner_type, owner_user_id, owner_family_id, account_kind
    INTO _bank_owner_type, _bank_owner_user_id, _bank_owner_family_id, _bank_account_kind
    FROM bank_accounts
    WHERE id = _bank_account_id AND is_active;

    IF _bank_owner_type IS NULL THEN
        RAISE EXCEPTION 'Unknown active bank account %', _bank_account_id;
    END IF;

    IF NOT budgeting.has__owner_access(
        _user_id, _bank_owner_type, _bank_owner_user_id, _bank_owner_family_id
    ) THEN
        RAISE EXCEPTION 'Access denied to bank account %', _bank_account_id;
    END IF;

    IF _bank_account_kind NOT IN ('cash', 'credit') THEN
        RAISE EXCEPTION 'Expenses can only be recorded from cash or credit accounts';
    END IF;

    IF _bank_account_kind = 'credit' AND _currency_code <> (
        SELECT budgeting.get__owner_base_currency(_category_owner_type, _category_owner_user_id, _category_owner_family_id)
    ) THEN
        RAISE EXCEPTION 'Credit account expenses must be in base currency';
    END IF;

    IF _category_owner_type <> _bank_owner_type
       OR COALESCE(_category_owner_user_id, 0) <> COALESCE(_bank_owner_user_id, 0)
       OR COALESCE(_category_owner_family_id, 0) <> COALESCE(_bank_owner_family_id, 0) THEN
        RAISE EXCEPTION 'Expense category and bank account must have the same owner';
    END IF;

    _base_currency_code := budgeting.get__owner_base_currency(
        _category_owner_type, _category_owner_user_id, _category_owner_family_id
    );

    PERFORM 1 FROM current_bank_balances
    WHERE bank_account_id = _bank_account_id AND currency_code = _currency_code
    FOR UPDATE;

    SELECT COALESCE(amount, 0) INTO _bank_balance
    FROM current_bank_balances
    WHERE bank_account_id = _bank_account_id AND currency_code = _currency_code;

    IF _bank_balance < _amount AND _bank_account_kind <> 'credit' THEN
        RAISE EXCEPTION 'Сумма превышает остаток';
    END IF;

    IF _bank_account_kind = 'credit' THEN
        _expense_cost_base := round(_amount, 2);
    ELSIF _currency_code = _base_currency_code THEN
        _expense_cost_base := round(_amount, 2);
    ELSE
        _remaining_to_consume := _amount;

        FOR _lot IN
            SELECT id, amount_remaining, cost_base_remaining
            FROM fx_lots
            WHERE bank_account_id = _bank_account_id
              AND currency_code = _currency_code
              AND amount_remaining > 0
            ORDER BY created_at, id
        LOOP
            EXIT WHEN _remaining_to_consume <= 0;

            _consume_amount := LEAST(_remaining_to_consume, _lot.amount_remaining);

            IF _consume_amount = _lot.amount_remaining THEN
                _consume_cost := _lot.cost_base_remaining;
            ELSE
                _consume_cost := round(_lot.cost_base_remaining * _consume_amount / _lot.amount_remaining, 2);
            END IF;

            _lot_ids     := array_append(_lot_ids, _lot.id);
            _lot_amounts := array_append(_lot_amounts, _consume_amount);
            _lot_costs   := array_append(_lot_costs, _consume_cost);
            _expense_cost_base := _expense_cost_base + _consume_cost;
            _remaining_to_consume := _remaining_to_consume - _consume_amount;
        END LOOP;

        IF _remaining_to_consume > 0 THEN
            RAISE EXCEPTION 'Сумма превышает остаток';
        END IF;
    END IF;

    PERFORM 1 FROM current_budget_balances
    WHERE category_id = _category_id AND currency_code = _base_currency_code
    FOR UPDATE;

    SELECT COALESCE(amount, 0) INTO _category_balance
    FROM current_budget_balances
    WHERE category_id = _category_id AND currency_code = _base_currency_code;

    IF _category_balance < _expense_cost_base THEN
        RAISE EXCEPTION 'Сумма превышает остаток';
    END IF;

    INSERT INTO operations (actor_user_id, owner_type, owner_user_id, owner_family_id, type, comment)
    VALUES (_user_id, _category_owner_type, _category_owner_user_id, _category_owner_family_id, 'expense', _comment)
    RETURNING id INTO _operation_id;

    INSERT INTO bank_entries (operation_id, bank_account_id, currency_code, amount)
    VALUES (_operation_id, _bank_account_id, _currency_code, -_amount);

    IF array_length(_lot_ids, 1) IS NOT NULL THEN
        FOR _lot_idx IN 1..array_length(_lot_ids, 1) LOOP
            UPDATE fx_lots
            SET amount_remaining    = amount_remaining    - _lot_amounts[_lot_idx],
                cost_base_remaining = cost_base_remaining - _lot_costs[_lot_idx]
            WHERE id = _lot_ids[_lot_idx];

            INSERT INTO lot_consumptions (operation_id, lot_id, amount, cost_base)
            VALUES (_operation_id, _lot_ids[_lot_idx], _lot_amounts[_lot_idx], _lot_costs[_lot_idx]);
        END LOOP;
    END IF;

    INSERT INTO budget_entries (operation_id, category_id, currency_code, amount)
    VALUES (_operation_id, _category_id, _base_currency_code, -_expense_cost_base);

    PERFORM budgeting.put__apply_current_bank_delta(
        _bank_account_id, _currency_code, -_amount, -_expense_cost_base
    );

    PERFORM budgeting.put__apply_current_budget_delta(
        _category_id, _base_currency_code, -_expense_cost_base
    );

    RETURN jsonb_build_object(
        'operation_id', _operation_id,
        'expense_cost_in_base', _expense_cost_base,
        'base_currency_code', _base_currency_code
    );
END
$function$;
