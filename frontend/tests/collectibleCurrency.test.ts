import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultPositionCurrency, defaultPurchaseCurrency } from '../src/utils/collectibleCurrency.ts';

const gram = { crypto_asset_id: 1, symbol: 'GRAM', amount: 20 };
const ton = { crypto_asset_id: 2, symbol: 'TON', amount: 5 };

test('a purchase starts with GRAM, else the only coin, else the base currency', () => {
  assert.equal(defaultPurchaseCurrency([ton, gram], 'RUB'), 'crypto:1');
  assert.equal(defaultPurchaseCurrency([ton], 'RUB'), 'crypto:2');
  assert.equal(defaultPurchaseCurrency([ton, { crypto_asset_id: 3, symbol: 'USDT', amount: 1 }], 'RUB'), 'RUB');
  assert.equal(defaultPurchaseCurrency([{ ...gram, amount: 0 }], 'RUB'), 'RUB');
  assert.equal(defaultPurchaseCurrency([], 'RUB'), 'RUB');
});

const options = [{ value: 'RUB' }, { value: 'USD' }, { value: 'crypto:1', symbol: 'GRAM' }, { value: 'crypto:2', symbol: 'TON' }];

test('a position form starts with the coin the item was bought with', () => {
  const bought = { currency_code: 'RUB', metadata: { paid_crypto: { crypto_asset_id: 2, symbol: 'TON', quantity: 3 } } };
  assert.equal(defaultPositionCurrency(bought, options), 'crypto:2');
  // The form offers fiat only (partial sale): back to the position currency.
  assert.equal(defaultPositionCurrency(bought, options.slice(0, 2)), 'RUB');
  assert.equal(defaultPositionCurrency({ currency_code: 'USD', metadata: {} }, options), 'USD');
});

test('a free or unknown-price item starts with GRAM when the form offers it', () => {
  assert.equal(defaultPositionCurrency({ currency_code: 'RUB', metadata: { acquisition_kind: 'free' } }, options), 'crypto:1');
  assert.equal(defaultPositionCurrency({ currency_code: 'RUB', metadata: { acquisition_kind: 'unknown' } }, options), 'crypto:1');
  assert.equal(defaultPositionCurrency({ currency_code: 'RUB', metadata: { acquisition_kind: 'free' } }, options.slice(0, 2)), 'RUB');
});
