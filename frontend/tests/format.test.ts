import assert from 'node:assert/strict';
import test from 'node:test';
import { currencyFractionDigits, formatAmount, formatRate } from '../src/utils/format.ts';

// Intl separates thousands with a no-break space; compare with plain spaces.
const plain = (text: string) => text.replace(/ /g, ' ');

test('dong amounts are whole, other currencies keep kopecks', () => {
  assert.equal(plain(formatAmount(2435060, 'VND')), '2 435 060 ₫');
  assert.equal(plain(formatAmount(2435060.47, 'VND')), '2 435 060 ₫');
  assert.equal(plain(formatAmount(-0.4, 'VND')), '0 ₫');
  assert.equal(plain(formatAmount(1234.5, 'RUB')), '1 234,5 ₽');
});

test('fraction digits follow the currency scale of the reference table', () => {
  for (const code of ['CNY', 'EGP', 'EUR', 'KZT', 'RUB', 'TRY', 'USD']) {
    assert.equal(currencyFractionDigits(code), 2, code);
  }
  assert.equal(currencyFractionDigits('VND'), 0);
  assert.equal(currencyFractionDigits('USDT'), 2, 'codes Intl rejects keep two digits');
});

test('rates below one keep significant digits', () => {
  assert.equal(formatRate(0.00314223, 4), '0,003142');
  assert.equal(formatRate(318.2464, 4), '318,2464');
  assert.equal(formatRate(80.1234, 2), '80,12');
});
