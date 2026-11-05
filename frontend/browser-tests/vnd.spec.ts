import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { apiSession, expect, openOverview, test } from './fixtures';

// The dong has no minor units and Vietnamese receipts group thousands with a
// dot: "2.435.060" is 2 435 060 dong, never 2,43 of anything.

async function openDongExchange(page: Page) {
  await page.getByRole('button', { name: 'Обмен', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: 'На личном счёте' });
  await sheet.locator('.fx__cur').nth(1).click();
  await sheet.getByRole('button', { name: /^VND/ }).click();
  await sheet.getByLabel('Сумма отдаёте').fill('8000');
  await sheet.getByLabel('Сумма получите').fill('2.435.060');
  return sheet;
}

// Needs no data: the sheet lists every currency of the reference table.
test('exchange sheet reads a dong amount with thousands dots', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-01-20T12:00:00+03:00'));
  await openOverview(page);
  const sheet = await openDongExchange(page);
  await expect(sheet.getByText('Курс: 1 RUB = 304,3825 VND')).toBeVisible();
  await expect(sheet.getByText(/Курс ЦБ на 20\.01\.2026: 1 RUB = 318,2453 VND\./)).toBeVisible();
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running'));
  await expect(sheet).toHaveScreenshot('vnd-exchange.png');

  const { violations } = await new AxeBuilder({ page }).include('.fx__side').withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(violations.flatMap((v) => v.nodes.map((n) => `${v.id} ${n.target.join(' ')}`))).toEqual([]);
});

test('dong exchange and expense keep whole amounts and are cancelled back', async ({ page }, testInfo) => {
  // The flow changes shared seed data: once per run is enough. Its cancelled
  // rows top the history, so it runs in the last project, after every
  // screenshot of the operations list (cancel.spec.ts in dark shifted).
  test.skip(testInfo.project.name !== 'dark', 'data flow runs in one theme');
  const { api, headers } = await apiSession(page);

  // currencies.scale and the ISO digits Intl uses for display agree.
  const currencies: { code: string; scale: number }[] = await (await page.request.get(`${api}/api/v1/currencies`, { headers })).json();
  expect(currencies.some((c) => c.code === 'VND' && c.scale === 0)).toBe(true);
  await openOverview(page);
  const intlDigits = await page.evaluate((codes) => codes.map((code) =>
    new Intl.NumberFormat('ru-RU', { style: 'currency', currency: code }).resolvedOptions().maximumFractionDigits,
  ), currencies.map((c) => c.code));
  expect(intlDigits).toEqual(currencies.map((c) => c.scale));

  const exchange = await openDongExchange(page);
  await exchange.getByRole('button', { name: 'Обменять' }).click();
  await expect(exchange).toBeHidden();

  await page.getByRole('button', { name: /^Продукты/ }).click();
  const sheet = page.getByRole('dialog', { name: 'Продукты' });
  await sheet.getByText('Потратить', { exact: true }).click();
  const amount = sheet.getByPlaceholder('0');
  await sheet.getByRole('button', { name: 'RUB', exact: true }).click();
  await sheet.getByRole('button', { name: 'VND', exact: true }).click();
  await expect(sheet.getByText(/^Доступно: 2\s435\s060 VND$/)).toBeVisible();

  // Leaving the field fixes the dong entry, so an account without dong
  // switches to rubles with 1217530 in the field, not 1.217.
  await amount.fill('1.217.530');
  await amount.press('Tab');
  await sheet.getByRole('combobox').selectOption({ label: 'Тестовая кредитка · Кредитная карта' });
  await expect(sheet.getByRole('button', { name: 'RUB', exact: true })).toBeVisible();
  await expect(amount).toHaveValue('1217530');
  await sheet.getByRole('combobox').selectOption({ label: 'Main' });
  await sheet.getByRole('button', { name: 'RUB', exact: true }).click();
  await sheet.getByRole('button', { name: 'VND', exact: true }).click();

  await amount.fill('12.5');
  await sheet.getByRole('button', { name: 'Списать' }).click();
  await expect(sheet.getByText('Сумма в VND — без дробной части, например 45000')).toBeVisible();
  await amount.fill('1.217.530');
  await sheet.getByRole('button', { name: 'Списать' }).click();
  await expect(sheet).toBeHidden();

  // Balances sort dong above rubles; a new schedule still starts in rubles.
  await page.getByRole('button', { name: /^Продукты/ }).click();
  await sheet.getByText('Настройки', { exact: true }).click();
  await sheet.getByRole('button', { name: '+ Добавить расписание' }).click();
  await expect(sheet.locator('.amt').getByRole('button', { name: 'RUB', exact: true })).toBeVisible();
  await sheet.getByRole('button', { name: 'Закрыть' }).click();

  await page.getByRole('tab', { name: 'Операции', exact: true }).click();
  await expect(page.locator('.op-row', { hasText: 'Продукты' }).first()).toContainText(/−1\s217\s530 ₫/);

  // Cancel in reverse order: the expense spent dong the exchange brought.
  const history = await (await page.request.get(`${api}/api/v1/operations/history?limit=5`, { headers })).json();
  const latest = (type: string) => history.items.find((item: { type: string }) => item.type === type).operation_id;
  for (const operationId of [latest('expense'), latest('exchange')]) {
    const cancelled = await page.request.post(`${api}/api/v1/operations/reverse`, { headers, data: { operation_id: operationId } });
    expect(cancelled.ok()).toBe(true);
  }
  const context = await (await page.request.get(`${api}/api/v1/auth/context`, { headers })).json();
  const balances = await (await page.request.get(`${api}/api/v1/bank-accounts/${context.bank_account_id}/snapshot`, { headers })).json();
  expect(balances.some((b: { currency_code: string }) => b.currency_code === 'VND')).toBe(false);
});
