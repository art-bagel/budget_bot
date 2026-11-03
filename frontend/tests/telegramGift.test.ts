import assert from 'node:assert/strict';
import test from 'node:test';
import { telegramGiftKey, telegramGiftLink, telegramGiftSlug, telegramGiftTitle, telegramGiftTraits } from '../src/utils/telegramGift.ts';

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
  assert.equal(telegramGiftSlug('Durov’s Cap'), 'DurovsCap');
  assert.equal(telegramGiftSlug("Durov's Cap"), 'DurovsCap');
  assert.equal(telegramGiftSlug('Плюшевый Пепе'), null);
  assert.equal(telegramGiftSlug('../x'), null);
});

test('the lookup key needs a slug and a short number', () => {
  assert.equal(telegramGiftKey(' Plush Pepe ', ' 7 '), 'plushpepe-7');
  assert.equal(telegramGiftKey('Plush Pepe', ''), '');
  assert.equal(telegramGiftKey('Плюш', '7'), '');
  assert.equal(telegramGiftKey('Plush Pepe', '1234567890'), '');
});

test('a found gift fills its traits and a lost one clears them without touching the name', () => {
  const found = telegramGiftTraits({ collection: 'Plush Pepe', number: '7', model: 'Gold 1%', backdrop: null, symbol: 'Star' });
  assert.deepEqual(found, { collection: 'Plush Pepe', number: '7', upgraded: 'yes', model: 'Gold 1%', backdrop: '', symbol: 'Star' });
  assert.deepEqual(telegramGiftTraits(null), { model: '', backdrop: '', symbol: '', upgraded: '' });
});
