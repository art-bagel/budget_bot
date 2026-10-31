import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildReceiptComment,
  localToday,
  receiptDateForExpense,
  receiptExpenseAmount,
  receiptItemsDiff,
  receiptRowsReady,
  receiptRowsTotal,
  replaceReceiptBlock,
} from '../src/utils/receiptScan.ts';

// Made-up receipt: amounts arrive from the API as exact decimal strings.
const bread = { name: 'ХЛЕБ', name_ru: 'Хлеб', amount: '54.90' };
const milk = { name: 'МОЛОКО', name_ru: 'Молоко', amount: '89.9' };
const discount = { name: 'СКИДКА', name_ru: 'Скидка', amount: '-10' };

test('items diff is exact across scales and signs', () => {
  assert.equal(receiptItemsDiff('144.80', [bread, milk]), '0');
  assert.equal(receiptItemsDiff('134.80', [bread, milk, discount]), '0');
  assert.equal(receiptItemsDiff('0.3', [{ ...bread, amount: '0.1' }, { ...milk, amount: '0.2' }]), '0');
  assert.equal(receiptItemsDiff('150', [bread, milk]), '5.2');
  assert.equal(receiptItemsDiff('140', [bread, milk]), '-4.8');
  assert.equal(receiptItemsDiff('1250000', [{ ...bread, amount: '1250002' }]), '-2');
  assert.equal(receiptItemsDiff('99.99', []), '99.99');
});

test('total is the sum of the current rows, keeping cents', () => {
  assert.equal(receiptRowsTotal([bread, milk]), '144.80');
  assert.equal(receiptRowsTotal([bread, { ...milk, amount: '100' }]), '154.90', 'edited amount');
  assert.equal(receiptRowsTotal([bread]), '54.90', 'removed row');
  assert.equal(receiptRowsTotal([bread, milk, discount]), '134.80', 'discount keeps its sign');
  assert.equal(receiptRowsTotal([{ ...bread, amount: '1250000' }, { ...milk, amount: '2' }]), '1250002');
  assert.equal(receiptRowsTotal([bread, { ...milk, amount: '' }, { ...milk, amount: '12.' }]), '54.90', 'unfinished rows skipped');
  assert.equal(receiptRowsTotal([]), '0');
  assert.equal(receiptRowsTotal([discount]), '-10');
});

test('rows are ready when every row has a name and an amount', () => {
  assert.equal(receiptRowsReady([bread, milk, discount]), true);
  assert.equal(receiptRowsReady([]), true);
  assert.equal(receiptRowsReady([bread, { name_ru: '  ', amount: '5' }]), false, 'no name');
  for (const amount of ['', '12.', '.5', '1,5', 'abc']) {
    assert.equal(receiptRowsReady([{ name_ru: 'Сыр', amount }]), false, `amount ${JSON.stringify(amount)}`);
  }
});

test('expense amount is the total when it is above zero', () => {
  assert.equal(receiptExpenseAmount('144.80'), '144.80');
  assert.equal(receiptExpenseAmount('0'), null);
  assert.equal(receiptExpenseAmount('0.00'), null);
  assert.equal(receiptExpenseAmount('-10'), null);
  assert.equal(receiptExpenseAmount(null), null);
});

test('comment lists Russian names with comma amounts', () => {
  assert.equal(buildReceiptComment('Лавка', [bread, milk]), 'Лавка: Хлеб 54,90; Молоко 89,9', 'digits as printed');
  assert.equal(buildReceiptComment(null, [discount]), 'Скидка −10');
  assert.equal(buildReceiptComment('Лавка', []), '');
  const big = { ...bread, amount: '1250000' };
  assert.equal(buildReceiptComment(null, [big]), 'Хлеб 1 250 000');
});

test('comment is capped at 1000 chars on a whole item', () => {
  const items = Array.from({ length: 200 }, (_, n) => ({ name: 'X', name_ru: `Товар номер ${n}`, amount: '100' }));
  const comment = buildReceiptComment('Лавка', items);
  assert.ok(comment.length <= 1000, String(comment.length));
  assert.ok(comment.endsWith('; …'), comment.slice(-20));
  assert.match(comment, /Товар номер \d+ 100; …$/);
});

test('repeated apply replaces the inserted block and keeps own text', () => {
  assert.equal(replaceReceiptBlock('', null, 'Лавка: Хлеб 54,9'), 'Лавка: Хлеб 54,9');
  assert.equal(replaceReceiptBlock('на ужин', null, 'Лавка: Хлеб 54,9'), 'на ужин · Лавка: Хлеб 54,9');
  assert.equal(
    replaceReceiptBlock('на ужин · Лавка: Хлеб 54,9', 'Лавка: Хлеб 54,9', 'Лавка: Молоко 89,9'),
    'на ужин · Лавка: Молоко 89,9',
  );
  assert.equal(replaceReceiptBlock('Лавка: Хлеб 54,9', 'Лавка: Хлеб 54,9', ''), '');
  assert.equal(replaceReceiptBlock('на ужин', 'старый блок', 'новый'), 'на ужин · новый', 'edited away');
  assert.equal(replaceReceiptBlock('на ужин', null, ''), 'на ужин');
  assert.equal(
    replaceReceiptBlock('на ужин · Лавка: Хлеб 54,9 · с гостями', 'Лавка: Хлеб 54,9', 'Лавка: Сыр 300'),
    'на ужин · с гостями · Лавка: Сыр 300',
    'no double separator when the block was in the middle',
  );
});

test('receipt date is used only within the last 31 days', () => {
  assert.equal(receiptDateForExpense('2026-10-31', '2026-10-31'), '2026-10-31');
  assert.equal(receiptDateForExpense('2026-09-30', '2026-10-31'), '2026-09-30');
  assert.equal(receiptDateForExpense('2026-09-29', '2026-10-31'), null);
  assert.equal(receiptDateForExpense('2026-11-01', '2026-10-31'), null);
  assert.equal(receiptDateForExpense(null, '2026-10-31'), null);
});

test('today is the local date, not UTC', () => {
  // CI runs in UTC, where local and UTC dates match: pin a zone east of Greenwich.
  const savedZone = process.env.TZ;
  process.env.TZ = 'Europe/Moscow';
  try {
    const justAfterMidnight = new Date(2026, 10, 1, 0, 30);
    assert.equal(justAfterMidnight.toISOString().slice(0, 10), '2026-10-31', 'still Oct 31 in UTC');
    assert.equal(localToday(justAfterMidnight), '2026-11-01');
  } finally {
    if (savedZone === undefined) delete process.env.TZ;
    else process.env.TZ = savedZone;
  }
});
