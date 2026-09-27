import assert from 'node:assert/strict';
import test from 'node:test';
import { walletPositions } from '../src/utils/cryptoWalletPositions.ts';
import type { PortfolioPosition } from '../src/types.ts';

function position(id: number, account: number, asset: number, status: string, quantity: number) {
  return { id, investment_account_id: account, asset_type_code: 'crypto', status, quantity,
    amount_in_currency: 0, metadata: { crypto_asset_id: asset }, title: 'USDT' } as PortfolioPosition;
}

test('closed acquisition lots share one wallet card and never add old quantities', () => {
  const rows = walletPositions([position(1, 10, 2, 'closed', 20), position(2, 10, 2, 'open', 5), position(3, 10, 2, 'open', 7)]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].quantity, 12);
  assert.equal(rows[0].id, 2);
  assert.deepEqual(rows[0].metadata.grouped_position_ids, [1, 2, 3]);
});
test('zero wallet asset survives its last disposal', () => {
  const [row] = walletPositions([position(1, 10, 2, 'closed', 20)]);
  assert.equal(row.quantity, 0);
  assert.equal(row.status, 'open');
});
test('same tickers in different wallets or canonical assets remain separate', () => {
  assert.equal(walletPositions([position(1, 10, 2, 'open', 5), position(2, 11, 2, 'open', 7), position(3, 10, 15, 'open', 9)]).length, 3);
});
test('non-crypto closed positions keep their existing lifecycle', () => {
  const row = { ...position(1, 10, 2, 'closed', 20), asset_type_code: 'deposit' } as PortfolioPosition;
  assert.equal(walletPositions([row]).length, 0);
});
