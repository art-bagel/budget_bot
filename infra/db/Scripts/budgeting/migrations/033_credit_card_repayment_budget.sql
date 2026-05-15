-- Cash -> credit_card repayments must debit Unallocated when they repay
-- credit-card transfers that previously credited Unallocated.
--
-- Credit-card purchases already debit their spending category, so those
-- repayments still skip budget changes and avoid double-counting.

CREATE OR REPLACE FUNCTION budgeting.put__transfer_between_accounts(
    _user_id          bigint,
    _from_account_id bigint,
    _to_account_id   bigint,
    _currency_code   char(3),
    _amount          numeric,
    _comment         text DEFAULT NULL,
    _operation_at    timestamptz DEFAULT CURRENT_TIMESTAMP
)
RETURNS jsonb
LANGUAGE plpgsql
AS $function$
DECLARE
    _from_owner_type      text;
    _from_owner_user_id   bigint;
    _from_owner_family_id bigint;
    _from_account_kind    text;
    _from_credit_limit    numeric(20, 2);
    _to_owner_type        text;
    _to_owner_user_id     bigint;
    _to_owner_family_id   bigint;
    _to_account_kind      text;
    _to_credit_kind       text;
    _base_currency_code   char(3);
    _from_unallocated_id  bigint;
    _to_unallocated_id    bigint;
    _operation_id         bigint;
    _bank_balance         numeric(20, 8);
    _cost_base            numeric(20, 2) := 0;
    _remaining            numeric(20, 8);
    _lot_ids              bigint[]  := '{}';
    _lot_amounts          numeric[] := '{}';
    _lot_costs            numeric[] := '{}';
    _lot_idx              integer;
    _consume_amount       numeric(20, 8);
    _consume_cost         numeric(20, 2);
    _lot                  record;
    _credit_card_budget_debt_base numeric(20, 2) := 0;
    _budget_debit_base    numeric(20, 2) := 0;
