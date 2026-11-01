import { expect, login, test } from './fixtures';

// The seed gift was received free and the coin reference lists GRAM: its sale form
// starts with GRAM instead of rubles, and a manual choice sticks.
test('selling a free gift starts with GRAM', async ({ page }) => {
  await login(page);
  await page.getByRole('button', { name: 'Портфель', exact: true }).click();
  await page.getByRole('tab', { name: 'Коллекции', exact: true }).click();
  await page.getByRole('button', { name: /^Тестовый подарок,/ }).click();
  await page.getByRole('button', { name: 'Продать', exact: true }).click();

  const currency = page.locator('.apf-field', { hasText: 'Валюта' }).locator('select');
  await expect(currency.locator('option:checked')).toHaveText(/^GRAM/);

  await currency.selectOption('RUB');
  await expect(currency).toHaveValue('RUB');
});
