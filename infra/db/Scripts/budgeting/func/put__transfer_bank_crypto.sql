-- Move banking crypto between cash accounts, including personal <-> family.
-- Each consumed FIFO lot reappears on the target with its cost, FIFO date and
-- metadata, including «spent, awaiting an expense category»: an expense moved
-- to the family then consumes exactly those units. Like a currency transfer,
-- the cost moves between the owners' Unallocated. Not a sale, expense or income.
-- Ordinary operation outside the crypto journal, as account transfers are:
-- the journal is per owner and this movement spans two owners.
DROP FUNCTION IF EXISTS budgeting.put__transfer_bank_crypto;
CREATE FUNCTION budgeting.put__transfer_bank_crypto(
    _user_id bigint,
    _from_account_id bigint,
    _to_account_id bigint,
    _crypto_asset_id bigint,
    _amount numeric,
    _comment text DEFAULT NULL,
    _operated_at date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
AS $function$
DECLARE
    _from record;
    _to record;
    _base char(3);
    _from_unallocated bigint;
    _to_unallocated bigint;
    _need numeric(50, 18);
    _take numeric(50, 18);
    _take_cost numeric(20, 2);
    _cost numeric(20, 2) := 0;
    _lot record;
    _operation_id bigint;
BEGIN
    SET search_path TO budgeting;

    IF _amount IS NULL OR _amount::text IN ('NaN', 'Infinity', '-Infinity')
       OR _amount <= 0 OR _amount <> round(_amount, 18) THEN
        RAISE EXCEPTION 'Сумма перевода должна быть положительной';
    END IF;
    IF _from_account_id = _to_account_id THEN
        RAISE EXCEPTION 'Выберите разные счета';
    END IF;

    PERFORM 1 FROM bank_accounts WHERE id IN (_from_account_id, _to_account_id) ORDER BY id FOR UPDATE;
    SELECT * INTO _from FROM bank_accounts WHERE id = _from_account_id AND is_active;
    SELECT * INTO _to FROM bank_accounts WHERE id = _to_account_id AND is_active;
    IF _from.id IS NULL OR _to.id IS NULL OR _from.account_kind <> 'cash' OR _to.account_kind <> 'cash' THEN
        RAISE EXCEPTION 'Криптовалюту можно перевести только между активными банковскими счетами';
    END IF;
    IF NOT has__owner_access(_user_id, _from.owner_type, _from.owner_user_id, _from.owner_family_id)
       OR NOT has__owner_access(_user_id, _to.owner_type, _to.owner_user_id, _to.owner_family_id) THEN
        RAISE EXCEPTION 'Нет доступа к счёту';
    END IF;

    _base := get__owner_base_currency(_from.owner_type, _from.owner_user_id, _from.owner_family_id);
    IF _base IS DISTINCT FROM get__owner_base_currency(_to.owner_type, _to.owner_user_id, _to.owner_family_id) THEN
        RAISE EXCEPTION 'У счетов разная базовая валюта';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM crypto_assets WHERE id = _crypto_asset_id) THEN
        RAISE EXCEPTION 'Неизвестная криптовалюта';
    END IF;
    _from_unallocated := get__owner_system_category_id(_from.owner_type, _from.owner_user_id, _from.owner_family_id, 'Unallocated');
    _to_unallocated := get__owner_system_category_id(_to.owner_type, _to.owner_user_id, _to.owner_family_id, 'Unallocated');
    IF _from_unallocated IS NULL OR _to_unallocated IS NULL THEN
        RAISE EXCEPTION 'Unallocated category missing';
    END IF;

    PERFORM 1 FROM current_crypto_balances
    WHERE bank_account_id IN (_from_account_id, _to_account_id) AND crypto_asset_id = _crypto_asset_id
    ORDER BY bank_account_id FOR UPDATE;
    IF COALESCE((SELECT amount FROM current_crypto_balances
                 WHERE bank_account_id = _from_account_id AND crypto_asset_id = _crypto_asset_id), 0) < _amount THEN
        RAISE EXCEPTION 'Сумма превышает остаток';
    END IF;

    INSERT INTO operations (actor_user_id, owner_type, owner_user_id, owner_family_id, type, comment, operated_on)
    VALUES (_user_id, _from.owner_type, _from.owner_user_id, _from.owner_family_id, 'account_transfer',
            NULLIF(btrim(_comment), ''), COALESCE(_operated_at, current_date))
    RETURNING id INTO _operation_id;

    _need := _amount;
    FOR _lot IN
        SELECT id, amount_remaining, cost_base_remaining, metadata, created_at
        FROM crypto_lots
        WHERE bank_account_id = _from_account_id
          AND crypto_asset_id = _crypto_asset_id
          AND amount_remaining > 0
        ORDER BY created_at, id
        FOR UPDATE
    LOOP
        EXIT WHEN _need <= 0;
        _take := LEAST(_need, _lot.amount_remaining);
        _take_cost := CASE WHEN _take = _lot.amount_remaining THEN _lot.cost_base_remaining
                           ELSE round(_lot.cost_base_remaining * _take / _lot.amount_remaining, 2) END;
        UPDATE crypto_lots
        SET amount_remaining = amount_remaining - _take,
            cost_base_remaining = cost_base_remaining - _take_cost
        WHERE id = _lot.id;
        INSERT INTO crypto_lot_consumptions (operation_id, lot_id, amount, cost_base)
        VALUES (_operation_id, _lot.id, _take, _take_cost);
        INSERT INTO crypto_lots (bank_account_id, crypto_asset_id, amount_initial, amount_remaining,
                                 cost_base_initial, cost_base_remaining, opened_by_operation_id, metadata, created_at)
        VALUES (_to_account_id, _crypto_asset_id, _take, _take, _take_cost, _take_cost, _operation_id,
                _lot.metadata, _lot.created_at);
        _cost := _cost + _take_cost;
        _need := _need - _take;
    END LOOP;
    IF _need > 0 THEN
        RAISE EXCEPTION 'Сумма превышает остаток';
    END IF;

    INSERT INTO crypto_bank_entries (operation_id, bank_account_id, crypto_asset_id, amount)
    VALUES (_operation_id, _from_account_id, _crypto_asset_id, -_amount),
           (_operation_id, _to_account_id, _crypto_asset_id, _amount);
    PERFORM put__apply_current_crypto_delta(_from_account_id, _crypto_asset_id, -_amount, -_cost);
    PERFORM put__apply_current_crypto_delta(_to_account_id, _crypto_asset_id, _amount, _cost);

    -- The value follows the crypto into the other owner's free budget.
    IF _from_unallocated <> _to_unallocated AND _cost > 0 THEN
        INSERT INTO budget_entries (operation_id, category_id, currency_code, amount)
        VALUES (_operation_id, _from_unallocated, _base, -_cost),
               (_operation_id, _to_unallocated, _base, _cost);
        PERFORM put__apply_current_budget_delta(_from_unallocated, _base, -_cost);
        PERFORM put__apply_current_budget_delta(_to_unallocated, _base, _cost);
    END IF;

    RETURN jsonb_build_object('operation_id', _operation_id, 'quantity', _amount::text,
                              'cost_base', _cost, 'base_currency_code', _base);
END
$function$;
