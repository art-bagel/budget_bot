import assert from 'node:assert/strict';
import test from 'node:test';
import { canonicalAmountInput, normalizeAmountInput, readAmountField, sanitizeDecimalInput } from '../src/utils/validation.ts';

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
  assert.equal(normalizeAmountInput('45.0', 0), '45');
  // More than two zeros after four digits is a misplaced group, not a fraction:
  // "1.000000" lost a dot of "1.000.000", "1,000.000" mixes separators.
  for (const ambiguous of ['12.5', '2.435060', '1.000,50', '', '1000.000', '1.000000', '1.000,000']) {
    assert.equal(normalizeAmountInput(ambiguous, 0), null, ambiguous);
  }
  assert.equal(canonicalAmountInput('45.000', 0), '45000');
  assert.equal(canonicalAmountInput('12.5', 0), '12.5', 'left as typed for the form error');
  assert.equal(canonicalAmountInput('20.5', 2), '20.5');
});

test('currencies with kopecks keep their text unless a dong entry is left over', () => {
  assert.equal(normalizeAmountInput('20.385', 2), '20.385');
  assert.equal(normalizeAmountInput('45,5', 2), '45.5');
  assert.equal(normalizeAmountInput('2.435.060', 2), null);
});

test('an amount field reads once for previews, checks and the request', () => {
  assert.deepEqual(readAmountField('2.435.060', 0, 'VND'), { text: '2435060', value: 2435060, error: null });
  const fraction = readAmountField('12.5', 0, 'VND');
  assert.ok(Number.isNaN(fraction.value));
  assert.equal(fraction.error, 'Сумма в VND — без дробной части, например 45000');
  assert.equal(readAmountField('', 0, 'VND').error, null, 'an empty field is not an error');
  assert.deepEqual(readAmountField('0.00000001', undefined, ''), { text: '0.00000001', value: 1e-8, error: null });
});
