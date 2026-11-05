import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { action, assetTab, expectCash, field, newViolations, openPortfolio, portfolioApi, positionSheet, settled, unique } from './portfolio';

// Money actions of an ordinary position (securities, deposit, «Разное»). Each
// step goes through the UI; the API then shows the account's rubles moved by
// exactly that step. Data: seed_portfolio() in scripts/seed_ui_test.py.

async function addPosition(page: Page, tab: string, fill: Record<string, string>, { kind, button = 'Добавить позицию' }: { kind?: string; button?: string } = {}) {
  await assetTab(page, tab).click();
  await page.getByRole('button', { name: '+ Новая', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: /^Новая позиция · / });
  if (kind) await dialog.getByRole('button', { name: kind, exact: true }).click();
  for (const [label, value] of Object.entries(fill)) await field(dialog, label).fill(value);
  await dialog.getByRole('button', { name: button, exact: true }).click();
  await expect(dialog).toBeHidden();
}

async function openPosition(page: Page, title: string) {
  await page.locator('.pf-pos', { hasText: title }).first().click();
  const sheet = positionSheet(page, title);
  await expect(sheet).toBeVisible();
  return sheet;
}

async function submit(sheet: import('@playwright/test').Locator, tile: string, fill: Record<string, string>, button: string) {
  await action(sheet, tile).click();
  for (const [label, value] of Object.entries(fill)) await field(sheet, label).fill(value);
  await sheet.getByRole('button', { name: button, exact: true }).click();
  await expect(sheet.getByRole('button', { name: button, exact: true })).toBeHidden();
}

test('security position sheet matches the reference', async ({ page }) => {
  await openPortfolio(page);
  await assetTab(page, 'Ценные бумаги').click();
  const sheet = await openPosition(page, 'Тестовая облигация');
  await expect(sheet.locator('.pf-dstats__cell', { hasText: 'Вложено' })).toContainText(/40\s000/);
  for (const tile of ['Пополнить', 'Доход', 'Снять', 'Комиссия']) await expect(action(sheet, tile)).toBeVisible();
  await expect(sheet.getByRole('button', { name: 'Закрыть позицию', exact: true })).toBeVisible();
  await settled(page);
  await expect(sheet).toHaveScreenshot('security-position-sheet.png');

  expect(await newViolations(page, '[role="dialog"]')).toEqual([]);
});

