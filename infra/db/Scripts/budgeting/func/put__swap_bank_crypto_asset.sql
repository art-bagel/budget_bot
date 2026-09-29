-- Exchange one banking crypto for another on the same cash account, e.g.
-- USDT (TON) -> USDC (Arbitrum). The FIFO cost of the given units carries into
-- one new lot of the received coin: no market revaluation, sale, income or
-- FX result, as carried swaps in the portfolio. Units already spent outside the
-- bot (awaiting an expense category) cannot be exchanged.
DROP FUNCTION IF EXISTS budgeting.put__swap_bank_crypto_asset;
CREATE FUNCTION budgeting.put__swap_bank_crypto_asset(
    _user_id bigint,
    _bank_account_id bigint,
    _from_crypto_asset_id bigint,
    _from_quantity numeric,
    _to_crypto_asset_id bigint,
    _to_quantity numeric,
    _comment text,
    _operated_at date
)
RETURNS jsonb
LANGUAGE plpgsql
AS $function$
DECLARE
    _account record;
    _from_symbol text;
    _base char(3);
    _need numeric(50, 18);
    _take numeric(50, 18);
    _take_cost numeric(20, 2);
    _cost numeric(20, 2) := 0;
    _lot record;
    _operation_id bigint;
BEGIN
    SET search_path TO budgeting;
    IF NULLIF(current_setting('budgeting.crypto_source_event_id', true), '') IS NULL THEN
        RAISE EXCEPTION 'Bank crypto exchange requires the source journal';
    END IF;

    SELECT * INTO _account FROM bank_accounts WHERE id = _bank_account_id AND is_active FOR UPDATE;
    IF _account.id IS NULL OR _account.account_kind <> 'cash'
       OR NOT has__owner_access(_user_id, _account.owner_type, _account.owner_user_id, _account.owner_family_id) THEN
        RAISE EXCEPTION 'Нет доступа к банковскому счёту';
    END IF;
    IF _from_crypto_asset_id = _to_crypto_asset_id THEN
        RAISE EXCEPTION 'Выберите разные монеты';
    END IF;
    SELECT symbol INTO _from_symbol FROM crypto_assets WHERE id = _from_crypto_asset_id;
    IF _from_symbol IS NULL OR NOT EXISTS (SELECT 1 FROM crypto_assets WHERE id = _to_crypto_asset_id) THEN
        RAISE EXCEPTION 'Неизвестная криптовалюта';
    END IF;
    _base := get__owner_base_currency(_account.owner_type, _account.owner_user_id, _account.owner_family_id);

    PERFORM 1 FROM current_crypto_balances
    WHERE bank_account_id = _bank_account_id AND crypto_asset_id IN (_from_crypto_asset_id, _to_crypto_asset_id)
    ORDER BY crypto_asset_id FOR UPDATE;

    INSERT INTO operations (actor_user_id, owner_type, owner_user_id, owner_family_id, type, comment, operated_on)
    VALUES (_user_id, _account.owner_type, _account.owner_user_id, _account.owner_family_id, 'exchange',
            NULLIF(btrim(_comment), ''), _operated_at)
    RETURNING id INTO _operation_id;

    _need := _from_quantity;
    FOR _lot IN
        SELECT id, amount_remaining, cost_base_remaining
        FROM crypto_lots
        WHERE bank_account_id = _bank_account_id
          AND crypto_asset_id = _from_crypto_asset_id
          AND amount_remaining > 0
          AND NOT COALESCE((metadata->>'reserved_for_manual_expense')::boolean, false)
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
        _cost := _cost + _take_cost;
        _need := _need - _take;
    END LOOP;
    IF _need > 0 THEN
        RAISE EXCEPTION 'Сумма превышает доступный остаток%', COALESCE((
            SELECT format(': %s %s уже потрачены вне бота и ждут категории расхода',
                          trim_scale(sum(amount_remaining)), _from_symbol)
            FROM crypto_lots
            WHERE bank_account_id = _bank_account_id AND crypto_asset_id = _from_crypto_asset_id AND amount_remaining > 0
              AND COALESCE((metadata->>'reserved_for_manual_expense')::boolean, false)
            HAVING sum(amount_remaining) > 0), '');
    END IF;

    INSERT INTO crypto_lots (bank_account_id, crypto_asset_id, amount_initial, amount_remaining,
                             cost_base_initial, cost_base_remaining, opened_by_operation_id)
    VALUES (_bank_account_id, _to_crypto_asset_id, _to_quantity, _to_quantity, _cost, _cost, _operation_id);
    INSERT INTO crypto_bank_entries (operation_id, bank_account_id, crypto_asset_id, amount)
    VALUES (_operation_id, _bank_account_id, _from_crypto_asset_id, -_from_quantity),
           (_operation_id, _bank_account_id, _to_crypto_asset_id, _to_quantity);
    PERFORM put__apply_current_crypto_delta(_bank_account_id, _from_crypto_asset_id, -_from_quantity, -_cost);
    PERFORM put__apply_current_crypto_delta(_bank_account_id, _to_crypto_asset_id, _to_quantity, _cost);

    RETURN jsonb_build_object('operation_id', _operation_id, 'cost_base', _cost, 'base_currency_code', _base,
                              'effective_rate', _to_quantity / _from_quantity, 'realized_fx_result_in_base', 0);
END
$function$;
