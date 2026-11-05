import type { Page, Route } from '@playwright/test';
import { allowConsoleErrors, expect, login, openOverview, test } from './fixtures';

// Start from the cached overview (docs/2026-11-05-instant-start.md). Numbers
// in the comments are the plan's acceptance criteria.

const KEY = 'budget_start_cache';
const CONTEXT = '**/api/v1/auth/context';
const OVERVIEW = '**/api/v1/dashboard/overview?*';
const groceries = (page: Page) => page.getByRole('button', { name: /^Продукты/ });

type Entry = {
  savedAt: number;
  user: { user_id: number };
  dashboard: {
    overview: { budget_categories: { name: string; balance: number }[] };
    cryptoLivePrices: [number, { price: number }][];
  };
};

async function cacheEntry(page: Page): Promise<Entry | null> {
  const raw = await page.evaluate((key) => localStorage.getItem(key), KEY);
  return raw ? JSON.parse(raw) : null;
}

async function cachedOverview(page: Page) {
  await openOverview(page);
  await expect.poll(() => cacheEntry(page)).not.toBeNull();
  return (await cacheEntry(page)) as Entry;
}

// Real API answer, as the fixture route would give it (see fixtures.ts).
async function fetchApi(route: Route) {
  const api = process.env.PLAYWRIGHT_API_URL;
  const url = new URL(route.request().url());
  return route.fetch(api ? { url: api + url.pathname + url.search } : undefined);
}

// Holds the first request on `pattern` until release(); `edit` may change its JSON.
function hold(page: Page, pattern: string, edit?: (json: unknown) => unknown) {
  let release = () => {};
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let answered = () => {};
  const done = new Promise<void>((resolve) => { answered = resolve; });
  let first = true;
  void page.route(pattern, async (route) => {
    if (!first) return route.fallback();
    first = false;
    await gate;
    if (edit) {
      const response = await fetchApi(route);
      await route.fulfill({ response, json: edit(await response.json()) });
    } else {
      await route.fallback();
    }
    answered();
  });
  return { release, done };
}

function setGroceries(balance: number) {
  return (json: unknown) => {
    const overview = json as Entry['dashboard']['overview'];
    for (const category of overview.budget_categories) {
      if (category.name === 'Продукты') category.balance = balance;
    }
    return overview;
  };
}

test('first start shows the overview without an artificial pause (1)', async ({ page }) => {
  // Timers never fire on their own: a minimum splash time would never end.
  await page.clock.install();
  await page.clock.pauseAt(new Date(Date.now() + 60_000));
  await login(page);
  await expect(groceries(page)).toBeVisible();
});

test('a second start shows the cached overview, then the fresh one (2, 3)', async ({ page }) => {
  await cachedOverview(page);
  const context = hold(page, CONTEXT);
  const overview = hold(page, OVERVIEW, setGroceries(12345));

  await page.reload();
  await expect(groceries(page)).toBeVisible();
  await expect(page.locator('.refresh-bar')).toBeVisible();
  await expect(page.locator('.splash')).toHaveCount(0);

  context.release();
  overview.release();
  await expect(groceries(page)).toContainText(/12\s345/);
  await expect(page.locator('.refresh-bar')).toHaveCount(0);
  await expect.poll(async () =>
    (await cacheEntry(page))?.dashboard.overview.budget_categories.find((c) => c.name === 'Продукты')?.balance,
  ).toBe(12345);
});

test('signing out wipes the cache (5)', async ({ page }) => {
  await cachedOverview(page);
  await page.getByRole('button', { name: 'Настройки', exact: true }).click();
  await page.getByRole('tab', { name: 'Аккаунт' }).click();
  await page.getByRole('button', { name: 'Выйти из аккаунта' }).click();
  await expect(page.getByLabel('Email', { exact: true })).toBeVisible();
  expect(await cacheEntry(page)).toBeNull();
});

test('deleting the account wipes the cache before the reload (5)', async ({ page }) => {
  await cachedOverview(page);
  // Fake answers: the seed account itself stays.
  await page.route('**/api/v1/auth/account/delete-request', (route) =>
    route.fulfill({ json: { confirm_token: 'fake-confirm', expires_in_seconds: 60 } }));
  await page.route('**/api/v1/auth/account?*', (route) =>
    route.request().method() === 'DELETE'
      ? route.fulfill({ json: { status: 'deleted', user_id: 0 } })
      : route.fallback());
  page.on('dialog', (dialog) => void dialog.accept());
  const context = hold(page, CONTEXT);

  await page.getByRole('button', { name: 'Настройки', exact: true }).click();
  await page.getByRole('tab', { name: 'Аккаунт' }).click();
  await page.getByRole('button', { name: 'Удалить аккаунт' }).click();
  await expect(page.locator('.splash')).toBeVisible();
  await expect(groceries(page)).toHaveCount(0);
  expect(await cacheEntry(page)).toBeNull();
  context.release();
});

