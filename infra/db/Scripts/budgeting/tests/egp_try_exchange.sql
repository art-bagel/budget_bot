-- Synthetic exchange and valuation scenario; leaves no test data behind.
BEGIN;
SET LOCAL search_path TO budgeting;
DO $$
DECLARE
    _user_id bigint := 990000000552;
    _ctx jsonb;
    _account bigint;
    _valuation jsonb;
BEGIN
    ASSERT get__currencies() @> '[{"code":"EGP","scale":2},{"code":"TRY","scale":2}]'::jsonb,
        'EGP and TRY must be available in the currency picker';
    _ctx := put__register_user_context(_user_id, 'RUB', NULL, 'EGP TRY', 'Test');
    _account := (_ctx->>'bank_account_id')::bigint;
    PERFORM put__record_income(_user_id, _account, 1000, 'RUB');
    PERFORM put__exchange_currency(_user_id, _account, 'RUB', 160, 'EGP', 100);
    PERFORM put__exchange_currency(_user_id, _account, 'RUB', 200, 'TRY', 100);
    ASSERT (SELECT amount = 100 AND historical_cost_in_base = 160
        FROM current_bank_balances WHERE bank_account_id = _account AND currency_code = 'EGP');
    ASSERT (SELECT amount = 100 AND historical_cost_in_base = 200
        FROM current_bank_balances WHERE bank_account_id = _account AND currency_code = 'TRY');

    PERFORM put__record_fx_rate_snapshot('RUB', 'EGP', 1.7, current_timestamp, 'test');
    PERFORM put__record_fx_rate_snapshot('RUB', 'TRY', 2.1, current_timestamp, 'test');
    _valuation := get__portfolio_valuation(_user_id, _account, 'RUB');
    ASSERT (_valuation->>'total_value')::numeric = 1020, 'market valuation uses both rates';

    PERFORM put__exchange_currency(_user_id, _account, 'EGP', 50, 'TRY', 40);
    ASSERT (SELECT amount = 140 AND historical_cost_in_base = 280
        FROM current_bank_balances WHERE bank_account_id = _account AND currency_code = 'TRY'),
        'cross exchange carries historical cost';
    PERFORM put__exchange_currency(_user_id, _account, 'TRY', 40, 'EGP', 50);
    PERFORM put__exchange_currency(_user_id, _account, 'EGP', 100, 'RUB', 160);
    PERFORM put__exchange_currency(_user_id, _account, 'TRY', 100, 'RUB', 200);
    ASSERT (SELECT amount = 1000 AND historical_cost_in_base = 1000
        FROM current_bank_balances WHERE bank_account_id = _account AND currency_code = 'RUB');
    ASSERT NOT EXISTS (SELECT 1 FROM fx_lots WHERE bank_account_id = _account AND amount_remaining <> 0);
    ASSERT (SELECT sum(amount) = 1000 FROM current_budget_balances
        WHERE category_id IN (SELECT id FROM categories WHERE owner_user_id = _user_id)),
        'exchange does not inflate the budget';
END $$;
ROLLBACK;
