-- VND has no minor units: amounts stay whole, base costs come from FX lots and
-- the CBR quote values a currency reserve. Synthetic data, rolled back.
BEGIN;
SET LOCAL search_path TO budgeting;

-- A fresh schema gets VND from tb/ and baselines the migration without
-- running it, so the migration itself is exercised here, twice.
DELETE FROM currencies WHERE code = 'VND';
\ir ../migrations/061_add_vnd_currency.sql
\ir ../migrations/061_add_vnd_currency.sql

DO $$
DECLARE
    _user_id bigint := 990000000661;
    _ctx jsonb;
    _account bigint;
    _unallocated bigint;
    _fx_result bigint;
    _food bigint;
    _reserve bigint;
    _lot bigint;
    _op jsonb;
    _summary jsonb;
    _row jsonb;
BEGIN
    ASSERT (SELECT count(*) = 1 AND min(scale) = 0 FROM currencies WHERE code = 'VND'),
        'the migration adds VND once, without minor units';
    ASSERT get__currencies() @> '[{"code":"VND","scale":0}]'::jsonb,
        'VND is offered in currency pickers';

    _ctx := put__register_user_context(_user_id, 'RUB', NULL, 'VND', 'Test');
    _account := (_ctx->>'bank_account_id')::bigint;
    _unallocated := (_ctx->>'unallocated_category_id')::bigint;
    _fx_result := (_ctx->>'fx_result_category_id')::bigint;
    _food := put__create_category(_user_id, 'Еда', 'regular');
    PERFORM put__record_income(_user_id, _account, 10000, 'RUB');
    PERFORM put__allocate_budget(_user_id, _unallocated, _food, 5000);

    PERFORM put__exchange_currency(_user_id, _account, 'RUB', 8000, 'VND', 2435060);
    ASSERT (SELECT amount = 2435060 AND historical_cost_in_base = 8000
        FROM current_bank_balances WHERE bank_account_id = _account AND currency_code = 'VND'),
        'whole dong amount and its ruble cost are kept as entered';
    SELECT id INTO _lot FROM fx_lots
    WHERE bank_account_id = _account AND currency_code = 'VND'
      AND amount_initial = 2435060 AND cost_base_initial = 8000;
    ASSERT _lot IS NOT NULL, 'the exchange opens one VND lot';
    ASSERT (SELECT sum(amount) = 10000 FROM current_budget_balances
        WHERE category_id IN (SELECT id FROM categories WHERE owner_user_id = _user_id)),
        'buying dong does not move the budget';

    _op := put__record_expense(_user_id, _account, _food, 1000000, 'VND');
    ASSERT (_op->>'expense_cost_in_base')::numeric = 3285.34,
        format('expense costs round(8000 * 1000000 / 2435060, 2), got %s', _op->>'expense_cost_in_base');
    ASSERT (SELECT amount = 1714.66 FROM current_budget_balances WHERE category_id = _food);
    ASSERT (SELECT amount_remaining = 1435060 AND cost_base_remaining = 4714.66 FROM fx_lots WHERE id = _lot);

    PERFORM put__exchange_currency(_user_id, _account, 'VND', 1435060, 'RUB', 4500);
    ASSERT (SELECT amount_remaining = 0 AND cost_base_remaining = 0 FROM fx_lots WHERE id = _lot),
        'selling the rest closes the lot';
    ASSERT (SELECT sum(cost_base) = 8000 FROM lot_consumptions WHERE lot_id = _lot),
        'consumed costs add up to the lot cost';
    ASSERT (SELECT amount = -214.66 FROM current_budget_balances WHERE category_id = _fx_result),
        'realized FX result is 4500 - 4714.66';
    ASSERT NOT EXISTS (SELECT 1 FROM current_bank_balances
        WHERE bank_account_id = _account AND currency_code = 'VND');
    ASSERT (SELECT amount = 6500 FROM current_bank_balances
        WHERE bank_account_id = _account AND currency_code = 'RUB');
    ASSERT (SELECT sum(amount) = 6500 FROM current_budget_balances
        WHERE category_id IN (SELECT id FROM categories WHERE owner_user_id = _user_id)),
        'the budget matches the ruble balance';

    _reserve := (put__create_bank_account(_user_id, 'Донги', 'user', 'investment', 'currency')->>'id')::bigint;
    PERFORM put__exchange_currency(_user_id, _account, 'RUB', 6000, 'VND', 2435060);
    PERFORM put__transfer_between_accounts(_user_id, _account, _reserve, 'VND', 2435060);
    DELETE FROM fx_rate_snapshots WHERE base_currency_code = 'RUB' AND quote_currency_code = 'VND';
    PERFORM put__record_fx_rate_snapshot('RUB', 'VND', 0.00314223, current_timestamp, 'test');
    SELECT value INTO _summary FROM jsonb_array_elements(get__portfolio_summary(_user_id))
    WHERE (value->>'investment_account_id')::bigint = _reserve;
    ASSERT (_summary->>'cash_valuation_complete')::boolean, 'the CBR quote values the reserve';
    SELECT value INTO _row FROM jsonb_array_elements(_summary->'currency_balances')
    WHERE value->>'currency_code' = 'VND';
    ASSERT (_row->>'amount')::numeric = 2435060;
    ASSERT (_row->>'rate')::numeric = 0.00314223, 'RUB per dong fits numeric(20,8) exactly';
    ASSERT (_row->>'market_value_in_base')::numeric = 7651.52,
        format('market value is round(2435060 * 0.00314223, 2), got %s', _row->>'market_value_in_base');
END $$;
ROLLBACK;
