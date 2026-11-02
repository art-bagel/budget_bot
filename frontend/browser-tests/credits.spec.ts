import AxeBuilder from '@axe-core/playwright';
import { expect, openOverview, test } from './fixtures';

// The seed overpays «Тестовая кредитка» by 1 500 ₽ (limit 50 000 ₽).
test('an overpaid credit card shows the overpayment', async ({ page }) => {
  await openOverview(page);
  await page.getByRole('button', { name: 'Кредиты', exact: true }).click();
  const tile = page.locator('.tile--card', { hasText: 'Тестовая кредитка' });
  await expect(tile.locator('.tile__debt')).toHaveText(/^\+1\s500\s₽$/);
  await expect(tile.locator('.tile__debt-label')).toHaveText('переплата');
  await expect(tile.locator('.tile__util-text').first()).toHaveText(/^Использовано 0\s₽ из 50\s000\s₽$/);

  await tile.click();
  const sheet = page.getByRole('dialog', { name: 'Тестовая кредитка' });
  const util = sheet.locator('.credits-util');
  await expect(util.locator('.credits-util__legend').first()).toHaveText(/^Использовано 0\s₽ · доступно 51\s500\s₽$/);
  await expect(util.locator('.credits-util__legend').nth(1)).toHaveText(/^Переплата 1\s500\s₽ — ваши деньги на карте$/);
  // An archived card accepts no transfers, so the overpayment would be lost.
  await expect(sheet.getByRole('button', { name: 'Перенести в архив' })).toHaveCount(0);

  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running'));
  const { violations } = await new AxeBuilder({ page }).include('[role="dialog"]').withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(violations.flatMap((v) => v.nodes.map((n) => `${v.id} ${n.target.join(' ')}`))).toEqual([]);
  await expect(util).toHaveScreenshot('credit-card-overpayment.png');
});

test('the transfer form labels an overpaid card as an overpayment', async ({ page }) => {
  await openOverview(page);
  await page.getByRole('button', { name: 'Перевод', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.locator('.atx__trigger').filter({ has: page.locator('.atx__tag', { hasText: /^Куда$/ }) }).click();
  // The card as a source shows what is available; as a target, the overpayment instead of debt.
  await expect(dialog.getByRole('button', { name: /^Тестовая кредитка Доступно: 51\s500\s₽/ })).toHaveCount(1);
  await expect(dialog.getByRole('button', { name: /^Тестовая кредитка Переплата: 1\s500\s₽/ })).toBeVisible();
});
