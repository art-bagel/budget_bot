import AxeBuilder from '@axe-core/playwright';
import type { Locator, Page, TestInfo } from '@playwright/test';
import { PORTFOLIO_USER, apiSession, expect, login } from './fixtures';

// Shared steps of the portfolio specs. Data: seed_portfolio() in scripts/seed_ui_test.py.

export const FIXED_NOW = new Date('2026-01-20T12:00:00+03:00');

type Position = { id: number; title: string; status: string; amount_in_currency: number; quantity: number | null; metadata: Record<string, unknown> };

// Logged in as the portfolio user on «Портфель». Returns the MOEX requests the
// page tried: MOEX is fetched by the browser itself, past the offline test API.
export async function openPortfolio(page: Page, { fixedClock = true } = {}) {
  if (fixedClock) await page.clock.setFixedTime(FIXED_NOW);
  const moex: string[] = [];
  await page.route('https://iss.moex.com/**', (route) => {
    moex.push(route.request().url());
    return route.abort();
  });
  await login(page, PORTFOLIO_USER);
  await page.getByRole('button', { name: 'Портфель', exact: true }).click();
  await expect(page.locator('.pf-grp').first()).toBeVisible();
  return moex;
}

export async function settled(page: Page) {
  await page.waitForFunction(() =>
    document.getAnimations().every((a) => a.playState !== 'running' || a.effect?.getComputedTiming().iterations === Number.POSITIVE_INFINITY),
  );
}

export function assetTab(page: Page, name: string) {
  return page.getByRole('tab', { name, exact: true }).first();
}

export function group(page: Page, account: string) {
  return page.locator('.pf-grp', { has: page.locator('.pf-grp__title', { hasText: new RegExp(`^${account}$`) }) });
}

// Form labels are not tied to their inputs, so getByLabel finds nothing.
export function field(scope: Locator, label: string) {
  const exact = new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);
  return scope.locator('.apf-field, .field', { has: scope.page().locator('.apf-label, .fl', { hasText: exact }) }).locator('input, select').first();
}

export function positionSheet(page: Page, title: string) {
  return page.getByRole('dialog', { name: title });
}

export function action(sheet: Locator, name: string) {
  return sheet.getByRole('group', { name: /^Действия с / }).getByRole('button', { name, exact: true });
}

// API as the portfolio user: what the UI wrote, checked apart from the screen.
export async function portfolioApi(page: Page) {
  const { api, headers } = await apiSession(page, PORTFOLIO_USER);
  const get = async (path: string) => {
    const response = await page.request.get(`${api}/api/v1${path}`, { headers });
    expect(response.ok(), path).toBe(true);
    return response.json();
  };
  const accountId = async (name: string): Promise<number> => {
    const accounts: { id: number; name: string }[] = await get('/bank-accounts?account_kind=investment');
    const found = accounts.find((a) => a.name === name);
    expect(found, name).toBeTruthy();
    return (found as { id: number }).id;
  };
  return {
    accountId,
    // Rubles on an investment account, outside its positions.
    cash: async (account: string): Promise<number> => {
      const balances: { asset_type: string; currency_code: string; amount: number }[] =
        await get(`/bank-accounts/${await accountId(account)}/snapshot`);
      return balances.find((b) => b.asset_type === 'fiat' && b.currency_code === 'RUB')?.amount ?? 0;
    },
    position: async (title: string, account?: string): Promise<Position | undefined> => {
      const query = account ? `?investment_account_id=${await accountId(account)}` : '';
      const positions: Position[] = await get(`/portfolio/positions${query}`);
      return positions.find((p) => p.title === title);
    },
  };
}

export type PortfolioApi = Awaited<ReturnType<typeof portfolioApi>>;

// Waits until the account's rubles moved by exactly `delta` from `before`.
export async function expectCash(api: PortfolioApi, account: string, before: number, delta: number) {
  await expect.poll(() => api.cash(account)).toBeCloseTo(before + delta, 2);
}

// Old portfolio violations, kept as they are (owner, 05.11.2026): this task
// adds tests and leaves the interface alone. Fixes go with docs/TODO.md P2
// «Долг из справочника»; a fixed one is removed from here.
const KNOWN = [
  // «Удалить позицию» and similar text buttons: --neg on the sheet background.
  /^color-contrast \.credits-textbtn$/,
  // Green amounts (--pos) on a light card: the token issue of operations rows
  // too (cancel.spec.ts), one fix in the design guide task.
  /^color-contrast \.pf-pos__pnl$/,
];

// The fixed bottom bar lies over long lists in element screenshots.
export async function hideBottomNav(page: Page) {
  await page.addStyleTag({ content: '.bottom-nav { visibility: hidden; }' });
}

export async function newViolations(page: Page, include: string) {
  const { violations } = await new AxeBuilder({ page }).include(include).withTags(['wcag2a', 'wcag2aa']).analyze();
  return violations
    .flatMap((v) => v.nodes.map((n) => `${v.id} ${n.target.join(' ')}`))
    .filter((found) => !KNOWN.some((known) => known.test(found)));
}

// Flows write into the one shared database: a name per repeat keeps
// `--repeat-each` runs from finding an earlier run's position.
export function unique(name: string, testInfo: TestInfo) {
  return `${name} ${testInfo.repeatEachIndex + 1}`;
}
