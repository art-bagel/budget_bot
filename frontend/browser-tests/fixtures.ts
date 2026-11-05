import { test as base, expect } from '@playwright/test';
import type { Page } from '@playwright/test';

// Synthetic users from scripts/seed_ui_test.py.
export const EMAIL = 'ui-test@example.com';
export const PASSWORD = 'ui-test-password-0000';
export type SeedUser = { email: string; password: string };
const MAIN_USER: SeedUser = { email: EMAIL, password: PASSWORD };
// Every portfolio asset type, apart from the main user's overview numbers.
export const PORTFOLIO_USER: SeedUser = { email: 'ui-portfolio@example.com', password: 'ui-portfolio-password-0000' };

export async function login(page: Page, user: SeedUser = MAIN_USER) {
  await page.goto('/');
  await page.getByLabel('Email', { exact: true }).fill(user.email);
  await page.getByLabel('Пароль', { exact: true }).fill(user.password);
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  // The first test of a run hits a freshly started API (cold DB pools).
  await expect(page.getByRole('button', { name: 'Портфель', exact: true })).toBeVisible({ timeout: 15_000 });
}

// Direct API access as a seed user, for setup and for checking what the UI wrote.
export async function apiSession(page: Page, user: SeedUser = MAIN_USER) {
  const api = process.env.PLAYWRIGHT_API_URL ?? '';
  const session = await page.request.post(`${api}/api/v1/auth/login`, { data: user });
  return { api, headers: { Authorization: `Bearer ${(await session.json()).token}` } };
}

// Overview loaded and entrance animations finished (they fade colors in).
export async function openOverview(page: Page) {
  await login(page);
  await expect(page.locator('.splash')).toBeHidden();
  await expect(page.getByRole('button', { name: /^Продукты/ })).toBeVisible();
  await page.waitForFunction(() =>
    document
      .getAnimations()
      .every((a) => a.playState !== 'running' || a.effect?.getComputedTiming().iterations === Number.POSITIVE_INFINITY),
  );
}

// A test that provokes an error on purpose (an HTTP 502 the UI must show)
// takes exactly those messages out before the fixture checks the rest.
export function allowConsoleErrors(errors: string[], pattern: RegExp) {
  const rest = errors.filter((message) => !pattern.test(message));
  errors.splice(0, errors.length, ...rest);
}

// Fails any test that logs a console error or throws in the page.
export const test = base.extend<{ consoleErrors: string[] }>({
  consoleErrors: [
    async ({ page }, use) => {
      // API calls go straight to uvicorn instead of through the `vite preview`
      // proxy: from the docker runner on macOS that proxy hop intermittently
      // stalls requests (see docs/2026-10-15-playwright.md). In prod nginx
      // plays the proxy role, so nothing shipped is bypassed.
      const api = process.env.PLAYWRIGHT_API_URL;
      if (api) {
        await page.route('**/api/**', async (route) => {
          const url = new URL(route.request().url());
          try {
            await route.fulfill({ response: await route.fetch({ url: api + url.pathname + url.search }) });
          } catch (error) {
            // A background request (prices, groups) still in flight when the
            // test ends: its page is gone, nobody waits for the answer.
            if (page.isClosed() || /disposed|closed/i.test(String(error))) return;
            throw error;
          }
        });
      }
      // The test API is offline (scripts/browser-tests.sh): CBR rates come
      // from here, fixed and fictional, instead of a 503.
      await page.route('**/api/v1/currencies/rates', (route) =>
        route.fulfill({
          json: {
            source: 'cbr',
            rate_date: '2026-01-20',
            fetched_at: '2026-01-20T09:00:00+00:00',
            rub_per_unit: { RUB: 1, USD: 90, EUR: 100, VND: 0.00314223 },
          },
        }),
      );
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      page.on('console', (message) => {
        if (message.type() === 'error') errors.push(message.text());
      });
      await use(errors);
      expect(errors).toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
