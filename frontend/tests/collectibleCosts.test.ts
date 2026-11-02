import assert from 'node:assert/strict';
import test from 'node:test';
import { collectibleCostTotals, collectibleCostsLabel, positionFeesInBase } from '../src/utils/collectibleCosts.ts';

const fmt = (amount: number, currency: string) => `${amount} ${currency}`;
const item = (amount: number, extra: Record<string, unknown> = {}, currency = 'RUB') =>
  ({ currency_code: currency, amount_in_currency: amount, metadata: extra });

test('fees join the costs of an item in the base currency', () => {
  assert.equal(positionFeesInBase(item(100)), 0);
  assert.equal(positionFeesInBase(item(100, { fees_in_base: 15 })), 15);
  assert.deepEqual(collectibleCostTotals([item(100, { fees_in_base: 15 })], 'RUB'), [['RUB', 115]]);
  assert.equal(collectibleCostsLabel([item(100, { fees_in_base: 15 }), item(50)], 'RUB', fmt), '165 RUB');
});

test('a foreign-currency price keeps its fees as a separate base summand', () => {
  assert.equal(collectibleCostsLabel([item(40, { fees_in_base: 50 }, 'USD')], 'RUB', fmt), '40 USD + 50 RUB');
});

test('free and unknown-price items show their fees too', () => {
  assert.equal(collectibleCostsLabel([item(0, { acquisition_kind: 'free' })], 'RUB', fmt), 'бесплатно');
  assert.equal(collectibleCostsLabel([item(0, { acquisition_kind: 'free', fees_in_base: 50 })], 'RUB', fmt), 'бесплатно · затраты 50 RUB');
  assert.equal(collectibleCostsLabel([item(0, { acquisition_kind: 'unknown' })], 'RUB', fmt), 'цена неизвестна');
  assert.equal(collectibleCostsLabel([item(0, { acquisition_kind: 'unknown', fees_in_base: 50 })], 'RUB', fmt), 'известно 50 RUB · цена неизвестна');
  assert.equal(collectibleCostsLabel([item(0)], 'RUB', fmt), '0 RUB');
});