test.describe('money flows @flow', () => {
  test('a security position goes from open to closed', async ({ page }, testInfo) => {
    await openPortfolio(page);
    const api = await portfolioApi(page);
    const broker = 'Тестовый брокер';
    const title = unique('Сценарная акция', testInfo);

    let cash = await api.cash(broker);
    await addPosition(page, 'Ценные бумаги', { Название: title, 'Сумма входа': '10000', Количество: '10' });
    await expectCash(api, broker, cash, -10000);
    expect((await api.position(title))?.amount_in_currency).toBe(10000);

    const sheet = await openPosition(page, title);
    cash = await api.cash(broker);
    await submit(sheet, 'Пополнить', { 'Сумма пополнения': '2000' }, 'Подтвердить пополнение');
    await expectCash(api, broker, cash, -2000);
    await expect.poll(async () => (await api.position(title))?.amount_in_currency).toBe(12000);

    cash = await api.cash(broker);
    await submit(sheet, 'Доход', { 'Сумма дивидендов': '500' }, 'Подтвердить доход');
    await expectCash(api, broker, cash, 500);

    // A dividend cancelled from the position history takes its money back.
    page.once('dialog', (dialog) => void dialog.accept());
    await sheet.getByRole('button', { name: 'Отменить доход', exact: true }).first().click();
    await expectCash(api, broker, cash, 0);

    cash = await api.cash(broker);
    await submit(sheet, 'Комиссия', { 'Сумма комиссии': '100' }, 'Подтвердить комиссию');
    await expectCash(api, broker, cash, -100);

    cash = await api.cash(broker);
    await submit(sheet, 'Снять', { 'Сумма возврата': '4000', 'Списать principal': '4000', 'Списать количество': '4' }, 'Подтвердить частичное закрытие');
    await expectCash(api, broker, cash, 4000);
    await expect.poll(async () => (await api.position(title))?.amount_in_currency).toBe(8000);

    cash = await api.cash(broker);
    await sheet.getByRole('button', { name: 'Закрыть позицию', exact: true }).click();
    await field(sheet, 'Сумма выхода').fill('9000');
    await sheet.getByRole('button', { name: 'Подтвердить закрытие', exact: true }).click();
    await expectCash(api, broker, cash, 9000);
    await expect.poll(async () => (await api.position(title))?.status).toBe('closed');

    await page.keyboard.press('Escape');
    await expect(page.locator('.pf-pos', { hasText: title })).toHaveCount(0);
    await page.getByRole('button', { name: /^Закрытые \(\d+\)$/ }).click();
    await expect(page.locator('.pf-pos', { hasText: title })).toBeVisible();
  });

  test('a savings deposit changes its rate and takes a top-up', async ({ page }, testInfo) => {
    await openPortfolio(page);
    const api = await portfolioApi(page);
    const account = 'Тестовый вклад';
    const title = unique('Сценарный вклад', testInfo);

    let cash = await api.cash(account);
    await addPosition(page, 'Депозит', { Название: title, Сумма: '2000', 'Ставка, % годовых': '10' },
      { kind: 'Накопительный счёт', button: 'Открыть вклад' });
    await expectCash(api, account, cash, -2000);
    expect((await api.position(title))?.metadata.interest_rate).toBe(10);

    const sheet = await openPosition(page, title);
    await action(sheet, 'Ставка').click();
    await field(sheet, 'Новая ставка, % годовых').fill('12');
    await sheet.getByRole('button', { name: 'Изменить ставку', exact: true }).click();
    await expect.poll(async () => (await api.position(title))?.metadata.interest_rate).toBe(12);
    await expect(sheet.locator('.pf-dcond__row', { hasText: 'Ставка' })).toContainText('12% годовых');

    cash = await api.cash(account);
    await submit(sheet, 'Пополнить', { 'Сумма пополнения': '500' }, 'Подтвердить пополнение');
    await expectCash(api, account, cash, -500);
    await expect.poll(async () => (await api.position(title))?.amount_in_currency).toBe(2500);
  });

  test('an other-asset position closes with a profit', async ({ page }, testInfo) => {
    await openPortfolio(page);
    const api = await portfolioApi(page);
    const account = 'Тестовый краудлендинг';
    const title = unique('Сценарный займ', testInfo);

    let cash = await api.cash(account);
    await addPosition(page, 'Разное', { Название: title, 'Сумма входа': '5000' });
    await expectCash(api, account, cash, -5000);

    const sheet = await openPosition(page, title);
    cash = await api.cash(account);
    await sheet.getByRole('button', { name: 'Закрыть позицию', exact: true }).click();
    await field(sheet, 'Сумма выхода').fill('6500');
    await sheet.getByRole('button', { name: 'Подтвердить закрытие', exact: true }).click();
    await expectCash(api, account, cash, 6500);
    await expect.poll(async () => (await api.position(title))?.status).toBe('closed');

    // The profit lands in the period's deals of «Разное». Only this flow
    // closes positions there, once per repeat on a fresh seed.
    await page.keyboard.press('Escape');
    // The scenario's own operations are listed in the portfolio operations.
    await page.getByRole('tab', { name: 'Операции', exact: true }).last().click();
    await expect(page.locator('.op-row', { hasText: title }).first()).toBeVisible();
    await page.getByRole('tab', { name: 'Аналитика', exact: true }).click();
    await expect(page.getByText('Собираем аналитику…')).toHaveCount(0);
    const deals = new Intl.NumberFormat('ru-RU').format(1500 * (testInfo.repeatEachIndex + 1)).replace(/\s/g, '\\s');
    await expect(page.locator('.pf-view')).toContainText(new RegExp(`Сделки \\+${deals}\\s₽`));
  });
});
