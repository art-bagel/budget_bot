import assert from 'node:assert/strict';
import test from 'node:test';
import { creditCardView, creditTotals } from '../src/utils/creditCard.ts';

const bal = (amount: number) => [{ historical_cost_in_base: amount }];

test('debt uses the limit, overpayment adds to what is available', () => {
  assert.deepEqual(creditCardView(bal(-20000), 50000), { used: 20000, overpayment: 0, available: 30000, usedPct: 40, canArchive: false });
  assert.deepEqual(creditCardView(bal(1500), 50000), { used: 0, overpayment: 1500, available: 51500, usedPct: 0, canArchive: false });
  assert.deepEqual(creditCardView([], 50000), { used: 0, overpayment: 0, available: 50000, usedPct: 0, canArchive: true });
});
test('a card without a limit still shows its overpayment', () => {
  assert.deepEqual(creditCardView(bal(159), 0), { used: 0, overpayment: 159, available: 159, usedPct: 0, canArchive: false });
});
test('one card overpayment does not hide another card debt', () => {
  assert.deepEqual(creditTotals([bal(-50000), bal(1500), []]), { debt: 50000, overpayment: 1500 });
});
