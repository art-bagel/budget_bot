import { expect, test } from './fixtures';
import { assetTab, group, hideBottomNav, newViolations, openPortfolio, portfolioApi, settled, unique } from './portfolio';

// The portfolio screen as a whole: tabs, account groups, the hero, new
// accounts, the operations and analytics views. Data: seed_portfolio() in
// scripts/seed_ui_test.py.

const TABS = ['Все', 'Ценные бумаги', 'Депозит', 'Криптовалюта', 'Разное', 'Коллекции'];

test('portfolio shows every asset type of the seed', async ({ page }) => {
  const moex = await openPortfolio(page);
  await expect(page.getByRole('tablist').first().getByRole('tab')).toHaveText(TABS);

  // Group total = positions + rubles left on the account.
  const totals: [string, RegExp][] = [
    ['Тестовый брокер', /^101\s500₽$/],
    ['Тестовый вклад', /^60\s000₽$/],
    ['Тестовый краудлендинг', /^30\s000₽$/],
    ['Тестовый кошелёк', /^0₽$/],
    ['Тестовая коллекция', /^7\s000₽$/],
  ];
  for (const [account, total] of totals) await expect(group(page, account).locator('.pf-grp__total')).toHaveText(total);
  await expect(group(page, 'Тестовый брокер').locator('.pf-pos')).toHaveText([/^Т?Тестовая облигация/, /^Т?Тестовый фонд/]);
  await expect(group(page, 'Тестовый кошелёк')).toContainText('10 TSTP');
  await expect(group(page, 'Тестовый кошелёк')).toContainText('нет курса');

  // Each tab keeps only its own accounts.
  await assetTab(page, 'Депозит').click();
  await expect(page.locator('.pf-grp__title')).toHaveText(['Тестовый вклад']);
  await assetTab(page, 'Все').click();

  await settled(page);
  // Deposit interest is accrued by the API up to its own today, which a
  // browser clock cannot pin.
  await hideBottomNav(page);
  await expect(page.locator('.pf-view')).toHaveScreenshot('portfolio-all.png', { mask: [page.locator('.pf-pos__pnl')] });
  expect(moex).toEqual([]);
});

test('a hero row opens the accounts of its asset type', async ({ page }) => {
  await openPortfolio(page);
  await page.locator('.pf-hero__row', { hasText: 'Ценные бумаги' }).click();
  const sheet = page.getByRole('dialog', { name: 'Ценные бумаги' });
  await expect(sheet).toBeVisible();
  await expect(sheet).toContainText('Тестовый брокер');
  await expect(sheet).not.toContainText('Тестовый вклад');
});

test('portfolio screen has no new WCAG violations', async ({ page }) => {
  await openPortfolio(page);
  await settled(page);
  expect(await newViolations(page, 'main')).toEqual([]);
});

test('operations and analytics views of the portfolio', async ({ page }) => {
  await openPortfolio(page);
  await page.getByRole('tab', { name: 'Операции', exact: true }).last().click();
  // The seed fund dividend is the newest portfolio operation.
  await expect(page.locator('.op-row').first()).toBeVisible();
  await expect(page.locator('.op-row', { hasText: '1 500' }).first()).toBeVisible();

  await page.getByRole('tab', { name: 'Аналитика', exact: true }).click();
  await expect(page.locator('.pf-view')).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('a new investment account is listed under its asset type @flow', async ({ page }, testInfo) => {
  await openPortfolio(page);
  const api = await portfolioApi(page);
  const name = unique('Сценарный брокер', testInfo);

  await page.getByRole('button', { name: 'Новый инвестиционный счёт' }).click();
  const sheet = page.getByRole('dialog', { name: 'Новый инвестиционный счёт' });
  await sheet.locator('.add-pos-type-tile', { hasText: 'Ценные бумаги' }).click();
  const form = page.getByRole('dialog', { name: 'Новый счёт · Ценные бумаги' });
  await form.locator('.apf-field', { hasText: 'Название счёта' }).locator('input').fill(name);
  await form.getByRole('button', { name: 'Создать счёт', exact: true }).click();
  await expect(form).toBeHidden();

  expect(await api.accountId(name)).toBeGreaterThan(0);
  // An account without positions has no group yet; the hero sheet of its type lists it.
  await page.locator('.pf-hero__row', { hasText: 'Ценные бумаги' }).click();
  await expect(page.getByRole('dialog', { name: 'Ценные бумаги' })).toContainText(name);
});
