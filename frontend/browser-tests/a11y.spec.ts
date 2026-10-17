import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { expect, openOverview, test } from './fixtures';

// Deliberate exceptions, see docs/design-guide.md «Доступность». Anything
// else fails; a new exception needs the owner's decision and a reason here.
const KNOWN = new Set([
  // user-scalable=no: pinch-zoom breaks the Telegram WebApp layout and gestures.
  'meta-viewport meta[name="viewport"]',
]);

async function newViolations(page: Page) {
  const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  const found = violations.flatMap((v) =>
    v.nodes.map((n) => ({ key: `${v.id} ${n.target.join(' ')}`, why: n.failureSummary ?? '' })),
  );
  return found.filter((f) => !KNOWN.has(f.key));
}

test('overview screen has no new WCAG A/AA violations', async ({ page }) => {
  await openOverview(page);
  expect(await newViolations(page)).toEqual([]);
});

// The ink hero shares .hero__row with the overview: its rows are filter toggles.
test('credits screen has no new WCAG A/AA violations', async ({ page }) => {
  await openOverview(page);
  await page.getByRole('button', { name: 'Кредиты', exact: true }).click();
  const cards = page.locator('.hero__row', { hasText: 'Карты' });
  await expect(cards).toHaveAttribute('aria-pressed', 'false');
  await cards.click();
  await expect(cards).toHaveAttribute('aria-pressed', 'true');
  await page.waitForFunction(() =>
    document.getAnimations().every((a) => a.playState !== 'running' || a.effect?.getComputedTiming().iterations === Number.POSITIVE_INFINITY),
  );
  expect(await newViolations(page)).toEqual([]);
});
