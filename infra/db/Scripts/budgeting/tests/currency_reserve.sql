BEGIN;
SET LOCAL search_path TO budgeting;
DO $$
DECLARE
    uid bigint := 990000000954;
    ctx jsonb; bank bigint; reserve bigint; free bigint; summary jsonb; row jsonb;
    op bigint; rejected boolean := false;
BEGIN
    ctx := put__register_user_context(uid, 'RUB', NULL, 'Currency', 'Reserve');
    bank := (ctx->>'bank_account_id')::bigint;
    free := (ctx->>'unallocated_category_id')::bigint;
    reserve := (put__create_bank_account(uid, 'Валюта', 'user', 'investment', 'currency')->>'id')::bigint;
    PERFORM put__record_income(uid, bank, 100, 'USD', NULL, 8000);
    PERFORM put__record_income(uid, bank, 50, 'EUR', NULL, 4500);
    PERFORM put__record_income(uid, bank, 100, 'EGP', NULL, 160);
    PERFORM put__record_income(uid, bank, 100, 'TRY', NULL, 200);
    PERFORM put__record_income(uid, bank, 1000, 'RUB');
    PERFORM put__transfer_between_accounts(uid, bank, reserve, 'USD', 100);
    PERFORM put__transfer_between_accounts(uid, bank, reserve, 'EUR', 50);
    PERFORM put__transfer_between_accounts(uid, bank, reserve, 'EGP', 100);
    PERFORM put__transfer_between_accounts(uid, bank, reserve, 'TRY', 100);
    PERFORM put__transfer_between_accounts(uid, bank, reserve, 'RUB', 500);
    ASSERT (SELECT amount FROM current_budget_balances WHERE category_id = free) = 500,
        'reserves leave the spendable budget at historical cost';
    ASSERT jsonb_array_length(get__operations_history(uid, 100, 0, NULL, 'other')->'items') = 5,
        'currency transfers are visible in the existing Other history';
    ASSERT NOT EXISTS (SELECT 1 FROM portfolio_positions WHERE investment_account_id = reserve),
        'no manually created positions are required';

    DELETE FROM fx_rate_snapshots WHERE base_currency_code = 'RUB' AND quote_currency_code IN ('USD','EUR','EGP','TRY');
    PERFORM put__record_fx_rate_snapshot('RUB', 'USD', 90, current_timestamp, 'test');
    PERFORM put__record_fx_rate_snapshot('RUB', 'EUR', 100, current_timestamp, 'test');
    PERFORM put__record_fx_rate_snapshot('RUB', 'EGP', 2, current_timestamp, 'test');
    PERFORM put__record_fx_rate_snapshot('RUB', 'TRY', 3, current_timestamp, 'test');
    SELECT value INTO summary FROM jsonb_array_elements(get__portfolio_summary(uid)) WHERE (value->>'investment_account_id')::bigint = reserve;
    ASSERT (summary->>'cash_balance_in_base')::numeric = 13360, 'historical cost stays unchanged';
    ASSERT (summary->>'cash_market_value_in_base')::numeric = 15000, 'capital uses current rates';
    ASSERT (summary->>'cash_valuation_complete')::boolean;
    ASSERT jsonb_array_length(summary->'currency_balances') = 5, 'all holdings appear automatically';
    SELECT value INTO row FROM jsonb_array_elements(summary->'currency_balances') WHERE value->>'currency_code' = 'USD';
    ASSERT (row->>'unrealized_result_in_base')::numeric = 1000;
    ASSERT (SELECT amount FROM current_budget_balances WHERE category_id = free) = 500, 'unrealized gain is not income';

    op := (put__transfer_between_accounts(uid, reserve, bank, 'USD', 25)->>'operation_id')::bigint;
    ASSERT (SELECT amount = 75 AND historical_cost_in_base = 6000 FROM current_bank_balances WHERE bank_account_id = reserve AND currency_code = 'USD');
    ASSERT (SELECT amount FROM current_budget_balances WHERE category_id = free) = 2500, 'withdrawal restores original cost to budget';
    PERFORM put__reverse_operation(uid, op);
    ASSERT (SELECT amount = 100 AND historical_cost_in_base = 8000 FROM current_bank_balances WHERE bank_account_id = reserve AND currency_code = 'USD');
    ASSERT (SELECT amount FROM current_budget_balances WHERE category_id = free) = 500;

    DELETE FROM fx_rate_snapshots WHERE base_currency_code = 'RUB' AND quote_currency_code = 'EGP';
    SELECT value INTO summary FROM jsonb_array_elements(get__portfolio_summary(uid)) WHERE (value->>'investment_account_id')::bigint = reserve;
    ASSERT NOT (summary->>'cash_valuation_complete')::boolean, 'missing quote is explicit';
    ASSERT (summary->>'cash_market_value_in_base')::numeric = 14800, 'missing quote is not silently replaced by cost';
    SELECT value INTO row FROM jsonb_array_elements(summary->'currency_balances') WHERE value->>'currency_code' = 'EGP';
    ASSERT row->>'market_value_in_base' IS NULL;
    ASSERT (row->>'historical_cost_in_base')::numeric = 160;

    BEGIN
        PERFORM put__create_portfolio_position(uid, reserve, 'currency', 'Duplicate', NULL, 10, 'RUB');
    EXCEPTION WHEN raise_exception THEN rejected := SQLERRM LIKE 'Валютный счёт учитывает остатки автоматически%';
    END;
    ASSERT rejected, 'manual positions cannot duplicate currency balances';
    PERFORM put__register_user_context(uid + 1, 'RUB', NULL, 'Other', 'Owner');
    ASSERT get__portfolio_summary(uid + 1) = '[]'::jsonb, 'reserve access stays owner scoped';
END $$;
ROLLBACK;
