import assert from 'node:assert/strict';
import test from 'node:test';
import { sanitizeDecimalInput } from '../src/utils/validation.ts';

// iOS decimal keypad in Russian gives a comma; the API accepts only a dot.
test('comma from the keypad becomes a dot', () => {
  assert.equal(sanitizeDecimalInput('20,38'), '20.38');
  assert.equal(sanitizeDecimalInput('1 000,5'), '1000.5');
  assert.equal(sanitizeDecimalInput('20.38'), '20.38');
});
