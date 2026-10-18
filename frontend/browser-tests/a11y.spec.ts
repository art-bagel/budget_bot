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

// Error and warning texts appear only after a failed request, so the test
// renders each class on the page background (the lowest-contrast surface)
// and lets axe measure them. Red text must use --neg-text, not --neg.
const ERROR_TEXTS = [
  'dlg-error', 'ana-cat__ops-note ana-cat__ops-note--error', 'apf-error', 'pf-detail-error',
  'fx__error', 'tk-error', 'tk-res__warn',
];

test('error texts meet the contrast minimum', async ({ page }) => {
  await openOverview(page);
  await page.evaluate((classes) => {
    const box = document.createElement('div');
    box.id = 'error-texts';
    box.innerHTML =
      classes.map((c) => `<p class="${c}">Не удалось сохранить</p>`).join('') +
      '<div class="settings-page"><p class="danger-card__error">Не удалось удалить</p></div>';
    document.querySelector('main')?.prepend(box);
  }, ERROR_TEXTS);
  const { violations } = await new AxeBuilder({ page }).include('#error-texts').withRules(['color-contrast']).analyze();
  expect(violations.flatMap((v) => v.nodes.map((n) => n.target.join(' ')))).toEqual([]);
});
