import { test as base, expect } from '@playwright/test';
import type { Page } from '@playwright/test';

// Synthetic user from scripts/seed_ui_test.py.
export const EMAIL = 'ui-test@example.com';
export const PASSWORD = 'ui-test-password-0000';

export async function login(page: Page) {
  await page.goto('/');
  await page.getByLabel('Email', { exact: true }).fill(EMAIL);
  await page.getByLabel('Пароль', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  // The first test of a run hits a freshly started API (cold DB pools).
  await expect(page.getByRole('button', { name: 'Портфель', exact: true })).toBeVisible({ timeout: 15_000 });
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
          await route.fulfill({ response: await route.fetch({ url: api + url.pathname + url.search }) });
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
            rub_per_unit: { RUB: 1, USD: 90, EUR: 100 },
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
