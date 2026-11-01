import { expect, openOverview, test } from './fixtures';

// The iOS decimal keypad in Russian gives a comma: «150,5» must be 150.5, as in
// the expense amount field, not a NaN the API rejects.
test('a scheduled expense amount accepts a decimal comma', async ({ page }, testInfo) => {
  // Writes to the shared seed and removes it again: one theme is enough.
  test.skip(testInfo.project.name !== 'light', 'data flow runs in one theme');
  await openOverview(page);
  await page.getByRole('button', { name: /^Продукты/ }).click();
  const sheet = page.getByRole('dialog', { name: 'Продукты' });
  await sheet.getByRole('button', { name: 'Настройки' }).click();
  await sheet.getByRole('button', { name: '+ Добавить расписание' }).click();

  const amount = sheet.getByPlaceholder('0');
  await amount.fill('150,5');
  await expect(amount).toHaveValue('150.5');
  await sheet.getByRole('button', { name: 'Добавить', exact: true }).click();
  await expect(sheet.getByText(/^150\.50? RUB$/)).toBeVisible();

  await sheet.getByRole('button', { name: 'Удалить', exact: true }).click();
  await expect(sheet.getByText(/^150\.50? RUB$/)).toHaveCount(0);
});