BEGIN
    SET search_path TO budgeting;

    IF _amount <= 0 THEN
        RAISE EXCEPTION 'Transfer amount must be positive';
    END IF;

    IF _from_account_id = _to_account_id THEN
        RAISE EXCEPTION 'Source and target accounts must be different';
    END IF;

    SELECT owner_type, owner_user_id, owner_family_id, account_kind, credit_limit
    INTO _from_owner_type, _from_owner_user_id, _from_owner_family_id, _from_account_kind, _from_credit_limit
    FROM bank_accounts
    WHERE id = _from_account_id AND is_active;

    IF _from_owner_type IS NULL THEN
        RAISE EXCEPTION 'Unknown active bank account %', _from_account_id;
    END IF;

    IF NOT budgeting.has__owner_access(_user_id, _from_owner_type, _from_owner_user_id, _from_owner_family_id) THEN
        RAISE EXCEPTION 'Access denied to source bank account %', _from_account_id;
    END IF;

    SELECT owner_type, owner_user_id, owner_family_id, account_kind, credit_kind
    INTO _to_owner_type, _to_owner_user_id, _to_owner_family_id, _to_account_kind, _to_credit_kind
    FROM bank_accounts
    WHERE id = _to_account_id AND is_active;

    IF _to_owner_type IS NULL THEN
        RAISE EXCEPTION 'Unknown active bank account %', _to_account_id;
    END IF;

    IF NOT budgeting.has__owner_access(_user_id, _to_owner_type, _to_owner_user_id, _to_owner_family_id) THEN
        RAISE EXCEPTION 'Access denied to target bank account %', _to_account_id;
    END IF;

    _base_currency_code := budgeting.get__owner_base_currency(
        _from_owner_type, _from_owner_user_id, _from_owner_family_id
    );

    IF _from_account_kind = 'cash' THEN
        _from_unallocated_id := budgeting.get__owner_system_category_id(
            _from_owner_type, _from_owner_user_id, _from_owner_family_id, 'Unallocated'
        );
        IF _from_unallocated_id IS NULL THEN
            RAISE EXCEPTION 'Unallocated category missing for source account %', _from_account_id;
        END IF;
    END IF;

    IF _to_account_kind = 'cash' THEN
        _to_unallocated_id := budgeting.get__owner_system_category_id(
            _to_owner_type, _to_owner_user_id, _to_owner_family_id, 'Unallocated'
        );
        IF _to_unallocated_id IS NULL THEN
            RAISE EXCEPTION 'Unallocated category missing for target account %', _to_account_id;
        END IF;
    END IF;

    PERFORM 1
    FROM current_bank_balances
    WHERE bank_account_id = _from_account_id
      AND currency_code = _currency_code
    FOR UPDATE;

    SELECT COALESCE((
        SELECT amount
        FROM current_bank_balances
        WHERE bank_account_id = _from_account_id
          AND currency_code = _currency_code
    ), 0)
    INTO _bank_balance;

    IF _from_account_kind = 'credit' THEN
        IF _from_credit_limit IS NULL THEN
            RAISE EXCEPTION 'Credit limit is not configured for this account';
        END IF;
        IF (_bank_balance - _amount) < -_from_credit_limit THEN
            RAISE EXCEPTION 'Credit limit exceeded';
        END IF;
    ELSE
        IF _bank_balance < _amount THEN
            RAISE EXCEPTION 'Сумма превышает остаток';
        END IF;
    END IF;

    IF _currency_code = _base_currency_code THEN
        _cost_base := round(_amount, 2);
    ELSE
        _remaining := _amount;

        FOR _lot IN
            SELECT id, amount_remaining, cost_base_remaining
            FROM fx_lots
            WHERE bank_account_id = _from_account_id
              AND currency_code = _currency_code
              AND amount_remaining > 0
            ORDER BY created_at, id
        LOOP
            EXIT WHEN _remaining <= 0;

            _consume_amount := LEAST(_remaining, _lot.amount_remaining);
            IF _consume_amount = _lot.amount_remaining THEN
                _consume_cost := _lot.cost_base_remaining;
            ELSE
                _consume_cost := round(_lot.cost_base_remaining * _consume_amount / _lot.amount_remaining, 2);
            END IF;

            _lot_ids     := array_append(_lot_ids,     _lot.id);
            _lot_amounts := array_append(_lot_amounts, _consume_amount);
            _lot_costs   := array_append(_lot_costs,   _consume_cost);
            _cost_base   := _cost_base + _consume_cost;
            _remaining   := _remaining - _consume_amount;
        END LOOP;

        IF _remaining > 0 AND _from_account_kind <> 'credit' THEN
            RAISE EXCEPTION 'Сумма превышает остаток';
        END IF;

        IF _from_account_kind = 'credit' AND _cost_base = 0 THEN
            _cost_base := round(_amount, 2);
        END IF;
    END IF;

    IF _from_account_kind = 'cash'
       AND _to_account_kind = 'credit'
       AND _to_credit_kind = 'credit_card' THEN
        SELECT GREATEST(0, round(COALESCE(sum(bue.amount), 0), 2))
        INTO _credit_card_budget_debt_base
        FROM operations o
        JOIN bank_entries credit_be
          ON credit_be.operation_id = o.id
         AND credit_be.bank_account_id = _to_account_id
        JOIN budget_entries bue
          ON bue.operation_id = o.id
        WHERE o.type = 'account_transfer';

        _budget_debit_base := LEAST(_cost_base, _credit_card_budget_debt_base);
    ELSIF _from_account_kind = 'cash' THEN
        _budget_debit_base := _cost_base;
    END IF;

    INSERT INTO operations (actor_user_id, owner_type, owner_user_id, owner_family_id, type, comment, operated_on)
    VALUES (
        _user_id, _from_owner_type, _from_owner_user_id, _from_owner_family_id,
        'account_transfer', _comment, COALESCE(_operation_at::date, CURRENT_DATE)
    )
    RETURNING id INTO _operation_id;

    INSERT INTO bank_entries (operation_id, bank_account_id, currency_code, amount)
    VALUES
        (_operation_id, _from_account_id, _currency_code, -_amount),
        (_operation_id, _to_account_id,   _currency_code,  _amount);

    IF _budget_debit_base > 0 THEN
        INSERT INTO budget_entries (operation_id, category_id, currency_code, amount)
        VALUES (_operation_id, _from_unallocated_id, _base_currency_code, -_budget_debit_base);
    END IF;

    IF _to_account_kind = 'cash' THEN
        INSERT INTO budget_entries (operation_id, category_id, currency_code, amount)
        VALUES (_operation_id, _to_unallocated_id, _base_currency_code, _cost_base);
    END IF;

    PERFORM budgeting.put__apply_current_bank_delta(_from_account_id, _currency_code, -_amount, -_cost_base);
    PERFORM budgeting.put__apply_current_bank_delta(_to_account_id,   _currency_code,  _amount,  _cost_base);

    IF _budget_debit_base > 0 THEN
        PERFORM budgeting.put__apply_current_budget_delta(_from_unallocated_id, _base_currency_code, -_budget_debit_base);
    END IF;

    IF _to_account_kind = 'cash' THEN
        PERFORM budgeting.put__apply_current_budget_delta(_to_unallocated_id, _base_currency_code, _cost_base);
    END IF;

    IF _currency_code <> _base_currency_code THEN
        IF array_length(_lot_ids, 1) IS NOT NULL THEN
            FOR _lot_idx IN 1..array_length(_lot_ids, 1) LOOP
                UPDATE fx_lots
                SET amount_remaining     = amount_remaining     - _lot_amounts[_lot_idx],
                    cost_base_remaining  = cost_base_remaining  - _lot_costs[_lot_idx]
                WHERE id = _lot_ids[_lot_idx];

                INSERT INTO lot_consumptions (operation_id, lot_id, amount, cost_base)
                VALUES (_operation_id, _lot_ids[_lot_idx], _lot_amounts[_lot_idx], _lot_costs[_lot_idx]);
            END LOOP;
        END IF;

        INSERT INTO fx_lots (
            bank_account_id, currency_code,
            amount_initial, amount_remaining,
            buy_rate_in_base,
            cost_base_initial, cost_base_remaining,
            opened_by_operation_id
        )
        VALUES (
            _to_account_id, _currency_code,
            _amount, _amount,
            _cost_base / _amount,
            _cost_base, _cost_base,
            _operation_id
        );
    END IF;

    RETURN jsonb_build_object(
        'operation_id',      _operation_id,
        'amount_in_base',    _cost_base,
        'base_currency_code', _base_currency_code
    );
