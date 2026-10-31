import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeAmountInput, parseAmountInput, sanitizeDecimalInput } from '../src/utils/validation.ts';

// iOS decimal keypad in Russian gives a comma; the API accepts only a dot.
test('comma from the keypad becomes a dot', () => {
  assert.equal(sanitizeDecimalInput('20,38'), '20.38');
  assert.equal(sanitizeDecimalInput('1 000,5'), '1000.5');
  assert.equal(sanitizeDecimalInput('20.38'), '20.38');
  assert.equal(sanitizeDecimalInput('20,38', 2), '20.38');
});

// Vietnamese receipts group thousands with a dot: "45.000 ₫" is 45 000 dong.
test('whole-unit currencies keep separators while typing', () => {
  assert.equal(sanitizeDecimalInput('2.435.060 ₫', 0), '2.435.060');
});

test('whole-unit amounts resolve thousands and refuse fractions', () => {
  assert.equal(normalizeAmountInput('2.435.060', 0), '2435060');
  assert.equal(normalizeAmountInput('45,000', 0), '45000');
  assert.equal(normalizeAmountInput('45.000', 0), '45000');
  assert.equal(normalizeAmountInput('45000.00', 0), '45000');
  assert.equal(normalizeAmountInput('45,00', 0), '45');
  assert.equal(normalizeAmountInput('45000', 0), '45000');
  for (const ambiguous of ['12.5', '2.435060', '1.000,50', '']) {
    assert.equal(normalizeAmountInput(ambiguous, 0), null, ambiguous);
  }
  assert.equal(parseAmountInput('2.435.060', 0), 2435060);
  assert.ok(Number.isNaN(parseAmountInput('12.5', 0)));
});

test('currencies with kopecks keep their text unless a dong entry is left over', () => {
  assert.equal(normalizeAmountInput('20.385', 2), '20.385');
  assert.equal(normalizeAmountInput('45,5', 2), '45.5');
  assert.equal(normalizeAmountInput('2.435.060', 2), null);
  assert.equal(parseAmountInput('20.38', 2), 20.38);
});