test('a refused context drops the snapshot, an outage keeps it (6)', async ({ page, consoleErrors }) => {
  await cachedOverview(page);
  await page.route(CONTEXT, (route) => route.fulfill({ status: 503, json: { detail: 'unavailable' } }));
  await page.reload();
  await expect(groceries(page)).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('Не удалось обновить');

  const before = (await cacheEntry(page))?.savedAt ?? 0;
  await page.unroute(CONTEXT);
  await page.getByRole('button', { name: 'Повторить' }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect.poll(async () => (await cacheEntry(page))?.savedAt ?? 0).toBeGreaterThan(before);

  await page.route(CONTEXT, (route) => route.fulfill({ status: 401, json: { detail: 'Unauthorized' } }));
  await page.reload();
  await expect(page.getByLabel('Email', { exact: true })).toBeVisible();
  await expect(groceries(page)).toHaveCount(0);
  expect(await cacheEntry(page)).toBeNull();
  allowConsoleErrors(consoleErrors, /status of (503|401)/);
});

test('another user behind the login never sees the snapshot (7)', async ({ page }) => {
  await cachedOverview(page);
  await page.route(CONTEXT, async (route) => {
    const response = await fetchApi(route);
    const json = await response.json();
    await route.fulfill({ response, json: { ...json, user_id: json.user_id + 1000 } });
  });
  const overview = hold(page, OVERVIEW);

  await page.reload();
  await expect(page.locator('.splash')).toBeVisible();
  await expect(groceries(page)).toHaveCount(0);
  await expect.poll(() => cacheEntry(page)).toBeNull();
  overview.release();
  await expect(groceries(page)).toBeVisible();
});

test('a late answer of an earlier load does not overwrite a later one (9)', async ({ page }) => {
  await cachedOverview(page);
  const real = (await groceries(page).textContent()) ?? '';
  const first = hold(page, OVERVIEW, setGroceries(11111));

  await page.reload();
  await expect(groceries(page)).toBeVisible();
  // Tapping the current tab loads the overview again; this one goes through.
  await page.getByRole('button', { name: 'Обзор', exact: true }).click();
  await expect(page.locator('.refresh-bar')).toHaveCount(0);

  first.release();
  await first.done;
  await page.waitForTimeout(500);
  await expect(groceries(page)).toHaveText(real);
  expect((await cacheEntry(page))?.dashboard.overview.budget_categories.find((c) => c.name === 'Продукты')?.balance)
    .not.toBe(11111);
});

test('a start asks for prices once and keeps them on an error (10)', async ({ page, consoleErrors }) => {
  // The offline test API has no price for the seed coin: give it a fictional one.
  await page.route('**/api/v1/crypto/prices?*', (route) => {
    const ids = new URL(route.request().url()).searchParams.get('asset_ids')?.split(',') ?? [];
    return route.fulfill({
      json: ids.map((id) => ({
        crypto_asset_id: Number(id), symbol: 'TSTC', vs_currency: 'RUB', price: 3000,
        source: 'test', fetched_at: '2026-01-20T09:00:00+00:00',
      })),
    });
  });
  const entry = await cachedOverview(page);
  await expect.poll(async () => (await cacheEntry(page))?.dashboard.cryptoLivePrices.length).toBeGreaterThan(0);
  expect(entry.user.user_id).toBeGreaterThan(0);
  const investments = page.locator('.hero__row', { hasText: 'Инвестиции' }).locator('.hero__row-amount');
  const withPrice = (await investments.textContent()) ?? '';

  const calls = { crypto: 0, tinkoff: 0 };
  await page.unroute('**/api/v1/crypto/prices?*');
  await page.route('**/api/v1/crypto/prices?*', (route) => {
    calls.crypto += 1;
    return route.fulfill({ status: 502, json: { detail: 'down' } });
  });
  await page.route('**/api/v1/tinkoff/live-prices', (route) => {
    calls.tinkoff += 1;
    return route.fallback();
  });

  await page.reload();
  await expect(investments).toHaveText(withPrice);
  await expect.poll(() => calls.crypto).toBe(1);
  await expect(page.locator('.refresh-bar')).toHaveCount(0);
  await page.waitForTimeout(500);
  expect(calls).toEqual({ crypto: 1, tinkoff: 1 });
  await expect(investments).toHaveText(withPrice);
  allowConsoleErrors(consoleErrors, /status of 502/);
});

test('a snapshot that breaks the render is wiped (11)', async ({ page, consoleErrors }) => {
  await cachedOverview(page);
  await page.evaluate((key) => {
    const entry = JSON.parse(localStorage.getItem(key) as string);
    entry.dashboard.overview.budget_categories = null;
    localStorage.setItem(key, JSON.stringify(entry));
  }, KEY);

  await page.reload();
  await expect(page.getByText('Что-то пошло не так')).toBeVisible();
  expect(await cacheEntry(page)).toBeNull();
  await page.getByRole('button', { name: 'Попробовать снова' }).click();
  await expect(groceries(page)).toBeVisible();
  allowConsoleErrors(consoleErrors, /ErrorBoundary caught|budget_categories|null|undefined/);
});

test('a failed refresh keeps the data under a note, a refused one hides it (12)', async ({ page, consoleErrors }) => {
  // Fixed clock: the note shows when the data was loaded.
  await page.clock.setFixedTime(new Date('2026-01-20T10:00:00+03:00'));
  await cachedOverview(page);
  await page.route(OVERVIEW, (route) => route.fulfill({ status: 502, json: { detail: 'Bad gateway' } }));

  await page.reload();
  const note = page.getByRole('alert');
  await expect(note).toHaveText(/Не удалось обновить\. Данные от 20 янв\., 10:00/);
  await expect(groceries(page)).toBeVisible();
  await expect(note).toHaveScreenshot('stale-note.png');

  await page.unroute(OVERVIEW);
  await page.getByRole('button', { name: 'Повторить' }).click();
  await expect(note).toHaveCount(0);

  await page.route(OVERVIEW, (route) => route.fulfill({ status: 401, json: { detail: 'Unauthorized' } }));
  await page.getByRole('button', { name: 'Обзор', exact: true }).click();
  await expect(page.getByText('Не удалось загрузить обзор')).toBeVisible();
  await expect(groceries(page)).toHaveCount(0);
  expect(await cacheEntry(page)).toBeNull();
  allowConsoleErrors(consoleErrors, /status of (502|401)/);
});
