import assert from 'node:assert/strict';
import test from 'node:test';
import { telegramGiftLink, telegramGiftSlug, telegramGiftTitle } from '../src/utils/telegramGift.ts';

test('a gift is named by its collection and number like Telegram does', () => {
  assert.equal(telegramGiftTitle({ collection: 'Vice Cream', number: '12323' }, 'old'), 'Vice Cream #12323');
  assert.equal(telegramGiftTitle({ collection: ' Plush Pepe ', number: ' ' }, 'old'), 'Plush Pepe');
  assert.equal(telegramGiftTitle({ number: '5' }, 'Тестовый подарок'), 'Тестовый подарок');
});

test('the public page link follows collection and number', () => {
  assert.equal(telegramGiftLink({ collection: 'Vice Cream', number: '12323' }), 'https://t.me/nft/ViceCream-12323');
  assert.equal(telegramGiftLink({ collection: 'Vice Cream' }), null);
  assert.equal(telegramGiftLink({ collection: 'Плюш', number: '1' }), null);
});

test('the t.me slug drops spaces and dashes and allows only Latin letters and digits', () => {
  assert.equal(telegramGiftSlug('Vice Cream'), 'ViceCream');
  assert.equal(telegramGiftSlug('B-Day Candle'), 'BDayCandle');
  assert.equal(telegramGiftSlug('Плюшевый Пепе'), null);
  assert.equal(telegramGiftSlug('../x'), null);
});
