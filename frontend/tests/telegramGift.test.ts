import assert from 'node:assert/strict';
import test from 'node:test';
import { telegramGiftSlug, telegramGiftTitle } from '../src/utils/telegramGift.ts';

test('a gift is named by its collection and number like Telegram does', () => {
  assert.equal(telegramGiftTitle({ collection: 'Vice Cream', number: '12323' }, 'old'), 'Vice Cream #12323');
  assert.equal(telegramGiftTitle({ collection: ' Plush Pepe ', number: ' ' }, 'old'), 'Plush Pepe');
  assert.equal(telegramGiftTitle({ number: '5' }, 'Тестовый подарок'), 'Тестовый подарок');
});

test('the t.me slug drops spaces and dashes and allows only Latin letters and digits', () => {
  assert.equal(telegramGiftSlug('Vice Cream'), 'ViceCream');
  assert.equal(telegramGiftSlug('B-Day Candle'), 'BDayCandle');
  assert.equal(telegramGiftSlug('Плюшевый Пепе'), null);
  assert.equal(telegramGiftSlug('../x'), null);
});