END
$function$;

DO $$
DECLARE
    _repayment record;
    _budget_debt_base numeric(20, 2);
    _budget_debit_base numeric(20, 2);
BEGIN
    FOR _repayment IN
        SELECT
            o.id AS operation_id,
            o.created_at,
            to_ba.id AS credit_account_id,
            budgeting.get__owner_system_category_id(
                from_ba.owner_type,
                from_ba.owner_user_id,
                from_ba.owner_family_id,
                'Unallocated'
            ) AS unallocated_id,
            budgeting.get__owner_base_currency(
                from_ba.owner_type,
                from_ba.owner_user_id,
                from_ba.owner_family_id
            ) AS base_currency_code,
            CASE
                WHEN from_be.currency_code = budgeting.get__owner_base_currency(
                    from_ba.owner_type,
                    from_ba.owner_user_id,
                    from_ba.owner_family_id
                )
                THEN round(abs(from_be.amount), 2)
                ELSE COALESCE((
                    SELECT round(sum(abs(lc.cost_base)), 2)
                    FROM budgeting.lot_consumptions lc
                    WHERE lc.operation_id = o.id
                ), round(abs(from_be.amount), 2))
            END AS amount_in_base
        FROM budgeting.operations o
        JOIN budgeting.bank_entries from_be
          ON from_be.operation_id = o.id
         AND from_be.amount < 0
        JOIN budgeting.bank_accounts from_ba
          ON from_ba.id = from_be.bank_account_id
         AND from_ba.account_kind = 'cash'
        JOIN budgeting.bank_entries to_be
          ON to_be.operation_id = o.id
         AND to_be.amount > 0
         AND to_be.currency_code = from_be.currency_code
         AND round(to_be.amount, 8) = round(abs(from_be.amount), 8)
        JOIN budgeting.bank_accounts to_ba
          ON to_ba.id = to_be.bank_account_id
         AND to_ba.account_kind = 'credit'
         AND to_ba.credit_kind = 'credit_card'
        WHERE o.type = 'account_transfer'
          AND NOT EXISTS (
              SELECT 1
              FROM budgeting.budget_entries existing_be
              WHERE existing_be.operation_id = o.id
          )
    LOOP
        IF _repayment.unallocated_id IS NULL THEN
            RAISE EXCEPTION 'Unallocated category missing while backfilling operation %', _repayment.operation_id;
        END IF;

        SELECT GREATEST(0, round(COALESCE(sum(bue.amount), 0), 2))
        INTO _budget_debt_base
        FROM budgeting.operations o
        JOIN budgeting.bank_entries credit_be
          ON credit_be.operation_id = o.id
         AND credit_be.bank_account_id = _repayment.credit_account_id
        JOIN budgeting.budget_entries bue
          ON bue.operation_id = o.id
        WHERE o.type = 'account_transfer'
          AND (
              o.created_at < _repayment.created_at
              OR (o.created_at = _repayment.created_at AND o.id < _repayment.operation_id)
          );

        _budget_debit_base := LEAST(_repayment.amount_in_base, _budget_debt_base);

        IF _budget_debit_base <= 0 THEN
            CONTINUE;
        END IF;

        INSERT INTO budgeting.budget_entries (operation_id, category_id, currency_code, amount)
        VALUES (
            _repayment.operation_id,
            _repayment.unallocated_id,
            _repayment.base_currency_code,
            -_budget_debit_base
        );

        PERFORM budgeting.put__apply_current_budget_delta(
            _repayment.unallocated_id,
            _repayment.base_currency_code,
            -_budget_debit_base
        );
    END LOOP;
END $$;
