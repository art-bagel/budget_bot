import AxeBuilder from '@axe-core/playwright';
import { expect, openOverview, test } from './fixtures';

// Deliberate exceptions, see docs/design-guide.md «Доступность». Anything
// else fails; a new exception needs the owner's decision and a reason here.
const KNOWN = new Set([
  // user-scalable=no: pinch-zoom breaks the Telegram WebApp layout and gestures.
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
