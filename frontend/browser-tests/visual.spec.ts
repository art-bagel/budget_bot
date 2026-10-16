import { expect, openOverview, test } from './fixtures';

test('overview screen matches the reference', async ({ page }) => {
  // The header greeting depends on the hour.
  await page.clock.setFixedTime(new Date('2026-01-20T12:00:00+03:00'));
  await openOverview(page);
  await expect(page).toHaveScreenshot('overview.png');
});
