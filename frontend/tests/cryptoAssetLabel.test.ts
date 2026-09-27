import assert from 'node:assert/strict';
import test from 'node:test';
import { cryptoAssetLabel } from '../src/utils/cryptoAssetLabel.ts';
import type { CryptoAsset } from '../src/types.ts';
const asset = (id: number, address: string, network = 'ton') => ({ id, symbol: 'USDT', network_code: network, contract_address: address }) as CryptoAsset;
test('same symbols keep distinct contract and service identities', () => {
  const assets = [asset(1, ''), asset(2, '0:1234567890abcdef1234567890'), asset(3, 'service:exchange:USDT')];
  assert.equal(new Set(assets.map(a => cryptoAssetLabel(a, assets))).size, 3);
  assert.match(cryptoAssetLabel(assets[0], assets), /без адреса/);
  assert.match(cryptoAssetLabel(assets[2], assets), /exchange:USDT/);
  assert.equal(assets.length, 3);
});
test('abbreviated address collisions remain distinguishable', () => {
  const assets = [asset(1, '0:12345678aaaaaaaa12345678'), asset(2, '0:12345678bbbbbbbb12345678')];
  assert.notEqual(cryptoAssetLabel(assets[0], assets), cryptoAssetLabel(assets[1], assets));
});
test('different networks need no additional identity label', () => {
  const assets = [asset(1, '', 'ton'), asset(2, '', 'ethereum')];
  assert.equal(cryptoAssetLabel(assets[0], assets), 'USDT · ton');
});
