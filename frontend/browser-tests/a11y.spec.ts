import AxeBuilder from '@axe-core/playwright';
import { expect, openOverview, test } from './fixtures';

// Violations that existed when the check was introduced (2026-10-15), see
// docs/2026-10-15-playwright.md «Известные уязвимости». Anything else fails.
// Fixed one? Remove it from the list.
const KNOWN = new Set([
  // --text-3 token is below 4.5:1 in both themes; belongs to the design-guide task.
  'color-contrast .bar__hello',
  'color-contrast .sec-tag',
  'color-contrast .bottom-nav__item:nth-child(2) > .bottom-nav__item-label',
  'color-contrast .bottom-nav__item:nth-child(3) > .bottom-nav__item-label',
  'color-contrast .bottom-nav__item:nth-child(4) > .bottom-nav__item-label',
  // Hero rows: <div role="button"> between <dl> and <dt>/<dd>.
  'definition-list dl',
  'dlitem .hero__row[role="button"]:nth-child(1) > dt',
  'dlitem .hero__row[role="button"]:nth-child(1) > dd',
  'dlitem .hero__row[role="button"]:nth-child(2) > dt',
  'dlitem .hero__row[role="button"]:nth-child(2) > dd',
  'dlitem .hero__row[role="button"]:nth-child(3) > dt',
  'dlitem .hero__row[role="button"]:nth-child(3) > dd',
  // Category list: <li role="button"> inside <ul>.
  'list ul',
  // Deliberate: pinch-zoom breaks the Telegram WebApp layout.
  'meta-viewport meta[name="viewport"]',
]);

test('overview screen has no new WCAG A/AA violations', async ({ page }) => {
  await openOverview(page);
  const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  const found = violations.flatMap((v) =>
    v.nodes.map((n) => ({ key: `${v.id} ${n.target.join(' ')}`, why: n.failureSummary ?? '' })),
  );
  expect(found.filter((f) => !KNOWN.has(f.key))).toEqual([]);
});
