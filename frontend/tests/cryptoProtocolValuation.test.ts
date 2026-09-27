import assert from 'node:assert/strict';
import test from 'node:test';
import { isEmptyProtocolPosition, protocolMarketValue, sumProtocolValues, walletMarketValue } from '../src/utils/cryptoProtocolValuation.ts';
import type { CryptoLivePrice, CryptoProtocolPosition } from '../src/types.ts';

const position = (patch: Partial<CryptoProtocolPosition> = {}) => ({
  position_type: 'lending', crypto_asset_id: 1, quantity: 100, current_quantity: 100,
  cost_basis_in_base: 10000, current_value_in_base: 999999,
  metadata: { borrowed_quantity: 10, borrowed_crypto_asset_id: 2 }, ...patch,
}) as CryptoProtocolPosition;
const quote = (id: number, price: number, patch: Partial<CryptoLivePrice> = {}) => ({
  crypto_asset_id: id, symbol: id === 1 ? 'TON' : 'USDT', vs_currency: 'RUB',
  price, source: 'test', fetched_at: '2026-09-27T10:00:00Z', ...patch,
});
const prices = new Map([[1, quote(1, 200)], [2, quote(2, 80)]]);

test('lending subtracts debt at the same currency and preserves basis', () => {
  const p = position();
  const snapshot = JSON.stringify(p);
  assert.equal(protocolMarketValue(p, prices, 'RUB').value, 19200);
  assert.equal(JSON.stringify(p), snapshot);
});
test('missing, stale or wrong-currency debt quote cannot fall back to historical value', () => {
  for (const patch of [{ is_stale: true }, { vs_currency: 'USD' }, { price: 0 }]) {
    assert.equal(protocolMarketValue(position(), new Map([[1, quote(1, 200)], [2, quote(2, 80, patch)]]), 'RUB').value, null);
  }
  assert.equal(protocolMarketValue(position(), new Map([[1, quote(1, 200)]]), 'RUB').value, null);
});
test('LP deposits and two live prices are insufficient to infer current reserves', () => {
  assert.equal(protocolMarketValue(position({ position_type: 'liquidity_pool' }), prices, 'RUB').value, null);
});
test('zero collateral still retains and values an outstanding debt', () => {
  assert.equal(protocolMarketValue(position({ current_quantity: 0 }), prices, 'RUB').value, -800);
});
test('staking uses current quantity; an incomplete group never becomes a total', () => {
  const known = protocolMarketValue(position({ position_type: 'staking', current_quantity: 105 }), prices, 'RUB');
  assert.equal(known.value, 21000);
  assert.equal(sumProtocolValues([known, { value: null, reason: 'missing', quotes: [] }]), null);
  assert.equal(sumProtocolValues([known, known]), 42000);
});

test('hide only empty positions, retaining dust, debt and unsettled funding', () => {
  const empty = position({ current_quantity: 0, cost_basis_in_base: 0, metadata: {} });
  assert.equal(isEmptyProtocolPosition(empty), true);
  for (const patch of [{ current_quantity: 0.000000001 }, { cost_basis_in_base: null },
    { metadata: { borrowed_quantity: 1 } }, { metadata: { funding_units0: { '12': '0.001' } } }]) {
    assert.equal(isEmptyProtocolPosition({ ...empty, ...patch }), false);
  }
});

test('LP snapshot requires both current quotes and a composition dated today', () => {
  const metadata = { token1_crypto_asset_id: 2, lp_composition: { quantity0: '10', quantity1: '20', observed_at: new Date().toISOString().slice(0, 10) } };
  const p = position({ position_type: 'liquidity_pool', metadata });
  assert.equal(protocolMarketValue(p, prices, 'RUB').value, 3600);
  assert.equal(protocolMarketValue(p, new Map([[1, quote(1, 200)]]), 'RUB').value, null);
  metadata.lp_composition.observed_at = '2000-01-01';
  assert.equal(protocolMarketValue(p, prices, 'RUB').value, null);
});

test('wallet valuation distinguishes zero balance from unavailable market value', () => {
  assert.equal(walletMarketValue(0, 1, new Map(), 'RUB'), 0);
  assert.equal(walletMarketValue(5, 1, new Map(), 'RUB'), null);
  assert.equal(walletMarketValue(5, 1, prices, 'RUB'), 1000);
  for (const patch of [{ is_stale: true }, { vs_currency: 'USD' }, { price: NaN }, { price: 0 }]) {
    assert.equal(walletMarketValue(5, 1, new Map([[1, quote(1, 200, patch)]]), 'RUB'), null);
  }
});
