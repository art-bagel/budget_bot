import assert from 'node:assert/strict';
import test from 'node:test';
import type { UserContext } from '../src/types.ts';
import {
  CACHE_KEY,
  CACHE_TTL_MS,
  CACHE_VERSION,
  type DashboardSnapshot,
  cacheIdentity,
  clearStart,
  newTicket,
  readStart,
  startSnapshot,
  writeStart,
} from '../src/startCache.ts';

class MemoryStorage {
  items = new Map<string, string>();
  getItem(key: string) { return this.items.get(key) ?? null; }
  setItem(key: string, value: string) { this.items.set(key, value); }
  removeItem(key: string) { this.items.delete(key); }
}

function useStorage(storage: unknown) {
  Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true, writable: true });
}

const user = { user_id: 7, base_currency_code: 'RUB' } as UserContext;

function dashboard(): DashboardSnapshot {
  return {
    overview: { budget_categories: [] } as unknown as DashboardSnapshot['overview'],
    investmentAccounts: [],
    investmentBalancesByAccountId: {},
    creditNetInBase: -1500,
    portfolioSummaryItems: [],
    openPositions: [],
    cryptoProtocolPositions: [],
    groupMembersByGroupId: {},
    moexPrices: new Map([['SBER', { price: 300 } as never]]),
    tinkoffLivePrices: new Map([[11, { position_id: 11 } as never]]),
    cryptoLivePrices: new Map([[42, { crypto_asset_id: 42, price: 2.5 } as never]]),
  };
}

function freshStorage() {
  const storage = new MemoryStorage();
  useStorage(storage);
  clearStart();
  return storage;
}

test('identity follows the session first, then the Telegram id', () => {
  assert.equal(cacheIdentity(true, '123'), 'session');
  assert.equal(cacheIdentity(false, '123'), 'tg:123');
  assert.equal(cacheIdentity(false, null), null);
});

test('a written snapshot reads back with its maps', () => {
  freshStorage();
  const ticket = newTicket('tg:1');
  assert.ok(ticket);
  writeStart(ticket, user, dashboard(), 1_000);

  const start = readStart('tg:1', 2_000);
  assert.ok(start);
  assert.equal(start.user.user_id, 7);
  const snapshot = startSnapshot();
  assert.ok(snapshot);
  assert.equal(snapshot.savedAt, 1_000);
  assert.equal(snapshot.dashboard.creditNetInBase, -1500);
  assert.ok(snapshot.dashboard.cryptoLivePrices instanceof Map);
  assert.deepEqual(snapshot.dashboard.cryptoLivePrices.get(42), { crypto_asset_id: 42, price: 2.5 });
  assert.equal(snapshot.dashboard.moexPrices.get('SBER')?.price, 300);
  assert.ok(snapshot.dashboard.tinkoffLivePrices.has(11));
});

test('another identity, an old record or one from the future is not read', () => {
  freshStorage();
  writeStart(newTicket('tg:1')!, user, dashboard(), 1_000);

  assert.equal(readStart('tg:2', 2_000), null);
  assert.equal(readStart('session', 2_000), null);
  assert.equal(readStart(null, 2_000), null);
  assert.equal(readStart('tg:1', 1_000 + CACHE_TTL_MS + 1), null);
  assert.equal(readStart('tg:1', 999), null);
  assert.ok(readStart('tg:1', 1_000 + CACHE_TTL_MS));
});

test('garbage or another version is ignored without throwing', () => {
  const storage = freshStorage();
  storage.setItem(CACHE_KEY, '{not json');
  assert.equal(readStart('tg:1', 2_000), null);

  writeStart(newTicket('tg:1')!, user, dashboard(), 1_000);
  const entry = JSON.parse(storage.getItem(CACHE_KEY)!);
  storage.setItem(CACHE_KEY, JSON.stringify({ ...entry, v: CACHE_VERSION + 1 }));
  assert.equal(readStart('tg:1', 2_000), null);

  storage.setItem(CACHE_KEY, JSON.stringify({ ...entry, user: { user_id: '7' } }));
  assert.equal(readStart('tg:1', 2_000), null);
  storage.setItem(CACHE_KEY, JSON.stringify({ ...entry, dashboard: null }));
  assert.equal(readStart('tg:1', 2_000), null);
  assert.equal(startSnapshot(), null);
});

test('a ticket taken before clear writes nothing', () => {
  const storage = freshStorage();
  writeStart(newTicket('tg:1')!, user, dashboard(), 1_000);
  assert.ok(readStart('tg:1', 2_000));
  assert.ok(startSnapshot());

  const stale = newTicket('tg:1')!;
  clearStart();
  assert.equal(storage.getItem(CACHE_KEY), null);
  assert.equal(startSnapshot(), null, 'clear drops the snapshot held in memory');

  writeStart(stale, user, dashboard(), 3_000);
  assert.equal(storage.getItem(CACHE_KEY), null);

  writeStart(newTicket('tg:1')!, user, dashboard(), 3_000);
  assert.ok(storage.getItem(CACHE_KEY));
});

test('no ticket without an identity', () => {
  freshStorage();
  assert.equal(newTicket(null), null);
});

test('a throwing localStorage breaks nothing', () => {
  const boom = () => { throw new Error('SecurityError'); };
  useStorage({ getItem: boom, setItem: boom, removeItem: boom });
  assert.doesNotThrow(() => clearStart());
  assert.equal(readStart('tg:1', 2_000), null);
  assert.doesNotThrow(() => writeStart(newTicket('tg:1')!, user, dashboard(), 1_000));

  Object.defineProperty(globalThis, 'localStorage', { get: boom, configurable: true });
  assert.doesNotThrow(() => clearStart());
  assert.equal(readStart('tg:1', 2_000), null);
});
