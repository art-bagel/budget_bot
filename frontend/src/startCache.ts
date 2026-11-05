/**
 * Snapshot of the overview from the previous start, shown at once while the
 * fresh data loads (docs/2026-11-05-instant-start.md).
 *
 * The record is financial data at rest on the device, so it is bound to who
 * looked at it (identity), lives at most CACHE_TTL_MS and is wiped on every
 * login change (setSessionToken, account deletion, 401/403). A write carries
 * a ticket taken before its request started: any clear() in between bumps the
 * generation, and the late write is dropped instead of saving data of a
 * previous login under the next one.
 *
 * No runtime imports: the module is unit-tested directly under node.
 */
import type {
  BankAccount,
  CryptoLivePrice,
  CryptoProtocolPosition,
  DashboardBankBalance,
  DashboardOverview,
  GroupMember,
  PortfolioPosition,
  PortfolioSummaryItem,
  TinkoffLivePrice,
  UserContext,
} from './types';
import type { MoexPrice } from './utils/moex';

export const CACHE_KEY = 'budget_start_cache';
// Bump whenever a type stored in DashboardSnapshot changes shape
// (DEVELOPMENT_GUIDELINES.md); ErrorBoundary wipes the record if it is forgotten.
export const CACHE_VERSION = 1;
export const CACHE_TTL_MS = 72 * 60 * 60 * 1000;

export type DashboardSnapshot = {
  overview: DashboardOverview;
  investmentAccounts: BankAccount[];
  investmentBalancesByAccountId: Record<number, DashboardBankBalance[]>;
  creditNetInBase: number;
  portfolioSummaryItems: PortfolioSummaryItem[];
  openPositions: PortfolioPosition[];
  cryptoProtocolPositions: CryptoProtocolPosition[];
  groupMembersByGroupId: Record<number, GroupMember[]>;
  moexPrices: Map<string, MoexPrice>;
  tinkoffLivePrices: Map<number, TinkoffLivePrice>;
  cryptoLivePrices: Map<number, CryptoLivePrice>;
};

export type StartSnapshot = { user: UserContext; dashboard: DashboardSnapshot; savedAt: number };

export type Ticket = { identity: string; generation: number };

const MAP_FIELDS = ['moexPrices', 'tinkoffLivePrices', 'cryptoLivePrices'] as const;

let generation = 0;
let snapshot: StartSnapshot | null = null;

/** Who the record belongs to: the session wins over initData, as in apiFetch. */
export function cacheIdentity(hasSessionToken: boolean, telegramUserId: string | null): string | null {
  if (hasSessionToken) return 'session';
  return telegramUserId ? `tg:${telegramUserId}` : null;
}

// The identity cannot change without clear(): a new session token goes
// through setSessionToken, and the Telegram id is fixed for the page's life.
// So the generation alone decides whether a ticket is still valid.
export function newTicket(identity: string | null): Ticket | null {
  return identity ? { identity, generation } : null;
}

export function readStart(identity: string | null, now = Date.now()): { user: UserContext; ticket: Ticket } | null {
  snapshot = null;
  if (!identity) return null;

  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const entry = JSON.parse(raw);
    const age = now - entry?.savedAt;
    if (
      entry?.v !== CACHE_VERSION
      || entry.identity !== identity
      || !(age >= 0 && age <= CACHE_TTL_MS)
      || typeof entry.user?.user_id !== 'number'
      || typeof entry.dashboard !== 'object' || entry.dashboard === null
    ) {
      return null;
    }

    const dashboard = { ...entry.dashboard };
    for (const field of MAP_FIELDS) {
      dashboard[field] = new Map(Array.isArray(dashboard[field]) ? dashboard[field] : []);
    }
    snapshot = { user: entry.user, dashboard, savedAt: entry.savedAt };
    return { user: entry.user, ticket: { identity, generation } };
  } catch {
    return null;
  }
}

/** The snapshot readStart() found, until clearStart(). */
export function startSnapshot(): StartSnapshot | null {
  return snapshot;
}

export function writeStart(ticket: Ticket, user: UserContext, dashboard: DashboardSnapshot, now = Date.now()): void {
  if (ticket.generation !== generation) return;

  const stored: Record<string, unknown> = { ...dashboard };
  for (const field of MAP_FIELDS) {
    stored[field] = [...(dashboard[field] as Map<unknown, unknown>)];
  }

  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({
      v: CACHE_VERSION, identity: ticket.identity, savedAt: now, user, dashboard: stored,
    }));
  } catch {
    // Quota or blocked storage: the cache is optional.
  }
}

/**
 * Another tab changed the login (storage event from session.ts): tickets of
 * this tab become stale, but the record — maybe already the next user's —
 * stays.
 */
export function dropStartTickets(): void {
  generation += 1;
  snapshot = null;
}

export function clearStart(): void {
  generation += 1;
  snapshot = null;
  try {
    localStorage.removeItem(CACHE_KEY);
  } catch {
    // Blocked storage holds no record to wipe.
  }
}
