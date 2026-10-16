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
});
