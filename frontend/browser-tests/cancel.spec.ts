import { randomUUID } from 'node:crypto';
import AxeBuilder from '@axe-core/playwright';
import { EMAIL, PASSWORD, expect, login, test } from './fixtures';

async function apiSession(page: import('@playwright/test').Page) {
  const api = process.env.PLAYWRIGHT_API_URL ?? '';
  const session = await page.request.post(`${api}/api/v1/auth/login`, { data: { email: EMAIL, password: PASSWORD } });
  return { api, headers: { Authorization: `Bearer ${(await session.json()).token}` } };
}

// Bank model: a gift sold for rubles by mistake is cancelled from its row in
// the ordinary operations list; the row stays, marked cancelled, the gift is back.
test('a mistaken collection sale is cancelled from the operations list', async ({ page }, testInfo) => {
  // The flow changes shared seed data: once per run is enough.
  test.skip(testInfo.project.name !== 'light', 'data flow runs in one theme');
  const { api, headers } = await apiSession(page);
  const positions = await (await page.request.get(`${api}/api/v1/portfolio/positions?status=open`, { headers })).json();
  const gift = positions.find((p: { title: string }) => p.title === 'Тестовый подарок');
  const sold = await page.request.post(`${api}/api/v1/portfolio/positions/${gift.id}/close`, {
    headers,
    data: { request_id: randomUUID(), close_amount_in_currency: 26, close_currency_code: 'RUB' },
  });
  expect(sold.ok()).toBe(true);

  await login(page);
  await page.getByRole('button', { name: 'Портфель', exact: true }).click();
  await page.getByRole('tab', { name: 'Коллекции', exact: true }).click();
  await page.getByRole('tab', { name: 'Операции' }).last().click();
  await expect(page.getByRole('button', { name: 'История операций' })).toHaveCount(0);

  const live = page.locator('button.op-row:not(.op-row--cancelled)', { hasText: '26' }).first();
  await live.click();
  const sheet = page.getByRole('dialog');
  await sheet.getByRole('button', { name: 'Отменить операцию' }).click();
  await expect(sheet.getByText('Отменить операцию? Балансы вернутся к состоянию до неё.')).toBeVisible();
  await sheet.getByRole('button', { name: 'Отменить', exact: true }).click();
  await expect(sheet).toBeHidden();

  const cancelled = page.locator('button.op-row--cancelled', { hasText: '26' }).first();
  await expect(cancelled.getByText('Отменена')).toBeVisible();
  await cancelled.click();
  await expect(page.getByRole('dialog').getByText('Отменена')).toBeVisible();
  await expect(page.getByRole('dialog').getByRole('button', { name: 'Отменить операцию' })).toHaveCount(0);

  const after = await (await page.request.get(`${api}/api/v1/portfolio/positions?status=open`, { headers })).json();
  expect(after.some((p: { id: number }) => p.id === gift.id)).toBe(true);
});

// The seed salary is partly spent: its sheet explains why it cannot be cancelled.
test('an operation that cannot be cancelled shows the reason', async ({ page }) => {
  await login(page);
  await page.getByRole('tab', { name: 'Операции', exact: true }).click();
  await page.locator('button.op-row', { hasText: 'Доход' }).first().click();
  const sheet = page.getByRole('dialog', { name: 'Доход' });
  await expect(sheet.getByText(/^Не отменить: на счёте «.+» не хватает .+ — деньги уже потрачены$/)).toBeVisible();
  await expect(sheet.getByRole('button', { name: 'Отменить операцию' })).toHaveCount(0);
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running'));
  // Row time is the seed's wall clock.
  await expect(sheet).toHaveScreenshot('cancel-reason.png', { mask: [sheet.locator('.op-sheet__sub')] });

  const { violations } = await new AxeBuilder({ page }).include('[role="dialog"]').withTags(['wcag2a', 'wcag2aa']).analyze();
  // The sheet tag uses --text-3, the known token issue of every sheet (a11y.spec.ts KNOWN).
  const found = violations.flatMap((v) => v.nodes.map((n) => `${v.id} ${n.target.join(' ')}`));
  expect(found.filter((f) => f !== 'color-contrast .sheet__tag')).toEqual([]);
});
