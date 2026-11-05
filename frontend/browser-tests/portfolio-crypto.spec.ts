import { expect, test } from './fixtures';
import { action, assetTab, field, group, openPortfolio, portfolioApi } from './portfolio';

// The coin sheet of a crypto wallet: crediting coins and moving them to
// another wallet. The seed coin TSTP is manual, so it has no price and the
// sheets make no exchange lookups. Data: seed_portfolio() in scripts/seed_ui_test.py.

const WALLET = 'Тестовый кошелёк';
const OTHER = 'Второй кошелёк';

test('a coin is credited and moved to another wallet @flow', async ({ page }) => {
  await openPortfolio(page);
  const api = await portfolioApi(page);
  const coins = async (account: string) => Number((await api.position('TSTP', account))?.quantity ?? 0);
  const before = await coins(WALLET);
  const otherBefore = await coins(OTHER);

  await assetTab(page, 'Криптовалюта').click();
  const sheet = page.getByRole('dialog', { name: 'TSTP' });
  const openCoin = async () => {
    await group(page, WALLET).locator('.pf-pos', { hasText: 'TSTP' }).click();
    await expect(sheet).toBeVisible();
  };

  await openCoin();
  await action(sheet, 'Зачислить').click();
  const credit = page.getByRole('dialog', { name: 'Зачислить · TSTP' });
  await field(credit, 'Количество').fill('1.5');
  await credit.getByRole('button', { name: 'Зачислить', exact: true }).click();
  await expect(credit).toBeHidden();
  await expect.poll(() => coins(WALLET)).toBeCloseTo(before + 1.5, 8);
  // A finished action closes the coin sheet too.
  await expect(sheet).toBeHidden();

  await openCoin();
  await action(sheet, 'Перевод').click();
  const transfer = page.getByRole('dialog', { name: 'Перевод · TSTP' });
  await field(transfer, 'Куда перевести').selectOption({ label: OTHER });
  await field(transfer, 'Количество').fill('2');
  await transfer.getByRole('button', { name: 'Перевести', exact: true }).click();
  await expect(transfer).toBeHidden();
  await expect.poll(() => coins(WALLET)).toBeCloseTo(before - 0.5, 8);
  await expect.poll(() => coins(OTHER)).toBeCloseTo(otherBefore + 2, 8);
});
