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

  // Walk Tab until focus comes back to the first stop: every step stays in
  // the dialog, and Shift+Tab from the first stop lands on the last one.
  const mark = () =>
    page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el?.closest('[role="dialog"]')) return null;
      el.dataset.stop ??= String(document.querySelectorAll('[data-stop]').length);
      return el.dataset.stop;
    });
  await page.keyboard.press('Tab');
  const first = await mark();
  expect(first).not.toBeNull();
  // A date input keeps focus while Tab walks its day/month/year parts:
  // repeats of the same stop are not new stops.
  const seen = [first];
  for (let i = 0; i < 50; i++) {
    await page.keyboard.press('Tab');
    const stop = await mark();
    expect(stop, `Tab #${i + 2}`).not.toBeNull();
    if (stop === seen[seen.length - 1]) continue;
    if (stop === first) break;
    seen.push(stop);
  }
  expect(seen.length, 'more than one stop').toBeGreaterThan(1);
  expect(await mark(), 'Tab wraps to the first stop').toBe(first);
  await page.keyboard.press('Shift+Tab');
  expect(await mark(), 'Shift+Tab wraps to the last stop').toBe(seen[seen.length - 1]);
  expect(await focusInDialog(page)).toBe(true);
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
