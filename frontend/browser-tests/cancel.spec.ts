import { randomUUID } from 'node:crypto';
import AxeBuilder from '@axe-core/playwright';
import { EMAIL, PASSWORD, expect, login, test } from './fixtures';

async function apiSession(page: import('@playwright/test').Page) {
  const api = process.env.PLAYWRIGHT_API_URL ?? '';
  const session = await page.request.post(`${api}/api/v1/auth/login`, { data: { email: EMAIL, password: PASSWORD } });
  return { api, headers: { Authorization: `Bearer ${(await session.json()).token}` } };
}

// Bank model: a gift sold for rubles by mistake is cancelled from its unfolded
// row in the operations list; the row stays, marked cancelled, the gift is back.
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

  const live = page.locator('.op-item:not(.op-item--cancelled)', { hasText: '26' }).first();
  await live.locator('button.op-row').click();
  await live.getByRole('button', { name: 'Отменить', exact: true }).click();
  await expect(live.getByText('Отменить операцию? Балансы вернутся к состоянию до неё.')).toBeVisible();
  await live.getByRole('button', { name: 'Да, отменить' }).click();

  const cancelled = page.locator('.op-item--cancelled', { hasText: '26' }).first();
  await expect(cancelled.getByText('Отменена')).toBeVisible();
  await cancelled.locator('button.op-row').click();
  await expect(cancelled.locator('.op-row__detail')).toBeVisible();
  await expect(cancelled.getByRole('button', { name: 'Отменить', exact: true })).toHaveCount(0);

  const after = await (await page.request.get(`${api}/api/v1/portfolio/positions?status=open`, { headers })).json();
  expect(after.some((p: { id: number }) => p.id === gift.id)).toBe(true);
});

// The seed salary is partly spent: pressing «Отменить» explains why it cannot be cancelled.
test('an operation that cannot be cancelled shows the reason', async ({ page }) => {
  await login(page);
  await page.getByRole('tab', { name: 'Операции', exact: true }).click();
  const income = page.locator('.op-item', { hasText: 'Доход' }).first();
  await income.locator('button.op-row').click();
  await income.getByRole('button', { name: 'Отменить', exact: true }).click();
  await expect(income.getByText(/^Не отменить: на счёте «.+» не хватает .+ — деньги уже потрачены$/)).toBeVisible();
  await expect(income.getByText('Отменить операцию?')).toHaveCount(0);
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running'));
  // The fixed bottom bar would cover the unfolded row; row time is the seed's wall clock.
  await page.addStyleTag({ content: '.bottom-nav { visibility: hidden; }' });
  await expect(income).toHaveScreenshot('cancel-reason.png', { mask: [income.locator('.op-row__sub')] });

  const { violations } = await new AxeBuilder({ page }).include('.op-item').withTags(['wcag2a', 'wcag2aa']).analyze();
  // Row subtitles (--text-3) and green amounts (--pos) are the known token
  // contrast issue of every operations row (a11y.spec.ts KNOWN, design guide task).
  const found = violations.flatMap((v) => v.nodes.map((n) => `${v.id} ${n.target.join(' ')}`));
  expect(found.filter((f) => !/^color-contrast .*(op-row__sub|op-row__amt--pos)/.test(f))).toEqual([]);
});
