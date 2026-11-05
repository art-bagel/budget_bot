import { expect, test } from './fixtures';
import { action, assetTab, expectCash, field, group, hideBottomNav, openPortfolio, portfolioApi, positionSheet, settled, unique } from './portfolio';

// A collection account: the shelf and the life of one bought item.
// Data: seed_portfolio() in scripts/seed_ui_test.py.

const ACCOUNT = 'Тестовая коллекция';

test('collection shelf matches the reference', async ({ page }) => {
  await openPortfolio(page);
  await assetTab(page, 'Коллекции').click();
  const shelf = group(page, ACCOUNT);
  await expect(shelf.getByRole('button', { name: /^Тестовая открытка, 3\s000\s₽$/ })).toBeVisible();
  await expect(shelf).toContainText('Денежный остаток');
  await settled(page);
  await hideBottomNav(page);
  await expect(shelf).toHaveScreenshot('collection-shelf.png');
});

test('a bought item takes a top-up and is sold @flow', async ({ page }, testInfo) => {
  // Real clock: a bought item opens on the API's today, whatever its purchase
  // date, and a top-up dated before that is refused (see the task report).
  await openPortfolio(page, { fixedClock: false });
  const api = await portfolioApi(page);
  const title = unique('Сценарная марка', testInfo);

  let cash = await api.cash(ACCOUNT);
  await assetTab(page, 'Коллекции').click();
  await page.getByRole('button', { name: '+ Новая', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: /^Новая позиция · / });
  // A Telegram gift is the default kind; its title comes from collection and number.
  await dialog.locator('.apf-field', { hasText: 'Вид предмета' }).getByRole('button').first().click();
  await dialog.getByRole('button', { name: 'Другое', exact: true }).click();
  await field(dialog, 'Название').fill(title);
  await field(dialog, 'Цена покупки').fill('2000');
  await dialog.getByRole('button', { name: 'Добавить предмет', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expectCash(api, ACCOUNT, cash, -2000);

  await page.getByRole('button', { name: new RegExp(`^${title},`) }).click();
  const sheet = positionSheet(page, title);
  cash = await api.cash(ACCOUNT);
  await action(sheet, 'Вложить').click();
  await field(sheet, 'Сумма в стоимость предмета').fill('500');
  await sheet.getByRole('button', { name: 'Подтвердить пополнение', exact: true }).click();
  await expectCash(api, ACCOUNT, cash, -500);
  await expect.poll(async () => (await api.position(title, ACCOUNT))?.amount_in_currency).toBe(2500);

  cash = await api.cash(ACCOUNT);
  await sheet.getByRole('button', { name: 'Продать', exact: true }).click();
  await expect(field(sheet, 'Валюта')).toHaveValue('RUB');
  await field(sheet, 'Сумма продажи').fill('5000');
  await sheet.getByRole('button', { name: 'Подтвердить закрытие', exact: true }).click();
  await expectCash(api, ACCOUNT, cash, 5000);
  await expect.poll(async () => (await api.position(title, ACCOUNT))?.status).toBe('closed');
});
