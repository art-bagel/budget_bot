import { expect, login, test } from './fixtures';

const SECTIONS = [
  { nav: 'Портфель', marker: 'TSTC' },
  { nav: 'Кредиты', marker: 'Тестовая кредитка' },
  { nav: 'Настройки', marker: 'Тема интерфейса' },
  { nav: 'Обзор', marker: 'Продукты' },
];

test('login, main sections and a sheet from the keyboard', async ({ page }) => {
  await login(page);

  for (const { nav, marker } of SECTIONS) {
    await page.getByRole('button', { name: nav, exact: true }).click();
    await expect(page.locator('.splash')).toBeHidden();
    await expect(page.locator('main').getByText(marker).first()).toBeVisible();
  }

  const opener = page.getByRole('button', { name: /^Продукты/ });
  await opener.focus();
  await page.keyboard.press('Enter');
  const sheet = page.getByRole('dialog', { name: 'Продукты' });
  await expect(sheet).toBeVisible();
  // Focus moves into the sheet (the sheet itself or its autofocused field).
  await expect.poll(() => sheet.evaluate((el) => el.contains(document.activeElement))).toBe(true);

  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();
  await expect(opener).toBeFocused();

  // Escape inside a field that handles it itself must not close the sheet.
  await page.getByRole('button', { name: 'Пополнить', exact: true }).click();
  const income = page.getByRole('dialog', { name: 'Пополнить счёт' });
  await income.getByRole('button', { name: 'Новый', exact: true }).click();
  const sourceName = income.getByPlaceholder('Название источника');
  await sourceName.fill('Подработка');
  await sourceName.press('Escape');
  await expect(sourceName).toBeHidden();
  await expect(income).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(income).toBeHidden();
});
