import type { Page } from '@playwright/test';
import { expect, openOverview, test } from './fixtures';

const focusInDialog = (page: Page) =>
  page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'));

// Tab and Shift+Tab cycle inside an open sheet and never reach the page under it.
test('focus stays inside an open bottom sheet', async ({ page }) => {
  await openOverview(page);
  await page.getByRole('button', { name: /^Продукты/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Продукты' });
  await expect(dialog).toBeVisible();

  const stops = await dialog.evaluate(
    (el) => el.querySelectorAll('button:not([disabled]), input:not([disabled]), select, textarea, [tabindex="0"]').length,
  );
  for (const key of ['Tab', 'Shift+Tab']) {
    for (let i = 0; i < stops + 2; i++) {
      await page.keyboard.press(key);
      expect(await focusInDialog(page), `${key} #${i + 1}`).toBe(true);
    }
  }
});

test('overview hero rows are buttons that work from the keyboard', async ({ page }) => {
  await openOverview(page);
  await page.getByRole('button', { name: /^Личный счёт/ }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();

  await page.getByRole('button', { name: /^Инвестиции/ }).click();
  await expect(page.getByRole('tab', { name: 'Коллекции', exact: true })).toBeVisible();
});
