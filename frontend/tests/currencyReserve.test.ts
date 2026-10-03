import assert from 'node:assert/strict';
import test from 'node:test';
import { currencyReserveResult, portfolioCashValue } from '../src/utils/currencyReserve.ts';
import type { PortfolioSummaryItem } from '../src/types.ts';

const reserve = (patch: Partial<PortfolioSummaryItem> = {}) => ({
  investment_asset_type: 'currency', cash_balance_in_base: 8000,
  cash_market_value_in_base: 9000, cash_valuation_complete: true, ...patch,
}) as PortfolioSummaryItem;

test('capital uses market value once and profit compares with original cost', () => {
  assert.equal(portfolioCashValue(reserve()), 9000);
  assert.equal(currencyReserveResult(reserve()), 1000);
  assert.equal(currencyReserveResult(reserve({ cash_market_value_in_base: 7000 })), -1000);
});
test('missing quotes do not turn historical basis into market value or a loss', () => {
  const incomplete = reserve({ cash_market_value_in_base: 0, cash_valuation_complete: false });
  assert.equal(portfolioCashValue(incomplete), 0);
  assert.equal(currencyReserveResult(incomplete), 0);
});
test('existing accounts and older responses retain their cash semantics', () => {
  const old = reserve({ investment_asset_type: 'other', cash_market_value_in_base: undefined });
  assert.equal(portfolioCashValue(old), 8000);
  assert.equal(currencyReserveResult(old), 0);
  assert.equal(portfolioCashValue(undefined), 0);
});
