import { type FormEvent, type KeyboardEvent, useEffect, useMemo, useState } from 'react';
import { TrendingUp, Landmark, Coins, Package, Info, Trash2 } from 'lucide-react';
import { CategorySvgIcon } from '../components/CategorySvgIcon';

import {
  cancelPortfolioIncome,
  changeDepositRate,
  closePortfolioPosition,
  createBankAccount,
  deletePortfolioPosition,
  fetchBankAccountSnapshot,
  fetchBankAccounts,
  fetchCurrencies,
  fetchPortfolioEvents,
  fetchPortfolioPositions,
  fetchPortfolioSummary,
  fetchTinkoffLivePrices,
  getTinkoffInstrumentLogoUrl,
  getTinkoffConnections,
  partialClosePortfolioPosition,
  recordPortfolioFee,
  recordPortfolioIncome,
  topUpPortfolioPosition,
  fetchPortfolioAnalytics,
} from '../api';
import BottomSheet from '../components/BottomSheet';
import PortfolioPositionDialog from '../components/PortfolioPositionDialog';
import TinkoffSyncDialog from '../components/TinkoffSyncDialog';
import type {
  BankAccount,
  Currency,
  DashboardBankBalance,
  ExternalConnection,
  PortfolioEvent,
  PortfolioPosition,
  PortfolioSummaryItem,
  TinkoffLivePrice,
  UserContext,
  PortfolioAnalyticsData,
} from '../types';
import { calculateProjectedInterest } from '../utils/depositInterest';
import { formatAmount, formatNumericAmount, currencySymbol } from '../utils/format';
import { fetchMoexPrices } from '../utils/moex';
import type { MoexPrice } from '../utils/moex';
import Operations from './Operations';


type AccountWithBalances = {
  account: BankAccount;
  balances: DashboardBankBalance[];
};

type CloseDraft = {
  amount: string;
  currencyCode: string;
  baseAmount: string;
  closedAt: string;
  comment: string;
};

type IncomeDraft = {
  amount: string;
  currencyCode: string;
  baseAmount: string;
  incomeKind: string;
  destination: 'account' | 'position';
  receivedAt: string;
  comment: string;
};

type TopUpDraft = {
  amount: string;
  quantity: string;
  currencyCode: string;
  toppedUpAt: string;
  comment: string;
};

type PartialCloseDraft = {
  returnAmount: string;
  returnCurrencyCode: string;
  returnBaseAmount: string;
  principalReduction: string;
  closedQuantity: string;
  closedAt: string;
  comment: string;
};

type FeeDraft = {
  amount: string;
  currencyCode: string;
  chargedAt: string;
  comment: string;
};

type RateChangeDraft = {
  newRate: string;
  effectiveDate: string;
};

type PortfolioAssetTab = {
  code: string;
  label: string;
  openCount: number;
  closedCount: number;
  principalInBase: number;
  incomeInBase: number;
  totalInBase: number;
};

type PositionAccountGroup = {
  accountId: number;
  accountName: string;
  ownerType: 'user' | 'family';
  positions: PortfolioPosition[];
};

type PositionAccountTab = {
  key: string;
  accountName: string;
  ownerLabel: string | null;
  openCount: number;
  estimatedValue: number;
};

type SecuritySection = {
  code: string;
  label: string;
  positions: PortfolioPosition[];
};

type PortfolioAnalyticsBucket = {
  key: string;
  label: string;
  estimatedValue: number;
  investedPrincipal: number;
  currentResult: number;
  positionsCount: number;
  share: number;
};

type PortfolioAnalyticsAccountItem = {
  key: string;
  accountName: string;
  ownerLabel: string | null;
  estimatedValue: number;
  investedPrincipal: number;
  cashValue: number;
  resultValue: number;
  positionsCount: number;
};

type PortfolioAnalyticsLeader = {
  positionId: number;
  title: string;
  ticker: string | null;
  accountName: string;
  quantity: number | null | undefined;
  estimatedValue: number;
  currentResult: number | null;
  logoUrl: string | null;
  share: number;
};

const ASSET_TYPE_OPTIONS = [
  { value: 'security', label: 'Ценные бумаги' },
  { value: 'deposit', label: 'Депозит' },
  { value: 'crypto', label: 'Криптовалюта' },
  { value: 'other', label: 'Разное' },
] as const;

const DEFAULT_PORTFOLIO_ASSET_TYPE_CODES = ['security', 'deposit', 'crypto', 'other'] as const;

const SECURITY_KIND_OPTIONS = [
  { value: 'stock', label: 'Акции' },
  { value: 'bond', label: 'Облигации' },
  { value: 'fund', label: 'Фонды' },
] as const;

const ANALYTICS_COLOR_PALETTE = [
  '#00d2ff',
  '#00e090',
  '#ff5580',
  '#ffaa00',
  '#a855ff',
  '#7b8a99',
];

const INCOME_KIND_LABELS: Record<string, string> = {
  dividend: 'Дивиденды',
  interest: 'Проценты',
  coupon: 'Купоны',
  other: 'Прочее',
};

function getAnalyticsPeriodRange(
  periodType: 'month' | 'quarter' | 'year',
  offset: number,
): { dateFrom: string; dateTo: string; label: string } {
  const now = new Date();
  let start: Date;
  let end: Date;
  let label: string;

  if (periodType === 'month') {
    start = new Date(now.getFullYear(), now.getMonth() + offset, 1);
    end = new Date(start.getFullYear(), start.getMonth() + 1, 0);
    label = start.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' });
  } else if (periodType === 'quarter') {
    const currentQuarter = Math.floor(now.getMonth() / 3);
    const targetQuarter = currentQuarter + offset;
    const targetYear = now.getFullYear() + Math.floor(targetQuarter / 4);
    const targetQuarterInYear = ((targetQuarter % 4) + 4) % 4;
    start = new Date(targetYear, targetQuarterInYear * 3, 1);
    end = new Date(targetYear, targetQuarterInYear * 3 + 3, 0);
    label = `${targetQuarterInYear + 1} кв. ${targetYear}`;
  } else {
    const targetYear = now.getFullYear() + offset;
    start = new Date(targetYear, 0, 1);
    end = new Date(targetYear, 11, 31);
    label = String(targetYear);
  }

  return {
    dateFrom: start.toISOString().slice(0, 10),
    dateTo: end.toISOString().slice(0, 10),
    label,
  };
}

function buildPortfolioDonutGradient(segments: { share: number; color: string }[]): string {
  if (segments.length === 0) {
    return 'conic-gradient(var(--bg-inset) 0turn 1turn)';
  }
  let currentOffset = 0;
  const parts = segments.map((s) => {
    const start = currentOffset;
    currentOffset += s.share;
    return `${s.color} ${start}turn ${currentOffset}turn`;
  });
  return `conic-gradient(${parts.join(', ')})`;
}

function incomeKindLabel(kind: string): string {
  return INCOME_KIND_LABELS[kind] ?? kind.charAt(0).toUpperCase() + kind.slice(1);
}


function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function formatDateLabel(value: string): string {
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date(value));
}

function assetTypeIconColor(code: string): { icon: string; color: string } {
  if (code === 'security') return { icon: 'chart', color: 'b' };
  if (code === 'deposit')  return { icon: 'landmark', color: 'g' };
  if (code === 'crypto')   return { icon: 'coins', color: 'o' };
  return { icon: 'package', color: 'p' };
}

function assetTypeLabel(assetTypeCode: string): string {
  const knownLabel = ASSET_TYPE_OPTIONS.find((item) => item.value === assetTypeCode)?.label;
  if (knownLabel) {
    return knownLabel;
  }

  return assetTypeCode
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function pluralRu(value: number, forms: [string, string, string]): string {
  const absValue = Math.abs(value);
  const mod100 = absValue % 100;
  const mod10 = absValue % 10;
  if (mod100 >= 11 && mod100 <= 14) return forms[2];
  if (mod10 === 1) return forms[0];
  if (mod10 >= 2 && mod10 <= 4) return forms[1];
  return forms[2];
}

function formatUnitPrice(amount: number, quantity: number | null | undefined, currencyCode: string): string | null {
  if (!quantity || quantity <= 0) {
    return null;
  }

  return formatAmount(amount / quantity, currencyCode);
}

function getSecurityKindCode(position: PortfolioPosition): string {
  return typeof position.metadata?.security_kind === 'string' && position.metadata.security_kind.trim()
    ? position.metadata.security_kind
    : 'stock';
}

function getSecurityKindLabel(code: string): string {
  const knownLabel = SECURITY_KIND_OPTIONS.find((option) => option.value === code)?.label;
  if (knownLabel) {
    return knownLabel;
  }

  return code
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function getPositionAccountKey(position: Pick<PortfolioPosition, 'investment_account_owner_type' | 'investment_account_id'>): string {
  return `${position.investment_account_owner_type}:${position.investment_account_id}`;
}

function getInvestmentAccountAssetType(account: BankAccount): string {
  return account.investment_asset_type ?? 'security';
}

function createInitialCloseDraft(position: PortfolioPosition): CloseDraft {
  return {
    amount: '',
    currencyCode: position.currency_code,
    baseAmount: '',
    closedAt: todayIso(),
    comment: '',
  };
}

function createInitialIncomeDraft(position: PortfolioPosition): IncomeDraft {
  return {
    amount: '',
    currencyCode: position.currency_code,
    baseAmount: '',
    incomeKind: position.asset_type_code === 'deposit'
      ? 'interest'
      : position.asset_type_code === 'security'
        ? 'dividend'
        : 'other',
    destination: position.asset_type_code === 'deposit' ? 'position' : 'account',
    receivedAt: todayIso(),
    comment: '',
  };
}

function createInitialTopUpDraft(position: PortfolioPosition): TopUpDraft {
  return {
    amount: '',
    quantity: '',
    currencyCode: position.currency_code,
    toppedUpAt: todayIso(),
    comment: '',
  };
}

function createInitialPartialCloseDraft(position: PortfolioPosition): PartialCloseDraft {
  return {
    returnAmount: '',
    returnCurrencyCode: position.currency_code,
    returnBaseAmount: '',
    principalReduction: '',
    closedQuantity: '',
    closedAt: todayIso(),
    comment: '',
  };
}

function createInitialFeeDraft(position: PortfolioPosition): FeeDraft {
  return {
    amount: '',
    currencyCode: position.currency_code,
    chargedAt: todayIso(),
    comment: '',
  };
}

function canRecordPositionIncome(position: PortfolioPosition): boolean {
  return position.asset_type_code === 'security'
    || position.asset_type_code === 'deposit'
    || position.asset_type_code === 'crypto'
    || position.asset_type_code === 'other';
}

function getPositionRealizedResult(position: PortfolioPosition): number {
  return Number(position.metadata?.income_in_base ?? 0) + Number(position.metadata?.realized_result_in_base ?? 0);
}

function getEventLabel(item: PortfolioEvent): string {
  if (item.event_type === 'income') {
    const incomeKind = typeof item.metadata?.income_kind === 'string' ? item.metadata.income_kind : 'income';
    if (incomeKind === 'dividend') return 'DIVIDEND';
    if (incomeKind === 'interest') return 'INTEREST';
    return 'INCOME';
  }

  if (item.event_type === 'top_up') {
    return 'TOP UP';
  }

  if (item.event_type === 'partial_close') {
    return 'PARTIAL CLOSE';
  }

  if (item.event_type === 'fee') {
    return 'FEE';
  }

  if (item.event_type === 'adjustment') {
    const action = typeof item.metadata?.action === 'string' ? item.metadata.action : '';
    if (action === 'cancel_income') return 'CANCEL';
    return 'ADJUST';
  }

  return item.event_type.toUpperCase();
}


export default function Portfolio({ user }: { user: UserContext }) {
  const [accounts, setAccounts] = useState<AccountWithBalances[]>([]);
  const [currencies, setCurrencies] = useState<Currency[]>([]);
  const [positions, setPositions] = useState<PortfolioPosition[]>([]);
  const [summaryItems, setSummaryItems] = useState<PortfolioSummaryItem[]>([]);
  const [activeAssetTypeCode, setActiveAssetTypeCode] = useState<string>('all');
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [addSheetOpen, setAddSheetOpen] = useState(false);
  const [addSheetTypeCode, setAddSheetTypeCode] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [submittingCloseId, setSubmittingCloseId] = useState<number | null>(null);
  const [submittingIncomeId, setSubmittingIncomeId] = useState<number | null>(null);
  const [submittingTopUpId, setSubmittingTopUpId] = useState<number | null>(null);
  const [submittingPartialCloseId, setSubmittingPartialCloseId] = useState<number | null>(null);
  const [submittingFeeId, setSubmittingFeeId] = useState<number | null>(null);
  const [deletingPositionId, setDeletingPositionId] = useState<number | null>(null);
  const [cancellingIncomeEventId, setCancellingIncomeEventId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [closeError, setCloseError] = useState<string | null>(null);
  const [incomeError, setIncomeError] = useState<string | null>(null);
  const [topUpError, setTopUpError] = useState<string | null>(null);
  const [partialCloseError, setPartialCloseError] = useState<string | null>(null);
  const [feeError, setFeeError] = useState<string | null>(null);
  const [rateChangeError, setRateChangeError] = useState<string | null>(null);
  const [submittingRateChangeId, setSubmittingRateChangeId] = useState<number | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [cancelIncomeError, setCancelIncomeError] = useState<string | null>(null);
  const [selectedPositionId, setSelectedPositionId] = useState<number | null>(null);
  const [eventsByPosition, setEventsByPosition] = useState<Record<number, PortfolioEvent[]>>({});
  const [eventsLoadingId, setEventsLoadingId] = useState<number | null>(null);
  const [eventsError, setEventsError] = useState<string | null>(null);
  const [closeDrafts, setCloseDrafts] = useState<Record<number, CloseDraft>>({});
  const [incomeDrafts, setIncomeDrafts] = useState<Record<number, IncomeDraft>>({});
  const [topUpDrafts, setTopUpDrafts] = useState<Record<number, TopUpDraft>>({});
  const [partialCloseDrafts, setPartialCloseDrafts] = useState<Record<number, PartialCloseDraft>>({});
  const [feeDrafts, setFeeDrafts] = useState<Record<number, FeeDraft>>({});
  const [rateChangeDrafts, setRateChangeDrafts] = useState<Record<number, RateChangeDraft>>({});
  const [assetSwipeStartX, setAssetSwipeStartX] = useState<number | null>(null);
  const [accountSwipeStartX, setAccountSwipeStartX] = useState<number | null>(null);
  const [showClosedPositions, setShowClosedPositions] = useState(false);
  const [moexPrices, setMoexPrices] = useState<Map<string, MoexPrice>>(new Map());
  const [tinkoffLivePrices, setTinkoffLivePrices] = useState<Map<number, TinkoffLivePrice>>(new Map());
  const [tinkoffConnections, setTinkoffConnections] = useState<ExternalConnection[]>([]);
  const [syncDialogConnection, setSyncDialogConnection] = useState<ExternalConnection | null>(null);
  const [showAccountsModal, setShowAccountsModal] = useState(false);
  const [heroTypeSheetCode, setHeroTypeSheetCode] = useState<string | null>(null);
  const [valueMode, setValueMode] = useState<'now' | 'potential'>('now');
  const [heroPnlMode, setHeroPnlMode] = useState<'external' | 'cost'>('cost');
  const [showIncomePopup, setShowIncomePopup] = useState(false);
  const [portfolioView, setPortfolioView] = useState<'positions' | 'ops' | 'analytics'>('positions');
  const [activeAccountTabKey, setActiveAccountTabKey] = useState('all');
  const [analyticsData, setAnalyticsData] = useState<PortfolioAnalyticsData | null>(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [analyticsPeriodType, setAnalyticsPeriodType] = useState<'month' | 'quarter' | 'year'>('year');
  const [analyticsPeriodOffset, setAnalyticsPeriodOffset] = useState(0);

  // New investment account form
  const [showNewAccountModal, setShowNewAccountModal] = useState(false);
  const [newAccountStep, setNewAccountStep] = useState<'pick' | 'form'>('pick');
  const [newAccountName, setNewAccountName] = useState('');
  const [newAccountOwnerType, setNewAccountOwnerType] = useState<'user' | 'family'>('user');
  const [newAccountAssetType, setNewAccountAssetType] = useState<'security' | 'deposit' | 'crypto' | 'other'>('security');
  const [newAccountProvider, setNewAccountProvider] = useState('');
  const [creatingAccount, setCreatingAccount] = useState(false);
  const [createAccountError, setCreateAccountError] = useState<string | null>(null);

  const loadPortfolio = async () => {
    setLoading(true);
    setError(null);

    try {
      const [investmentAccounts, loadedPositions, loadedCurrencies, loadedSummary, loadedConnections] = await Promise.all([
        fetchBankAccounts('investment'),
        fetchPortfolioPositions(),
        fetchCurrencies(),
        fetchPortfolioSummary(),
        getTinkoffConnections().catch(() => [] as ExternalConnection[]),
      ]);
      const snapshots = await Promise.all(
        investmentAccounts.map(async (account) => ({
          account,
          balances: await fetchBankAccountSnapshot(account.id),
        })),
      );

      setAccounts(snapshots);
      setPositions(loadedPositions);
      setCurrencies(loadedCurrencies);
      setSummaryItems(loadedSummary);
      setTinkoffConnections(loadedConnections);
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadPortfolio();
  }, [user.user_id]);

  // Fetch MOEX prices for open positions that have a ticker in metadata
  useEffect(() => {
    const sharesTickers: string[] = [];
    const bondsTickers: string[] = [];
    for (const pos of positions) {
      if (pos.status !== 'open') continue;
      const t = pos.metadata?.ticker;
      const m = pos.metadata?.moex_market;
      if (typeof t !== 'string' || !t) continue;
      if (m === 'bonds') bondsTickers.push(t);
      else sharesTickers.push(t);
    }
    if (sharesTickers.length === 0 && bondsTickers.length === 0) return;

    void Promise.all([
      fetchMoexPrices(sharesTickers, 'shares'),
      fetchMoexPrices(bondsTickers, 'bonds'),
    ]).then(([sharesMap, bondsMap]) => {
      setMoexPrices(new Map([...sharesMap, ...bondsMap]));
    }).catch(() => {});
  }, [positions]);

  const totalHistoricalInBase = useMemo(
    () => accounts.reduce(
      (sum, item) => sum + item.balances.reduce((accountSum, balance) => accountSum + balance.historical_cost_in_base, 0),
      0,
    ),
    [accounts],
  );

  const openPositions = useMemo(
    () => positions.filter((position) => position.status === 'open'),
    [positions],
  );

  useEffect(() => {
    const connectedAccountIds = new Set(
      tinkoffConnections
        .map((connection) => connection.linked_account_id)
        .filter((value): value is number => typeof value === 'number'),
    );
    const hasConnectedAccounts = connectedAccountIds.size > 0;
    const hasConnectedOpenPositions = openPositions.some((position) => connectedAccountIds.has(position.investment_account_id));

    if (!hasConnectedAccounts) {
      setTinkoffLivePrices(new Map());
      return;
    }

    void (hasConnectedOpenPositions
      ? fetchTinkoffLivePrices().catch(() => [] as TinkoffLivePrice[])
      : Promise.resolve([] as TinkoffLivePrice[])
    ).then((prices) => {
      setTinkoffLivePrices(new Map(prices.map((item) => [item.position_id, item])));
    }).catch(() => {
      setTinkoffLivePrices(new Map());
    });
  }, [openPositions, tinkoffConnections]);

  const analyticsPeriodRange = useMemo(
    () => getAnalyticsPeriodRange(analyticsPeriodType, analyticsPeriodOffset),
    [analyticsPeriodType, analyticsPeriodOffset],
  );

  useEffect(() => {
    if (portfolioView !== 'analytics') return;
    setAnalyticsLoading(true);
    fetchPortfolioAnalytics(analyticsPeriodRange.dateFrom, analyticsPeriodRange.dateTo)
      .then(setAnalyticsData)
      .catch(() => setAnalyticsData(null))
      .finally(() => setAnalyticsLoading(false));
  }, [portfolioView, analyticsPeriodRange.dateFrom, analyticsPeriodRange.dateTo]);

  const analyticsMonthlyBars = useMemo(() => {
    if (!analyticsData) return [];
    const monthMap = new Map<string, { income: number; trades: number; adjustments: number }>();
    for (const item of analyticsData.monthly_income) {
      const existing = monthMap.get(item.period) ?? { income: 0, trades: 0, adjustments: 0 };
      existing.income += item.total_amount;
      monthMap.set(item.period, existing);
    }
    for (const item of analyticsData.monthly_trades) {
      const existing = monthMap.get(item.period) ?? { income: 0, trades: 0, adjustments: 0 };
      existing.trades += item.total_amount;
      monthMap.set(item.period, existing);
    }
    for (const item of analyticsData.monthly_adjustments) {
      const existing = monthMap.get(item.period) ?? { income: 0, trades: 0, adjustments: 0 };
      existing.adjustments += item.total_amount;
      monthMap.set(item.period, existing);
    }
    const entries = Array.from(monthMap.entries()).sort(([a], [b]) => a.localeCompare(b));
    const monthFormat: Intl.DateTimeFormatOptions['month'] = entries.length > 6 ? 'narrow' : 'short';
    return entries.map(([period, values]) => ({
      period,
      label: new Date(period).toLocaleDateString('ru-RU', { month: monthFormat }),
      income: values.income,
      trades: values.trades,
      total: values.income + values.trades + values.adjustments,
    }));
  }, [analyticsData]);

  const analyticsAssetTypeDonut = useMemo(() => {
    if (!analyticsData) return [];
    const totalIncome = analyticsData.totals_by_asset_type.reduce(
      (sum, item) => sum + item.income_total + item.trade_total + item.adjustment_total, 0,
    );
    if (totalIncome <= 0) return [];
    return analyticsData.totals_by_asset_type
      .map((item, index) => ({
        key: item.asset_type_code,
        label: assetTypeLabel(item.asset_type_code),
        amount: item.income_total + item.trade_total + item.adjustment_total,
        share: (item.income_total + item.trade_total + item.adjustment_total) / totalIncome,
        color: ANALYTICS_COLOR_PALETTE[index % ANALYTICS_COLOR_PALETTE.length],
      }))
      .filter((s) => s.amount !== 0)
      .sort((a, b) => b.amount - a.amount);
  }, [analyticsData]);

  const analyticsIncomeKindDonut = useMemo(() => {
    if (!analyticsData) return [];
    const total = analyticsData.totals_by_income_kind.reduce((sum, item) => sum + item.total_amount, 0);
    if (total <= 0) return [];
    return analyticsData.totals_by_income_kind
      .map((item, index) => ({
        key: item.income_kind,
        label: incomeKindLabel(item.income_kind),
        amount: item.total_amount,
        share: item.total_amount / total,
        color: ANALYTICS_COLOR_PALETTE[index % ANALYTICS_COLOR_PALETTE.length],
      }))
      .sort((a, b) => b.amount - a.amount);
  }, [analyticsData]);

  const analyticsTotalIncome = useMemo(() => {
    if (!analyticsData) return 0;
    return analyticsData.totals_by_asset_type.reduce(
      (sum, item) => sum + item.income_total + item.adjustment_total, 0,
    );
  }, [analyticsData]);

  const analyticsTotalTrades = useMemo(() => {
    if (!analyticsData) return 0;
    return analyticsData.totals_by_asset_type.reduce(
      (sum, item) => sum + item.trade_total, 0,
    );
  }, [analyticsData]);

  const closedPositions = useMemo(
    () => positions.filter((position) => position.status === 'closed'),
    [positions],
  );

  const assetTabs = useMemo<PortfolioAssetTab[]>(() => {
    const accountTypeCodes = Array.from(new Set(accounts.map(({ account }) => getInvestmentAccountAssetType(account))));
    const knownCodes = DEFAULT_PORTFOLIO_ASSET_TYPE_CODES.filter((code) => accountTypeCodes.includes(code));
    const extraCodes = accountTypeCodes
      .filter((code) => !knownCodes.includes(code as (typeof DEFAULT_PORTFOLIO_ASSET_TYPE_CODES)[number]))
      .sort((left, right) => assetTypeLabel(left).localeCompare(assetTypeLabel(right), 'ru'));

    const typeTabs = [...knownCodes, ...extraCodes].map((code) => ({
      code,
      label: assetTypeLabel(code),
      openCount: openPositions.filter((position) => position.asset_type_code === code).length,
      closedCount: closedPositions.filter((position) => position.asset_type_code === code).length,
      principalInBase: openPositions
        .filter((position) => position.asset_type_code === code)
        .reduce((sum, position) => sum + Number(position.metadata?.amount_in_base ?? 0), 0),
      incomeInBase: positions
        .filter((position) => position.asset_type_code === code)
        .reduce((sum, position) => sum + getPositionRealizedResult(position), 0),
      totalInBase: 0,
    })).map((tab) => ({
      ...tab,
      totalInBase: tab.principalInBase + tab.incomeInBase,
    }));
    const allTab: PortfolioAssetTab = {
      code: 'all',
      label: 'Все',
      openCount: openPositions.length,
      closedCount: closedPositions.length,
      principalInBase: typeTabs.reduce((s, t) => s + t.principalInBase, 0),
      incomeInBase: typeTabs.reduce((s, t) => s + t.incomeInBase, 0),
      totalInBase: typeTabs.reduce((s, t) => s + t.totalInBase, 0),
    };
    return [allTab, ...typeTabs];
  }, [accounts, closedPositions, openPositions, positions]);

  useEffect(() => {
    if (activeAssetTypeCode === 'all') return;
    if (!assetTabs.some((tab) => tab.code === activeAssetTypeCode)) {
      setActiveAssetTypeCode('all');
    }
  }, [activeAssetTypeCode, assetTabs]);

  const activeAssetTab = useMemo(
    () => assetTabs.find((tab) => tab.code === activeAssetTypeCode) ?? assetTabs[0] ?? null,
    [activeAssetTypeCode, assetTabs],
  );

  const filteredOpenPositions = useMemo(
    () => activeAssetTypeCode === 'all'
      ? openPositions
      : openPositions.filter((position) => position.asset_type_code === activeAssetTypeCode),
    [activeAssetTypeCode, openPositions],
  );

  const filteredClosedPositions = useMemo(
    () => activeAssetTypeCode === 'all'
      ? closedPositions
      : closedPositions.filter((position) => position.asset_type_code === activeAssetTypeCode),
    [activeAssetTypeCode, closedPositions],
  );

  const filteredAccounts = useMemo(
    () => activeAssetTypeCode === 'all'
      ? accounts
      : accounts.filter(
          ({ account }) => !account.investment_asset_type || account.investment_asset_type === activeAssetTypeCode,
        ),
    [accounts, activeAssetTypeCode],
  );

  const getPositionMetadataNumber = (position: PortfolioPosition, key: string): number | null => {
    const value = position.metadata?.[key];
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === 'string' && value.trim() !== '') {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
  };

  const getPositionMetadataText = (position: PortfolioPosition, key: string): string | null => {
    const value = position.metadata?.[key];
    if (typeof value !== 'string') {
      return null;
    }
    const normalized = value.trim();
    return normalized !== '' ? normalized : null;
  };

  const getPositionEntryAmount = (position: PortfolioPosition): number => {
    if (position.metadata?.moex_market === 'bonds') {
      return getPositionMetadataNumber(position, 'clean_amount_in_base') ?? position.amount_in_currency;
    }
    return position.amount_in_currency;
  };

  const getPositionInvestedPrincipal = (position: PortfolioPosition): number => {
    if (position.metadata?.moex_market === 'bonds') {
      return (
        getPositionMetadataNumber(position, 'clean_amount_in_base')
        ?? getPositionEntryAmount(position)
        ?? getPositionMetadataNumber(position, 'amount_in_base')
        ?? position.amount_in_currency
      );
    }

    return (
      getPositionMetadataNumber(position, 'amount_in_base')
      ?? getPositionEntryAmount(position)
    );
  };

  const getResolvedPositionQuote = (position: PortfolioPosition) => {
    const tinkoffPrice = tinkoffLivePrices.get(position.id) ?? null;
    if (tinkoffPrice) {
      return {
        currentPrice: tinkoffPrice.clean_price ?? tinkoffPrice.price,
        currentTotalValue: tinkoffPrice.current_value,
        performanceCurrentValue: tinkoffPrice.clean_current_value ?? tinkoffPrice.current_value,
        isPreviousClose: false,
        source: 'tinkoff' as const,
      };
    }

    const ticker = typeof position.metadata?.ticker === 'string' ? position.metadata.ticker : null;
    const isBond = position.metadata?.moex_market === 'bonds';
    const moexPrice = ticker ? moexPrices.get(ticker) : null;
    const currentPrice = moexPrice?.last ?? moexPrice?.prevClose ?? null;
    const currentTotalValue = !isBond && currentPrice !== null && position.quantity
      ? currentPrice * position.quantity
      : null;

    return {
      currentPrice,
      currentTotalValue,
      performanceCurrentValue: currentTotalValue,
      isPreviousClose: moexPrice?.last === null && moexPrice?.prevClose !== null,
      source: currentPrice !== null ? 'moex' as const : null,
    };
  };

  const getResolvedPositionEstimatedValue = (position: PortfolioPosition) => (
    getResolvedPositionQuote(position).currentTotalValue ?? position.amount_in_currency
  );

  const getResolvedPositionCurrentResult = (position: PortfolioPosition): number | null => {
    const quote = getResolvedPositionQuote(position);
    if (quote.performanceCurrentValue === null) {
      return null;
    }
    return quote.performanceCurrentValue - getPositionEntryAmount(position);
  };

  const summaryByAccountId = useMemo(
    () => summaryItems.reduce<Record<number, PortfolioSummaryItem>>((acc, item) => {
      acc[item.investment_account_id] = item;
      return acc;
    }, {}),
    [summaryItems],
  );

  const totalInvestedPrincipalInBase = useMemo(
    () => openPositions.reduce((sum, position) => sum + getPositionInvestedPrincipal(position), 0),
    [openPositions],
  );

  const totalRealizedIncomeInBase = useMemo(
    () => summaryItems.reduce((sum, item) => sum + item.realized_income_in_base, 0),
    [summaryItems],
  );

  const totalInvestmentCashInBase = useMemo(
    () => summaryItems.reduce((sum, item) => sum + item.cash_balance_in_base, 0),
    [summaryItems],
  );

  const totalNetContributedInBase = useMemo(
    () => summaryItems.reduce((sum, item) => sum + Number(item.net_contributed_in_base ?? 0), 0),
    [summaryItems],
  );

  // For each open position: MOEX-priced shares at market value, everything else at cost (amount_in_currency)
  const { totalPositionsValue, totalPricedMarketValue, totalPricedEntry, totalUnrealizedPnl, hasPricedPositions } = useMemo(() => {
    let total = 0;
    let pricedMarket = 0;
    let pricedEntry = 0;
    let unrealized = 0;
    let count = 0;
    for (const pos of openPositions) {
      total += getResolvedPositionEstimatedValue(pos);
      const currentResult = getResolvedPositionCurrentResult(pos);
      if (currentResult !== null) {
        pricedMarket += getPositionEntryAmount(pos) + currentResult;
        pricedEntry += getPositionEntryAmount(pos);
        count++;
        unrealized += currentResult;
      }
    }
    return {
      totalPositionsValue: total,
      totalPricedMarketValue: pricedMarket,
      totalPricedEntry: pricedEntry,
      totalUnrealizedPnl: unrealized,
      hasPricedPositions: count > 0,
    };
  }, [openPositions, moexPrices, tinkoffLivePrices]);

  // Total = positions at market/cost + uninvested cash
  // Realized income is NOT added separately — it's already in cash or reinvested in positions
  const totalRealPortfolioValue = totalPositionsValue + totalInvestmentCashInBase;

  const totalWithPotential = useMemo(
    () => openPositions.reduce((sum, pos) => {
      let val = getResolvedPositionEstimatedValue(pos);
      if (pos.asset_type_code === 'deposit') {
        const accrued = typeof pos.metadata?.accrued_interest === 'number' ? pos.metadata.accrued_interest : 0;
        val += accrued;
      }
      return sum + val;
    }, totalInvestmentCashInBase),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [openPositions, moexPrices, tinkoffLivePrices, totalInvestmentCashInBase],
  );

  const heroDisplayedPortfolioValue = valueMode === 'potential' ? totalWithPotential : totalRealPortfolioValue;
  const heroExternalPnl = heroDisplayedPortfolioValue - totalNetContributedInBase;
  const heroCostBasisPnl = totalUnrealizedPnl;
  const heroPnlValue = heroPnlMode === 'external' ? heroExternalPnl : heroCostBasisPnl;
  const heroPnlBase = heroPnlMode === 'external' ? totalNetContributedInBase : totalInvestedPrincipalInBase;
  const heroPnlPercent = heroPnlBase > 0 ? (heroPnlValue / heroPnlBase) * 100 : 0;
  const canToggleHeroPnl = totalNetContributedInBase > 0 && hasPricedPositions && totalInvestedPrincipalInBase > 0;
  const shouldShowHeroPnl = heroPnlBase > 0 && (heroPnlMode === 'external' || hasPricedPositions);

  const depositAccruedItems = useMemo(
    () => openPositions
      .filter((p) => p.asset_type_code === 'deposit')
      .map((p) => ({ title: p.title, accrued: typeof p.metadata?.accrued_interest === 'number' ? p.metadata.accrued_interest as number : 0, currency: p.currency_code }))
      .filter((p) => p.accrued > 0),
    [openPositions],
  );

  const totalDepositAccrued = useMemo(
    () => depositAccruedItems.reduce((s, p) => s + p.accrued, 0),
    [depositAccruedItems],
  );

  const accountEstimatedValueById = useMemo(
    () => openPositions.reduce<Record<number, number>>((acc, position) => {
      acc[position.investment_account_id] = (acc[position.investment_account_id] ?? 0) + getResolvedPositionEstimatedValue(position);
      return acc;
    }, {}),
    [openPositions, moexPrices, tinkoffLivePrices],
  );

  const accountOpenPrincipalById = useMemo(
    () => openPositions.reduce<Record<number, number>>((acc, position) => {
      acc[position.investment_account_id] = (acc[position.investment_account_id] ?? 0) + getPositionInvestedPrincipal(position);
      return acc;
    }, {}),
    [openPositions],
  );

  const accountCurrentResultById = useMemo(
    () => openPositions.reduce<Record<number, number>>((acc, position) => {
      const currentResult = getResolvedPositionCurrentResult(position);
      if (currentResult !== null) {
        acc[position.investment_account_id] = (acc[position.investment_account_id] ?? 0) + currentResult;
      }
      return acc;
    }, {}),
    [openPositions, moexPrices, tinkoffLivePrices],
  );

  const getConnectedSecurityMetrics = (accountId: number) => {
    const estimatedValue = accountEstimatedValueById[accountId] ?? 0;
    const investedPrincipal = accountOpenPrincipalById[accountId] ?? 0;
    return {
      estimatedValue,
      investedPrincipal,
      currentResult: accountCurrentResultById[accountId] ?? 0,
      cashValue: summaryByAccountId[accountId]?.cash_balance_in_base ?? 0,
    };
  };

  const getAccountBalanceForCurrency = (bankAccountId: number, currencyCode: string): number => (
    accounts.find(({ account }) => account.id === bankAccountId)?.balances.find((balance) => balance.currency_code === currencyCode)?.amount ?? 0
  );

  const getDraftPositionFallback = (positionId: number): PortfolioPosition => (
    positions.find((position) => position.id === positionId) ?? {
      id: positionId,
      investment_account_id: 0,
      investment_account_name: '',
      investment_account_owner_type: 'user',
      investment_account_owner_name: '',
      asset_type_code: 'security',
      title: '',
      status: 'open',
      amount_in_currency: 0,
      currency_code: user.base_currency_code,
      opened_at: todayIso(),
      metadata: {},
      created_by_user_id: user.user_id,
      created_at: '',
    }
  );

  const loadEventsForPosition = async (positionId: number) => {
    setEventsLoadingId(positionId);
    setEventsError(null);

    try {
      const loadedEvents = await fetchPortfolioEvents(positionId);
      setEventsByPosition((prev) => ({ ...prev, [positionId]: loadedEvents }));
    } catch (reason: unknown) {
      setEventsError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setEventsLoadingId(null);
    }
  };

  const handleOpenPositionDetails = async (positionId: number) => {
    setSelectedPositionId(positionId);
    if (!eventsByPosition[positionId]) {
      await loadEventsForPosition(positionId);
    }
  };

  const handleClosePosition = async (positionId: number, event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const draft = closeDrafts[positionId];

    if (!draft || !draft.amount.trim() || submittingCloseId === positionId) {
      return;
    }

    setSubmittingCloseId(positionId);
    setCloseError(null);

    try {
      await closePortfolioPosition(positionId, {
        close_amount_in_currency: Number(draft.amount),
        close_currency_code: draft.currencyCode,
        close_amount_in_base: draft.currencyCode === user.base_currency_code || !draft.baseAmount.trim()
          ? undefined
          : Number(draft.baseAmount),
        closed_at: draft.closedAt || undefined,
        comment: draft.comment.trim() || undefined,
      });
      setCloseDrafts((prev) => {
        const nextDrafts = { ...prev };
        delete nextDrafts[positionId];
        return nextDrafts;
      });
      if (selectedPositionId === positionId) {
        await loadEventsForPosition(positionId);
      }
      await loadPortfolio();
    } catch (reason: unknown) {
      setCloseError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSubmittingCloseId(null);
    }
  };

  const handleOpenCloseForm = (position: PortfolioPosition) => {
    setCloseError(null);
    setCloseDrafts((prev) => (
      prev[position.id]
        ? prev
        : { ...prev, [position.id]: createInitialCloseDraft(position) }
    ));
  };

  const handleOpenIncomeForm = (position: PortfolioPosition) => {
    setIncomeError(null);
    setIncomeDrafts((prev) => (
      prev[position.id]
        ? prev
        : { ...prev, [position.id]: createInitialIncomeDraft(position) }
    ));
  };

  const handleOpenTopUpForm = (position: PortfolioPosition) => {
    setTopUpError(null);
    setTopUpDrafts((prev) => (
      prev[position.id]
        ? prev
        : { ...prev, [position.id]: createInitialTopUpDraft(position) }
    ));
  };

  const handleOpenPartialCloseForm = (position: PortfolioPosition) => {
    setPartialCloseError(null);
    setPartialCloseDrafts((prev) => (
      prev[position.id]
        ? prev
        : { ...prev, [position.id]: createInitialPartialCloseDraft(position) }
    ));
  };

  const handleOpenFeeForm = (position: PortfolioPosition) => {
    setFeeError(null);
    setFeeDrafts((prev) => (
      prev[position.id]
        ? prev
        : { ...prev, [position.id]: createInitialFeeDraft(position) }
    ));
  };

  const handleCloseDraftChange = (
    positionId: number,
    patch: Partial<CloseDraft>,
  ) => {
    setCloseDrafts((prev) => ({
      ...prev,
      [positionId]: {
        ...(prev[positionId] ?? {
          amount: '',
          currencyCode: positions.find((position) => position.id === positionId)?.currency_code ?? user.base_currency_code,
          baseAmount: '',
          closedAt: todayIso(),
          comment: '',
        }),
        ...patch,
      },
    }));
  };

  const handleIncomeDraftChange = (
    positionId: number,
    patch: Partial<IncomeDraft>,
  ) => {
    setIncomeDrafts((prev) => ({
      ...prev,
      [positionId]: {
        ...(prev[positionId] ?? createInitialIncomeDraft(getDraftPositionFallback(positionId))),
        ...patch,
      },
    }));
  };

  const handleTopUpDraftChange = (
    positionId: number,
    patch: Partial<TopUpDraft>,
  ) => {
    setTopUpDrafts((prev) => ({
      ...prev,
      [positionId]: {
        ...(prev[positionId] ?? createInitialTopUpDraft(getDraftPositionFallback(positionId))),
        ...patch,
      },
    }));
  };

  const handlePartialCloseDraftChange = (
    positionId: number,
    patch: Partial<PartialCloseDraft>,
  ) => {
    setPartialCloseDrafts((prev) => ({
      ...prev,
      [positionId]: {
        ...(prev[positionId] ?? createInitialPartialCloseDraft(getDraftPositionFallback(positionId))),
        ...patch,
      },
    }));
  };

  const handleFeeDraftChange = (
    positionId: number,
    patch: Partial<FeeDraft>,
  ) => {
    setFeeDrafts((prev) => ({
      ...prev,
      [positionId]: {
        ...(prev[positionId] ?? createInitialFeeDraft(getDraftPositionFallback(positionId))),
        ...patch,
      },
    }));
  };

  const handleRecordIncome = async (position: PortfolioPosition, event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const draft = incomeDrafts[position.id];

    if (!draft || !draft.amount.trim() || submittingIncomeId === position.id) {
      return;
    }

    setSubmittingIncomeId(position.id);
    setIncomeError(null);

    try {
      await recordPortfolioIncome(position.id, {
        amount: Number(draft.amount),
        currency_code: draft.currencyCode,
        amount_in_base: draft.currencyCode === user.base_currency_code || !draft.baseAmount.trim()
          ? undefined
          : Number(draft.baseAmount),
        income_kind: draft.incomeKind,
        destination: draft.destination,
        received_at: draft.receivedAt || undefined,
        comment: draft.comment.trim() || undefined,
      });
      setIncomeDrafts((prev) => {
        const nextDrafts = { ...prev };
        delete nextDrafts[position.id];
        return nextDrafts;
      });
      if (selectedPositionId === position.id) {
        await loadEventsForPosition(position.id);
      }
      await loadPortfolio();
    } catch (reason: unknown) {
      setIncomeError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSubmittingIncomeId(null);
    }
  };

  const handleTopUpPosition = async (position: PortfolioPosition, event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const draft = topUpDrafts[position.id];

    if (!draft || !draft.amount.trim() || submittingTopUpId === position.id) {
      return;
    }

    const availableAmount = getAccountBalanceForCurrency(position.investment_account_id, draft.currencyCode);

    if (Number(draft.amount) > availableAmount) {
      setTopUpError('Недостаточно денег на инвестиционном счете для пополнения позиции.');
      return;
    }

    setSubmittingTopUpId(position.id);
    setTopUpError(null);

    try {
      await topUpPortfolioPosition(position.id, {
        amount_in_currency: Number(draft.amount),
        currency_code: draft.currencyCode,
        quantity: draft.quantity.trim() ? Number(draft.quantity) : undefined,
        topped_up_at: draft.toppedUpAt || undefined,
        comment: draft.comment.trim() || undefined,
      });
      setTopUpDrafts((prev) => {
        const nextDrafts = { ...prev };
        delete nextDrafts[position.id];
        return nextDrafts;
      });
      if (selectedPositionId === position.id) {
        await loadEventsForPosition(position.id);
      }
      await loadPortfolio();
    } catch (reason: unknown) {
      setTopUpError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSubmittingTopUpId(null);
    }
  };

  const handlePartialClosePosition = async (position: PortfolioPosition, event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const draft = partialCloseDrafts[position.id];

    if (!draft || !draft.returnAmount.trim() || !draft.principalReduction.trim() || submittingPartialCloseId === position.id) {
      return;
    }

    const principalReduction = Number(draft.principalReduction);
    const closedQuantity = draft.closedQuantity.trim() ? Number(draft.closedQuantity) : undefined;

    if (principalReduction >= position.amount_in_currency) {
      setPartialCloseError('Частичное закрытие должно оставлять положительный остаток. Для полного выхода используй закрытие позиции.');
      return;
    }

    if (position.quantity !== null && position.quantity !== undefined) {
      if (!draft.closedQuantity.trim()) {
        setPartialCloseError('Для позиции с количеством нужно указать, сколько единиц закрывается.');
        return;
      }

      if ((closedQuantity ?? 0) >= position.quantity) {
        setPartialCloseError('Частичное закрытие по количеству должно быть меньше текущего количества.');
        return;
      }
    }

    setSubmittingPartialCloseId(position.id);
    setPartialCloseError(null);

    try {
      await partialClosePortfolioPosition(position.id, {
        return_amount_in_currency: Number(draft.returnAmount),
        return_currency_code: draft.returnCurrencyCode,
        principal_reduction_in_currency: principalReduction,
        return_amount_in_base: draft.returnCurrencyCode === user.base_currency_code || !draft.returnBaseAmount.trim()
          ? undefined
          : Number(draft.returnBaseAmount),
        closed_quantity: closedQuantity,
        closed_at: draft.closedAt || undefined,
        comment: draft.comment.trim() || undefined,
      });
      setPartialCloseDrafts((prev) => {
        const nextDrafts = { ...prev };
        delete nextDrafts[position.id];
        return nextDrafts;
      });
      if (selectedPositionId === position.id) {
        await loadEventsForPosition(position.id);
      }
      await loadPortfolio();
    } catch (reason: unknown) {
      setPartialCloseError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSubmittingPartialCloseId(null);
    }
  };

  const handleRecordFee = async (position: PortfolioPosition, event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const draft = feeDrafts[position.id];

    if (!draft || !draft.amount.trim() || submittingFeeId === position.id) {
      return;
    }

    const availableAmount = getAccountBalanceForCurrency(position.investment_account_id, draft.currencyCode);
    if (Number(draft.amount) > availableAmount) {
      setFeeError('Недостаточно денег на инвестиционном счете для списания комиссии.');
      return;
    }

    setSubmittingFeeId(position.id);
    setFeeError(null);

    try {
      await recordPortfolioFee(position.id, {
        amount: Number(draft.amount),
        currency_code: draft.currencyCode,
        charged_at: draft.chargedAt || undefined,
        comment: draft.comment.trim() || undefined,
      });
      setFeeDrafts((prev) => {
        const nextDrafts = { ...prev };
        delete nextDrafts[position.id];
        return nextDrafts;
      });
      if (selectedPositionId === position.id) {
        await loadEventsForPosition(position.id);
      }
      await loadPortfolio();
    } catch (reason: unknown) {
      setFeeError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSubmittingFeeId(null);
    }
  };

  const handleChangeRate = async (position: PortfolioPosition, event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const draft = rateChangeDrafts[position.id];

    if (!draft || !draft.newRate.trim() || submittingRateChangeId === position.id) {
      return;
    }

    setSubmittingRateChangeId(position.id);
    setRateChangeError(null);

    try {
      await changeDepositRate(position.id, {
        new_rate: Number(draft.newRate),
        effective_date: draft.effectiveDate || undefined,
      });
      setRateChangeDrafts((prev) => {
        const nextDrafts = { ...prev };
        delete nextDrafts[position.id];
        return nextDrafts;
      });
      if (selectedPositionId === position.id) {
        await loadEventsForPosition(position.id);
      }
      await loadPortfolio();
    } catch (reason: unknown) {
      setRateChangeError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSubmittingRateChangeId(null);
    }
  };

  const handleDeletePosition = async (position: PortfolioPosition) => {
    const isConfirmed = window.confirm(
      'Удалить незакрытую позицию? Это возможно только если по ней еще нет доходов и других событий.',
    );

    if (!isConfirmed) {
      return;
    }

    setDeletingPositionId(position.id);
    setDeleteError(null);

    try {
      await deletePortfolioPosition(position.id);
      if (selectedPositionId === position.id) {
        setSelectedPositionId(null);
      }
      await loadPortfolio();
    } catch (reason: unknown) {
      setDeleteError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setDeletingPositionId(null);
    }
  };

  const handleCancelIncome = async (positionId: number, eventId: number) => {
    const isConfirmed = window.confirm(
      'Отменить этот доход? На инвестиционном счете будет создана отдельная корректировка.',
    );

    if (!isConfirmed) {
      return;
    }

    setCancellingIncomeEventId(eventId);
    setCancelIncomeError(null);

    try {
      await cancelPortfolioIncome(eventId);
      if (selectedPositionId === positionId) {
        await loadEventsForPosition(positionId);
      }
      await loadPortfolio();
    } catch (reason: unknown) {
      setCancelIncomeError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setCancellingIncomeEventId(null);
    }
  };

  const selectedPosition = useMemo(
    () => positions.find((position) => position.id === selectedPositionId) ?? null,
    [positions, selectedPositionId],
  );

  const selectedPositionEvents = selectedPosition ? (eventsByPosition[selectedPosition.id] ?? []) : [];

  const selectedPositionCancelledIncomeIds = useMemo(
    () => new Set(
      selectedPositionEvents
        .filter((item) => item.event_type === 'adjustment' && item.metadata?.action === 'cancel_income')
        .map((item) => Number(item.metadata?.cancelled_event_id))
        .filter((value) => Number.isFinite(value)),
    ),
    [selectedPositionEvents],
  );

  const filteredOpenPositionGroups = useMemo(() => {
    const grouped = new Map<string, PositionAccountGroup>();

    filteredOpenPositions
      .slice()
      .sort((left, right) => {
        if (left.investment_account_owner_type !== right.investment_account_owner_type) {
          return left.investment_account_owner_type === 'user' ? -1 : 1;
        }

        if (left.investment_account_name !== right.investment_account_name) {
          return left.investment_account_name.localeCompare(right.investment_account_name, 'ru');
        }

        return left.title.localeCompare(right.title, 'ru');
      })
      .forEach((position) => {
        const key = `${position.investment_account_owner_type}:${position.investment_account_id}`;
        const group = grouped.get(key);

        if (group) {
          group.positions.push(position);
          return;
        }

        grouped.set(key, {
          accountId: position.investment_account_id,
          accountName: position.investment_account_name,
          ownerType: position.investment_account_owner_type,
          positions: [position],
        });
      });

    return Array.from(grouped.values());
  }, [filteredOpenPositions]);

  const accountTabs = useMemo<PositionAccountTab[]>(() => {
    const getGroupEstimatedValue = (group: PositionAccountGroup): number => {
      if (activeAssetTypeCode === 'security') {
        return getConnectedSecurityMetrics(group.accountId).estimatedValue;
      }
      return group.positions.reduce((sum, position) => sum + getResolvedPositionEstimatedValue(position), 0);
    };

    const scopedTabs = filteredOpenPositionGroups.map((group) => ({
      key: `${group.ownerType}:${group.accountId}`,
      accountName: group.accountName,
      ownerLabel: group.ownerType === 'family' ? 'Семейный счет' : 'Личный счет',
      openCount: group.positions.length,
      estimatedValue: getGroupEstimatedValue(group),
    }));

    if (scopedTabs.length <= 1) {
      return scopedTabs;
    }

    return [{
      key: 'all',
      accountName: 'Все счета',
      ownerLabel: null,
      openCount: filteredOpenPositions.length,
      estimatedValue: filteredOpenPositionGroups.reduce((sum, group) => sum + getGroupEstimatedValue(group), 0),
    }, ...scopedTabs];
  }, [
    accountEstimatedValueById,
    accountOpenPrincipalById,
    activeAssetTypeCode,
    filteredOpenPositionGroups,
    filteredOpenPositions.length,
    moexPrices,
    summaryByAccountId,
    tinkoffLivePrices,
  ]);

  useEffect(() => {
    const fallbackKey = accountTabs[0]?.key ?? 'all';
    if (!accountTabs.some((tab) => tab.key === activeAccountTabKey)) {
      setActiveAccountTabKey(fallbackKey);
    }
  }, [activeAccountTabKey, accountTabs]);

  const activeAccountTab = useMemo(
    () => accountTabs.find((tab) => tab.key === activeAccountTabKey) ?? accountTabs[0] ?? null,
    [activeAccountTabKey, accountTabs],
  );


  const visibleOpenPositions = useMemo(
    () => (
      activeAccountTabKey === 'all'
        ? filteredOpenPositions
        : filteredOpenPositions.filter((position) => getPositionAccountKey(position) === activeAccountTabKey)
    ),
    [activeAccountTabKey, filteredOpenPositions],
  );

  const visibleClosedPositions = useMemo(
    () => (
      activeAccountTabKey === 'all'
        ? filteredClosedPositions
        : filteredClosedPositions.filter((position) => getPositionAccountKey(position) === activeAccountTabKey)
    ),
    [activeAccountTabKey, filteredClosedPositions],
  );

  const visibleAssetPositions = useMemo(() => {
    const typeFiltered = activeAssetTypeCode === 'all'
      ? positions
      : positions.filter((position) => position.asset_type_code === activeAssetTypeCode);
    return activeAccountTabKey === 'all'
      ? typeFiltered
      : typeFiltered.filter((position) => getPositionAccountKey(position) === activeAccountTabKey);
  }, [activeAccountTabKey, activeAssetTypeCode, positions]);

  const visibleOpenPositionGroups = useMemo(
    () => (
      activeAccountTabKey === 'all'
        ? filteredOpenPositionGroups
        : filteredOpenPositionGroups.filter((group) => `${group.ownerType}:${group.accountId}` === activeAccountTabKey)
    ),
    [activeAccountTabKey, filteredOpenPositionGroups],
  );

  const activeScopeDisplayMetrics = useMemo(() => {
    if (activeAssetTypeCode === 'all') {
      return {
        estimatedValue: totalPositionsValue,
        investedPrincipal: totalInvestedPrincipalInBase,
        cashValue: totalInvestmentCashInBase,
        resultValue: hasPricedPositions ? totalUnrealizedPnl : totalRealizedIncomeInBase,
        resultLabel: 'Доход',
      };
    }
    if (activeAssetTypeCode === 'security') {
      let estimatedValue = 0;
      let investedPrincipal = 0;
      let currentResult = 0;

      for (const group of visibleOpenPositionGroups) {
        const metrics = getConnectedSecurityMetrics(group.accountId);
        estimatedValue += metrics.estimatedValue;
        investedPrincipal += metrics.investedPrincipal;
        currentResult += metrics.currentResult;
      }

      return {
        estimatedValue,
        investedPrincipal,
        cashValue: visibleOpenPositionGroups.reduce((sum, group) => sum + getConnectedSecurityMetrics(group.accountId).cashValue, 0),
        resultValue: currentResult,
        resultLabel: 'Доход',
      };
    }

    return {
      estimatedValue: visibleOpenPositions.reduce((sum, position) => sum + getResolvedPositionEstimatedValue(position), 0),
      investedPrincipal: visibleOpenPositions.reduce((sum, position) => sum + Number(position.metadata?.amount_in_base ?? 0), 0),
      cashValue: visibleOpenPositionGroups.reduce((sum, group) => sum + getConnectedSecurityMetrics(group.accountId).cashValue, 0),
      resultValue: visibleAssetPositions.reduce((sum, position) => sum + getPositionRealizedResult(position), 0),
      resultLabel: 'Доход',
    };
  }, [
    activeAssetTypeCode,
    accountEstimatedValueById,
    accountOpenPrincipalById,
    hasPricedPositions,
    moexPrices,
    summaryByAccountId,
    tinkoffLivePrices,
    totalInvestedPrincipalInBase,
    totalInvestmentCashInBase,
    totalPositionsValue,
    totalRealizedIncomeInBase,
    totalUnrealizedPnl,
    visibleAssetPositions,
    visibleOpenPositionGroups,
    visibleOpenPositions,
  ]);

  const activeScopeContributedInBase = useMemo(() => {
    if (activeAssetTypeCode === 'all') {
      return totalNetContributedInBase;
    }

    return visibleOpenPositionGroups.reduce(
      (sum, group) => sum + Number(summaryByAccountId[group.accountId]?.net_contributed_in_base ?? 0),
      0,
    );
  }, [activeAssetTypeCode, summaryByAccountId, totalNetContributedInBase, visibleOpenPositionGroups]);

  const activeScopeCurrentValue = activeAssetTypeCode === 'all'
    ? heroDisplayedPortfolioValue
    : activeScopeDisplayMetrics.estimatedValue;
  const activeScopeBaseValue = heroPnlMode === 'external'
    ? activeScopeContributedInBase
    : activeScopeDisplayMetrics.investedPrincipal;
  const activeScopeResultValue = heroPnlMode === 'external'
    ? activeScopeCurrentValue - activeScopeContributedInBase
    : activeScopeDisplayMetrics.resultValue;
  const activeScopeResultPct = activeScopeBaseValue > 0 ? (activeScopeResultValue / activeScopeBaseValue) * 100 : 0;
  const activeScopeBasisLabel = heroPnlMode === 'external' ? 'Внесено' : 'Вложено';
  const canToggleActiveScopeBasis = activeScopeContributedInBase > 0 && activeScopeDisplayMetrics.investedPrincipal > 0;
  const togglePortfolioPnlMode = () => {
    if (canToggleActiveScopeBasis) {
      setHeroPnlMode((mode) => mode === 'external' ? 'cost' : 'external');
    }
  };
  const handlePortfolioPnlKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      togglePortfolioPnlMode();
    }
  };
  const ActiveAssetIcon = activeAssetTypeCode === 'deposit'
    ? Landmark
    : activeAssetTypeCode === 'crypto'
      ? Coins
      : activeAssetTypeCode === 'other'
        ? Package
        : TrendingUp;

  const portfolioAnalyticsBuckets = useMemo<PortfolioAnalyticsBucket[]>(() => {
    if (activeAssetTypeCode !== 'security') {
      return [];
    }

    const totalEstimated = visibleOpenPositions.reduce((sum, position) => sum + getResolvedPositionEstimatedValue(position), 0);
    const buckets = SECURITY_KIND_OPTIONS.map((option) => {
      const sectionPositions = visibleOpenPositions.filter((position) => getSecurityKindCode(position) === option.value);
      const estimatedValue = sectionPositions.reduce((sum, position) => sum + getResolvedPositionEstimatedValue(position), 0);
      const investedPrincipal = sectionPositions.reduce((sum, position) => sum + getPositionInvestedPrincipal(position), 0);
      const currentResult = sectionPositions.reduce((sum, position) => sum + (getResolvedPositionCurrentResult(position) ?? 0), 0);
      return {
        key: option.value,
        label: option.label,
        estimatedValue,
        investedPrincipal,
        currentResult,
        positionsCount: sectionPositions.length,
        share: totalEstimated > 0 ? estimatedValue / totalEstimated : 0,
      };
    }).filter((bucket) => bucket.positionsCount > 0);

    return buckets.sort((left, right) => right.estimatedValue - left.estimatedValue);
  }, [activeAssetTypeCode, moexPrices, tinkoffLivePrices, visibleOpenPositions]);

  const portfolioAnalyticsAccounts = useMemo<PortfolioAnalyticsAccountItem[]>(
    () => visibleOpenPositionGroups.map((group) => {
      const estimatedValue = group.positions.reduce((sum, position) => sum + getResolvedPositionEstimatedValue(position), 0);
      const investedPrincipal = group.positions.reduce((sum, position) => sum + getPositionInvestedPrincipal(position), 0);
      const resultValue = activeAssetTypeCode === 'security'
        ? group.positions.reduce((sum, position) => sum + (getResolvedPositionCurrentResult(position) ?? 0), 0)
        : group.positions.reduce((sum, position) => sum + getPositionRealizedResult(position), 0);
      return {
        key: `${group.ownerType}:${group.accountId}`,
        accountName: group.accountName,
        ownerLabel: group.ownerType === 'family' ? 'Семейный счет' : 'Личный счет',
        estimatedValue,
        investedPrincipal,
        cashValue: summaryByAccountId[group.accountId]?.cash_balance_in_base ?? 0,
        resultValue,
        positionsCount: group.positions.length,
      };
    }).sort((left, right) => right.estimatedValue - left.estimatedValue),
    [activeAssetTypeCode, moexPrices, summaryByAccountId, tinkoffLivePrices, visibleOpenPositionGroups],
  );

  const portfolioAnalyticsLeaders = useMemo<PortfolioAnalyticsLeader[]>(() => {
    const totalEstimated = visibleOpenPositions.reduce((sum, position) => sum + getResolvedPositionEstimatedValue(position), 0);
    return visibleOpenPositions
      .map((position) => {
        const logoName = getPositionMetadataText(position, 'logo_name');
        return {
          positionId: position.id,
          title: position.title,
          ticker: getPositionMetadataText(position, 'ticker'),
          accountName: position.investment_account_name,
          quantity: position.quantity,
          estimatedValue: getResolvedPositionEstimatedValue(position),
          currentResult: getResolvedPositionCurrentResult(position),
          logoUrl: logoName ? getTinkoffInstrumentLogoUrl(logoName) : null,
          share: totalEstimated > 0 ? getResolvedPositionEstimatedValue(position) / totalEstimated : 0,
        };
      })
      .sort((left, right) => right.estimatedValue - left.estimatedValue)
      .slice(0, 8);
  }, [moexPrices, tinkoffLivePrices, visibleOpenPositions]);

  const portfolioAnalyticsScopeLabel = useMemo(() => {
    const assetLabel = activeAssetTab?.label ?? assetTypeLabel(activeAssetTypeCode);
    if (activeAccountTabKey === 'all' || !activeAccountTab) {
      return assetLabel;
    }
    return `${assetLabel} · ${activeAccountTab.accountName}`;
  }, [activeAccountTab, activeAccountTabKey, activeAssetTab, activeAssetTypeCode]);

  const hasMultipleOpenPositionOwners = useMemo(
    () => new Set(visibleOpenPositionGroups.map((group) => group.ownerType)).size > 1,
    [visibleOpenPositionGroups],
  );

  const hasMultipleOpenPositionAccounts = visibleOpenPositionGroups.length > 1;

  const getOpenPositionSections = (positionsForGroup: PortfolioPosition[]): SecuritySection[] => {
    if (activeAssetTypeCode === 'deposit') {
      const termDeposits = positionsForGroup.filter((p) => p.metadata?.deposit_kind === 'term_deposit');
      const savingsAccounts = positionsForGroup.filter((p) => p.metadata?.deposit_kind === 'savings_account');
      const other = positionsForGroup.filter(
        (p) => p.metadata?.deposit_kind !== 'term_deposit' && p.metadata?.deposit_kind !== 'savings_account',
      );
      const sections: SecuritySection[] = [];
      if (termDeposits.length > 0) sections.push({ code: 'term_deposit', label: 'Вклады', positions: termDeposits });
      if (savingsAccounts.length > 0) sections.push({ code: 'savings_account', label: 'Накопительные счета', positions: savingsAccounts });
      if (other.length > 0) sections.push({ code: 'deposit', label: 'Депозиты', positions: other });
      return sections.length > 0 ? sections : [{ code: 'deposit', label: 'Депозиты', positions: positionsForGroup }];
    }

    if (activeAssetTypeCode !== 'security') {
      return [{
        code: activeAssetTypeCode,
        label: activeAssetTab?.label ?? assetTypeLabel(activeAssetTypeCode),
        positions: positionsForGroup,
      }];
    }

    const knownCodes = SECURITY_KIND_OPTIONS.map((option) => option.value);
    const presentCodes = Array.from(new Set(positionsForGroup.map((position) => getSecurityKindCode(position))));
    const extraCodes = presentCodes
      .filter((code) => !knownCodes.includes(code as (typeof SECURITY_KIND_OPTIONS)[number]['value']))
      .sort((left, right) => getSecurityKindLabel(left).localeCompare(getSecurityKindLabel(right), 'ru'));

    return [...knownCodes, ...extraCodes]
      .map((code) => ({
        code,
        label: getSecurityKindLabel(code),
        positions: positionsForGroup.filter((position) => getSecurityKindCode(position) === code),
      }))
      .filter((section) => section.positions.length > 0);
  };

  const switchAssetTab = (direction: 'prev' | 'next') => {
    if (assetTabs.length <= 1) {
      return;
    }

    const currentIndex = assetTabs.findIndex((tab) => tab.code === activeAssetTypeCode);
    const safeIndex = currentIndex >= 0 ? currentIndex : 0;
    const nextIndex = direction === 'next'
      ? (safeIndex + 1) % assetTabs.length
      : (safeIndex - 1 + assetTabs.length) % assetTabs.length;

    setActiveAssetTypeCode(assetTabs[nextIndex].code);
  };

  const handleAssetSwipeStart = (clientX: number) => {
    setAssetSwipeStartX(clientX);
  };

  const handleAssetSwipeEnd = (clientX: number) => {
    if (assetSwipeStartX === null) {
      return;
    }

    const deltaX = clientX - assetSwipeStartX;
    setAssetSwipeStartX(null);

    if (Math.abs(deltaX) < 36) {
      return;
    }

    if (deltaX < 0) {
      switchAssetTab('next');
      return;
    }

    switchAssetTab('prev');
  };

  const switchAccountTab = (direction: 'prev' | 'next') => {
    if (accountTabs.length <= 1) {
      return;
    }

    const currentIndex = accountTabs.findIndex((tab) => tab.key === activeAccountTabKey);
    const safeIndex = currentIndex >= 0 ? currentIndex : 0;
    const nextIndex = direction === 'next'
      ? (safeIndex + 1) % accountTabs.length
      : (safeIndex - 1 + accountTabs.length) % accountTabs.length;

    setActiveAccountTabKey(accountTabs[nextIndex].key);
  };

  const handleAccountSwipeStart = (clientX: number) => {
    setAccountSwipeStartX(clientX);
  };

  const handleAccountSwipeEnd = (clientX: number) => {
    if (accountSwipeStartX === null) {
      return;
    }

    const deltaX = clientX - accountSwipeStartX;
    setAccountSwipeStartX(null);

    if (Math.abs(deltaX) < 36) {
      return;
    }

    if (deltaX < 0) {
      switchAccountTab('next');
      return;
    }

    switchAccountTab('prev');
  };

  const handleCreateAccount = async () => {
    if (!newAccountName.trim() || creatingAccount) return;
    setCreatingAccount(true);
    setCreateAccountError(null);
    try {
      await createBankAccount({
        name: newAccountName.trim(),
        owner_type: newAccountOwnerType,
        account_kind: 'investment',
        investment_asset_type: newAccountAssetType,
        provider_name: newAccountProvider.trim() || undefined,
      });
      setShowNewAccountModal(false);
      setNewAccountStep('pick');
      setNewAccountName('');
      setNewAccountProvider('');
      setNewAccountAssetType('security');
      setNewAccountOwnerType('user');
      await loadPortfolio();
    } catch (err) {
      setCreateAccountError(err instanceof Error ? err.message : 'Ошибка создания счёта');
    } finally {
      setCreatingAccount(false);
    }
  };

  if (loading) {
    return (
      <div className="status-screen">
        <h1>Загрузка...</h1>
        <p>Собираем инвестиционные счета и позиции</p>
      </div>
    );
  }

  return (
    <>
      {error && (
        <p style={{ color: 'var(--neg, #f04)', fontSize: '0.85rem', marginBottom: 12 }}>
          {error}
        </p>
      )}

      {/* ── Hero ── */}
      <div className="pf-hero">
        <div className="pf-hero__toprow">
          <span className="pf-hero__eyebrow">
            {valueMode === 'potential' ? 'Потенциал с доходом' : 'Сейчас в портфеле'}
          </span>
          <button
            className={`pf-chiptog${valueMode === 'potential' ? ' pf-chiptog--on' : ''}`}
            type="button"
            onClick={() => { setValueMode((v) => v === 'now' ? 'potential' : 'now'); setShowIncomePopup(false); }}
          >
            <span className="pf-chiptog__glyph" aria-hidden="true">{valueMode === 'potential' ? '−' : '+'}</span>
            с доходом
          </button>
        </div>

        <div className="pf-hero__amount">
          <strong className="pf-hero__value">
            {new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(
              heroDisplayedPortfolioValue,
            )}
          </strong>
          <span className="pf-hero__sym">{currencySymbol(user.base_currency_code)}</span>
        </div>

        {shouldShowHeroPnl && (
          <button
            className={`pf-hero__pnl${heroPnlValue >= 0 ? ' pf-hero__pnl--pos' : ' pf-hero__pnl--neg'}`}
            type="button"
            onClick={() => {
              if (canToggleHeroPnl) {
                setHeroPnlMode((mode) => mode === 'external' ? 'cost' : 'external');
              }
            }}
            aria-pressed={heroPnlMode === 'cost'}
            title={canToggleHeroPnl ? 'Переключить расчет дохода' : undefined}
          >
            <span className="pf-hero__pnl-arrow" aria-hidden="true">
              {heroPnlValue >= 0 ? '↗' : '↘'}
            </span>
            <span>
              {heroPnlValue >= 0 ? '+' : '−'}
              {formatNumericAmount(Math.abs(heroPnlValue), 0)}
              <span className="pf-hero__pnl-sym">{currencySymbol(user.base_currency_code)}</span>
            </span>
            <span className="pf-hero__pnl-sep">·</span>
            <span>
              {heroPnlValue >= 0 ? '+' : '−'}
              {new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 }).format(Math.abs(heroPnlPercent))}%
            </span>
            <span className="pf-hero__pnl-period">
              {heroPnlMode === 'external' ? 'к внесенным' : 'к вложенному'}
            </span>
          </button>
        )}

        {assetTabs.filter((t) => t.code !== 'all').map((tab) => (
          <button
            key={tab.code}
            type="button"
            className="pf-hero__row"
            onClick={() => setHeroTypeSheetCode(tab.code)}
          >
            <span className={`pf-hero__row-dot pf-hero__row-dot--${tab.code}`} />
            <span className="pf-hero__row-label">{tab.label}</span>
            <span className="pf-hero__row-value">
              {new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(tab.totalInBase)}
              <span className="pf-hero__row-sym">{currencySymbol(user.base_currency_code)}</span>
            </span>
            <span className="pf-hero__row-chev">›</span>
          </button>
        ))}

        {valueMode === 'potential' && totalDepositAccrued > 0 && (
          <div className="pf-hero__income-row">
            <button
              type="button"
              className="pf-hero__income-trigger"
              onClick={() => setShowIncomePopup((v) => !v)}
            >
              <Info size={13} strokeWidth={2.2} className="pf-hero__income-ico" />
              <span className="pf-hero__income-label">
                +{formatAmount(totalDepositAccrued, user.base_currency_code)} начислено
              </span>
              <span className={`pf-hero__income-chev${showIncomePopup ? ' pf-hero__income-chev--open' : ''}`}>›</span>
            </button>
            {showIncomePopup && (
              <div className="pf-income-popup">
                <div className="pf-income-popup__title">Начисленный доход</div>
                <div className="pf-income-popup__rows">
                  {depositAccruedItems.map((item) => (
                    <div key={item.title} className="pf-income-popup__row">
                      <span className="pf-income-popup__row-name">{item.title}</span>
                      <span className="pf-income-popup__row-val">+{formatAmount(item.accrued, item.currency)}</span>
                    </div>
                  ))}
                </div>
                <div className="pf-income-popup__note">
                  Выплатится при закрытии вклада
                </div>
              </div>
            )}
          </div>
        )}

      </div>

      {/* ── Asset type tabs + add button ── */}
      <div className="tabs-row">
        <div
          className="tabs"
          role="tablist"
          onTouchStart={(e) => handleAssetSwipeStart(e.touches[0].clientX)}
          onTouchEnd={(e) => handleAssetSwipeEnd(e.changedTouches[0].clientX)}
        >
          {assetTabs.map((tab) => (
            <button
              key={tab.code}
              role="tab"
              type="button"
              className={`tabs__item${activeAssetTypeCode === tab.code ? ' tabs__item--on' : ''}`}
              aria-selected={activeAssetTypeCode === tab.code}
              onClick={() => setActiveAssetTypeCode(tab.code)}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <button
          className="tabs-add-btn tabs-add-btn--yellow"
          type="button"
          aria-label="Новый инвестиционный счёт"
          onClick={() => {
            setNewAccountAssetType('security');
            setNewAccountStep('pick');
            setShowNewAccountModal(true);
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <path d="M12 5v14M5 12h14" />
          </svg>
        </button>
      </div>

      {/* ── View switcher ── */}
      <div className="pf-viewtog" role="tablist">
        {(['positions', 'ops', 'analytics'] as const).map((view) => (
          <button
            key={view}
            role="tab"
            type="button"
            className={`pf-viewtog__opt${portfolioView === view ? ' pf-viewtog__opt--on' : ''}`}
            aria-selected={portfolioView === view}
            onClick={() => setPortfolioView(view)}
          >
            {view === 'positions' ? 'Позиции' : view === 'ops' ? 'Операции' : 'Аналитика'}
          </button>
        ))}
      </div>

      {/* ══ Positions pane ══ */}
      {portfolioView === 'positions' && (
        <div className="pf-view">
          {activeAssetTypeCode !== 'all' && filteredOpenPositions.length > 0 && (
            <div
              className="pf-tsum pf-tsum--button"
              role="button"
              tabIndex={0}
              onClick={togglePortfolioPnlMode}
              onKeyDown={handlePortfolioPnlKeyDown}
              aria-pressed={heroPnlMode === 'external'}
              title={canToggleActiveScopeBasis ? 'Переключить расчет дохода' : undefined}
            >
              <div className="pf-tsum__head">
                <div className={`pf-tsum__icon pf-tsum__icon--${activeAssetTypeCode}`} aria-hidden="true">
                  <ActiveAssetIcon size={22} strokeWidth={2.4} />
                </div>
                <div className="pf-tsum__titlebox">
                  <div className="pf-tsum__title">{activeAssetTab?.label ?? assetTypeLabel(activeAssetTypeCode)}</div>
                  <div className="pf-tsum__meta">
                    {filteredOpenPositions.length} {pluralRu(filteredOpenPositions.length, ['позиция', 'позиции', 'позиций'])}
                    <span>·</span>
                    {visibleOpenPositionGroups.length} {pluralRu(visibleOpenPositionGroups.length, ['счёт', 'счёта', 'счетов'])}
                  </div>
                </div>
              </div>
              <div className="pf-tsum__now">
                <div className="pf-tsum__now-label">{valueMode === 'now' ? 'Сейчас' : 'С доходом'}</div>
                <div className="pf-tsum__now-row">
                  <div className="pf-tsum__now-value">
                    {new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(activeScopeDisplayMetrics.estimatedValue)}
                    <span className="pf-sym">{currencySymbol(user.base_currency_code)}</span>
                  </div>
                  {activeScopeBaseValue > 0 && (() => {
                    const rv = activeScopeResultValue;
                    const pct = activeScopeResultPct;
                    const isPos = rv >= 0;
                    return (
                      <span className={`pf-tsum__delta${isPos ? ' pf-tsum__delta--pos' : ' pf-tsum__delta--neg'}`}>
                        {isPos ? '+' : ''}{new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(rv)}{currencySymbol(user.base_currency_code)}
                        <span className="pf-tsum__delta-sep">·</span>
                        {isPos ? '+' : ''}{pct.toFixed(1)}%
                      </span>
                    );
                  })()}
                </div>
                <div className="pf-tsum__now-period">{activeScopeDisplayMetrics.resultLabel}</div>
              </div>
              <div className="pf-tsum__grid">
                <div className="pf-tsum__cell">
                  <div className="pf-tsum__cell-label">{activeScopeBasisLabel}</div>
                  <div className="pf-tsum__cell-value">
                    {new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(activeScopeBaseValue)}
                    <span className="pf-sym">{currencySymbol(user.base_currency_code)}</span>
                  </div>
                </div>
                <div className="pf-tsum__cell pf-tsum__cell--mid">
                  <div className="pf-tsum__cell-label">{activeScopeDisplayMetrics.resultLabel}</div>
                  <div className={`pf-tsum__cell-value${activeScopeResultValue >= 0 ? ' pf-tsum__cell-value--pos' : ' pf-tsum__cell-value--neg'}`}>
                    {activeScopeResultValue >= 0 ? '+' : ''}
                    {new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(activeScopeResultValue)}
                    <span className="pf-sym">{currencySymbol(user.base_currency_code)}</span>
                  </div>
                  {activeScopeBaseValue > 0 && (
                    <div className="pf-tsum__cell-note">
                      {activeScopeResultValue >= 0 ? '+' : ''}
                      {activeScopeResultPct.toFixed(1)}%
                    </div>
                  )}
                </div>
                <div className="pf-tsum__cell">
                  <div className="pf-tsum__cell-label">Свободно</div>
                  <div className="pf-tsum__cell-value">
                    {new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(activeScopeDisplayMetrics.cashValue)}
                    <span className="pf-sym">{currencySymbol(user.base_currency_code)}</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeAssetTypeCode === 'all' && openPositions.length > 0 && (() => {
            const typeTabs = assetTabs.filter((t) => t.code !== 'all' && t.totalInBase > 0);
            const total = typeTabs.reduce((s, t) => s + t.totalInBase, 0);
            const basisValue = activeScopeBaseValue;
            const income = activeScopeResultValue;
            const incomeIsPos = income >= 0;
            const incomePct = activeScopeResultPct;
            const fmt = (n: number) => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(n);
            const colorMap: Record<string, string> = {
              security: '#0A0B0D', deposit: '#137534', crypto: '#9B1C1C', other: '#4B2D8F',
            };
            return (
              <div
                className="pf-alloc pf-alloc--button"
                role="button"
                tabIndex={0}
                onClick={togglePortfolioPnlMode}
                onKeyDown={handlePortfolioPnlKeyDown}
                aria-pressed={heroPnlMode === 'external'}
                title={canToggleActiveScopeBasis ? 'Переключить расчет дохода' : undefined}
              >
                <div className="pf-alloc__head">
                  <span className="pf-alloc__tag">Распределение</span>
                  <span className="pf-alloc__meta">{typeTabs.length} {typeTabs.length === 1 ? 'тип' : typeTabs.length < 5 ? 'типа' : 'типов'}</span>
                </div>
                <div className="pf-alloc__bar" role="img" aria-label="Распределение по типам активов">
                  {typeTabs.map((t) => (
                    <span
                      key={t.code}
                      className="pf-alloc__seg"
                      style={{ flex: t.totalInBase, background: colorMap[t.code] ?? '#999' }}
                    />
                  ))}
                </div>
                <ul className="pf-alloc__legend">
                  {typeTabs.map((t) => (
                    <li key={t.code}>
                      <span className="pf-alloc__dot" style={{ background: colorMap[t.code] ?? '#999' }} />
                      {t.label}
                      <em>{total > 0 ? ((t.totalInBase / total) * 100).toFixed(1) : '0'}%</em>
                    </li>
                  ))}
                </ul>
                <div className="pf-alloc__totals">
                  <div className="pf-alloc__t-cell">
                    <span>{activeScopeBasisLabel}</span>
                    <strong>{fmt(basisValue)}<span className="pf-sym">{currencySymbol(user.base_currency_code)}</span></strong>
                    <em className="pf-alloc__t-placeholder" aria-hidden="true">&nbsp;</em>
                  </div>
                  <span className="pf-alloc__t-sep" />
                  <div className="pf-alloc__t-cell">
                    <span>Доход</span>
                    <strong className={incomeIsPos ? 'pf-alloc__t-pos' : 'pf-alloc__t-neg'}>
                      {incomeIsPos ? '+' : ''}{fmt(income)}<span className="pf-sym">{currencySymbol(user.base_currency_code)}</span>
                    </strong>
                    <em className={incomeIsPos ? 'pf-alloc__t-pos' : 'pf-alloc__t-neg'}>
                      {incomeIsPos ? '+' : ''}{incomePct.toFixed(1)}%
                    </em>
                  </div>
                </div>
              </div>
            );
          })()}

          <div className="pf-sec__head">
            <div>
              <h2 className="pf-sec__title">Позиции</h2>
              <span className="pf-sec__sub">
                {activeAssetTypeCode === 'all'
                  ? 'Сгруппированы по счёту и типу'
                  : `${activeAssetTab?.label ?? assetTypeLabel(activeAssetTypeCode)} — по счёту`}
              </span>
            </div>
            <button
              className="pf-add-pill"
              type="button"
              onClick={() => {
                setAddSheetTypeCode(activeAssetTypeCode === 'all' ? null : activeAssetTypeCode);
                setAddSheetOpen(true);
              }}
              disabled={accounts.length === 0}
            >
              + Новая
            </button>
          </div>

          {accounts.length === 0 ? (
            <p className="pf-empty">Создай инвестиционный счёт в Настройках, затем добавь позиции.</p>
          ) : visibleOpenPositions.length === 0 ? (
            <p className="pf-empty">Открытых позиций нет.</p>
          ) : (
            visibleOpenPositionGroups.map((group) => {
              const sections = getOpenPositionSections(group.positions);
              const groupValue = activeAssetTypeCode === 'security'
                ? getConnectedSecurityMetrics(group.accountId).estimatedValue
                : group.positions.reduce((s, p) => s + getResolvedPositionEstimatedValue(p), 0);
              return (
                <div key={`${group.ownerType}-${group.accountId}`} className="pf-grp">
                  <div className="pf-grp__head">
                    <div>
                      <div className="pf-grp__title">{group.accountName}</div>
                      <div className="pf-grp__meta">
                        {group.ownerType === 'family' ? 'Семейный' : 'Личный'} · {group.positions.length} поз.
                      </div>
                    </div>
                    <div className="pf-grp__total">
                      {new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(groupValue)}
                      <span className="pf-sym">{currencySymbol(user.base_currency_code)}</span>
                    </div>
                  </div>
                  {sections.map((section) => (
                    <div key={section.code}>
                      {sections.length > 1 && (
                        <div className="pf-grp__subhead">{section.label}</div>
                      )}
                      {section.positions.map((position) => {
                        const isDeposit = position.asset_type_code === 'deposit' && !!position.metadata?.deposit_kind;
                        const isBond = position.metadata?.moex_market === 'bonds';
                        const posTicker = typeof position.metadata?.ticker === 'string' ? position.metadata.ticker : null;
                        const moexPrice2 = posTicker ? moexPrices.get(posTicker) : null;
                        const quote = getResolvedPositionQuote(position);
                        const entryAmount = getPositionEntryAmount(position);
                        const logoName = getPositionMetadataText(position, 'logo_name');
                        const logoUrl = logoName ? getTinkoffInstrumentLogoUrl(logoName) : null;
                        const unrealizedPnl = getResolvedPositionCurrentResult(position);
                        const pnlPercent = unrealizedPnl !== null && entryAmount > 0
                          ? (unrealizedPnl / entryAmount) * 100 : null;
                        const depositAccrued = isDeposit && typeof position.metadata?.accrued_interest === 'number'
                          ? position.metadata.accrued_interest as number : 0;
                        const displayValue = isDeposit
                          ? (valueMode === 'potential' ? position.amount_in_currency + depositAccrued : position.amount_in_currency)
                          : (quote.currentTotalValue ?? position.amount_in_currency);
                        return (
                          <button
                            key={position.id}
                            className="pf-pos"
                            type="button"
                            onClick={() => void handleOpenPositionDetails(position.id)}
                          >
                            <div className="pf-pos__identity">
                              {logoUrl ? (
                                <img className="pf-pos__logo" src={logoUrl} alt="" loading="lazy" />
                              ) : (
                                <div className={`pf-pos__icon pf-pos__icon--${position.asset_type_code}`}>
                                  {position.title.slice(0, 1).toUpperCase()}
                                </div>
                              )}
                              <div className="pf-pos__copy">
                                <div className="pf-pos__title">{position.title}</div>
                                <div className="pf-pos__sub">
                                  {isDeposit ? (
                                    <>
                                      {String(position.metadata.interest_rate)}%
                                      {position.metadata.deposit_kind === 'term_deposit' && position.metadata.end_date
                                        ? ` · до ${formatDateLabel(String(position.metadata.end_date))}`
                                        : ''}
                                    </>
                                  ) : quote.currentPrice !== null && position.quantity ? (
                                    <>
                                      {quote.source === 'tinkoff'
                                        ? formatAmount(quote.currentPrice, position.currency_code)
                                        : isBond
                                          ? `${quote.currentPrice.toFixed(2)}%`
                                          : formatAmount(quote.currentPrice, position.currency_code)}
                                      {` × ${position.quantity}`}
                                      {quote.source === 'moex' && moexPrice2?.last === null ? ' · посл.' : ''}
                                    </>
                                  ) : position.quantity ? (
                                    `${formatAmount(entryAmount / position.quantity, position.currency_code)} × ${position.quantity}`
                                  ) : (
                                    formatAmount(entryAmount, position.currency_code)
                                  )}
                                </div>
                              </div>
                            </div>
                            <div className="pf-pos__right">
                              <div className="pf-pos__amount">
                                {formatNumericAmount(displayValue)}
                                <span className="pf-sym">{currencySymbol(position.currency_code)}</span>
                              </div>
                              {isDeposit && depositAccrued > 0 ? (
                                <div className="pf-pos__pnl pf-pos__pnl--pos">
                                  +{formatAmount(depositAccrued, position.currency_code)}
                                </div>
                              ) : unrealizedPnl !== null && pnlPercent !== null ? (
                                <div className={`pf-pos__pnl${unrealizedPnl >= 0 ? ' pf-pos__pnl--pos' : ' pf-pos__pnl--neg'}`}>
                                  {unrealizedPnl >= 0 ? '+' : ''}{unrealizedPnl.toFixed(0)} ₽
                                  {' '}({pnlPercent >= 0 ? '+' : ''}{pnlPercent.toFixed(1)}%)
                                </div>
                              ) : null}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  ))}
                </div>
              );
            })
          )}

          {visibleClosedPositions.length > 0 && (
            <div className="pf-closed">
              <button
                className="pf-closed__toggle"
                type="button"
                onClick={() => setShowClosedPositions((prev) => !prev)}
              >
                {showClosedPositions ? 'Скрыть закрытые' : `Закрытые (${visibleClosedPositions.length})`}
              </button>
              {showClosedPositions && (
                <div className="pf-grp pf-grp--muted">
                  {visibleClosedPositions.map((position) => (
                    <div key={position.id} className="pf-pos pf-pos--closed">
                      <div className="pf-pos__copy">
                        <div className="pf-pos__title">{position.title}</div>
                        <div className="pf-pos__sub">
                          {position.investment_account_name}
                          {' · '}{formatAmount(position.amount_in_currency, position.currency_code)}
                          {position.close_amount_in_currency && position.close_currency_code
                            ? ` → ${formatAmount(position.close_amount_in_currency, position.close_currency_code)}`
                            : ''}
                          {position.closed_at ? ` · ${formatDateLabel(position.closed_at)}` : ''}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ══ Operations pane ══ */}
      {portfolioView === 'ops' && (
        <div className="pf-view">
          <Operations
            user={user}
            embedded
            initialViewMode="investment"
            allowedModes={['investment']}
          />
        </div>
      )}

      {/* ══ Analytics pane ══ */}
      {portfolioView === 'analytics' && (
        <div className="pf-view portfolio-analytics-view">
          <div className="portfolio-analytics-hero">
            <div>
              <div className="section__eyebrow">Срез</div>
              <h3 className="section__title">{portfolioAnalyticsScopeLabel}</h3>
            </div>
            <div className="portfolio-analytics-summary">
              <div className="portfolio-analytics-metric">
                <span className="portfolio-analytics-metric__label">Оценочная стоимость</span>
                <strong className="portfolio-analytics-metric__value">
                  {formatAmount(activeScopeDisplayMetrics.estimatedValue, user.base_currency_code)}
                </strong>
              </div>
              <div className="portfolio-analytics-metric">
                <span className="portfolio-analytics-metric__label">Вложено</span>
                <strong className="portfolio-analytics-metric__value">
                  {formatAmount(activeScopeDisplayMetrics.investedPrincipal, user.base_currency_code)}
                </strong>
              </div>
              <div className="portfolio-analytics-metric">
                <span className="portfolio-analytics-metric__label">Остаток</span>
                <strong className="portfolio-analytics-metric__value">
                  {formatAmount(activeScopeDisplayMetrics.cashValue, user.base_currency_code)}
                </strong>
              </div>
              <div className="portfolio-analytics-metric">
                <span className="portfolio-analytics-metric__label">{activeScopeDisplayMetrics.resultLabel}</span>
                <strong className={`portfolio-analytics-metric__value${activeScopeDisplayMetrics.resultValue >= 0 ? ' portfolio-analytics-metric__value--pos' : ' portfolio-analytics-metric__value--neg'}`}>
                  {formatAmount(activeScopeDisplayMetrics.resultValue, user.base_currency_code)}
                </strong>
              </div>
            </div>
          </div>

          <div className="pa-period-controls">
            <div className="pa-period-chips">
              {(['month', 'quarter', 'year'] as const).map((pt) => (
                <button
                  key={pt}
                  type="button"
                  className={`analytics-chip${analyticsPeriodType === pt ? ' analytics-chip--active' : ''}`}
                  onClick={() => { setAnalyticsPeriodType(pt); setAnalyticsPeriodOffset(0); }}
                >
                  {pt === 'month' ? 'Месяц' : pt === 'quarter' ? 'Квартал' : 'Год'}
                </button>
              ))}
            </div>
            <div className="pa-period-nav">
              <button type="button" className="pa-period-nav__arrow" onClick={() => setAnalyticsPeriodOffset((o) => o - 1)}>‹</button>
              <span className="pa-period-nav__label">{analyticsPeriodRange.label}</span>
              <button type="button" className="pa-period-nav__arrow" onClick={() => setAnalyticsPeriodOffset((o) => o + 1)}>›</button>
            </div>
          </div>

          {analyticsLoading && (
            <p className="list-row__sub" style={{ textAlign: 'center', padding: 24 }}>Загрузка...</p>
          )}

          {!analyticsLoading && analyticsData && (
            <>
              <div className="portfolio-analytics-summary">
                <div className="portfolio-analytics-metric">
                  <span className="portfolio-analytics-metric__label">Доход за период</span>
                  <strong className={`portfolio-analytics-metric__value${analyticsTotalIncome >= 0 ? ' portfolio-analytics-metric__value--pos' : ' portfolio-analytics-metric__value--neg'}`}>
                    {formatAmount(analyticsTotalIncome, user.base_currency_code)}
                  </strong>
                </div>
                <div className="portfolio-analytics-metric">
                  <span className="portfolio-analytics-metric__label">Результат сделок</span>
                  <strong className={`portfolio-analytics-metric__value${analyticsTotalTrades >= 0 ? ' portfolio-analytics-metric__value--pos' : ' portfolio-analytics-metric__value--neg'}`}>
                    {formatAmount(analyticsTotalTrades, user.base_currency_code)}
                  </strong>
                </div>
              </div>

              {analyticsAssetTypeDonut.length > 0 && (
                <section className="portfolio-analytics-section">
                  <div className="portfolio-analytics-section__head">
                    <div>
                      <div className="section__eyebrow">Доходы за период</div>
                      <h3 className="section__title">По типам активов</h3>
                    </div>
                  </div>
                  <div className="pa-donut-layout">
                    <div className="analytics-donut analytics-donut--glow" style={{ backgroundImage: buildPortfolioDonutGradient(analyticsAssetTypeDonut) }}>
                      <div className="analytics-donut__inner">
                        <strong>{formatAmount(analyticsTotalIncome + analyticsTotalTrades, user.base_currency_code)}</strong>
                        <span className="analytics-donut__label">Итого</span>
                      </div>
                    </div>
                    <div className="analytics-pill-grid">
                      {analyticsAssetTypeDonut.map((segment) => (
                        <div className="analytics-pill" key={segment.key}>
                          <span className="analytics-pill__dot" style={{ background: segment.color }} />
                          <div className="analytics-pill__content">
                            <div className="analytics-pill__title">{segment.label}</div>
                            <div className="analytics-pill__meta">
                              {formatAmount(segment.amount, user.base_currency_code)} · {(segment.share * 100).toFixed(1)}%
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </section>
              )}

              {analyticsIncomeKindDonut.length > 0 && (
                <section className="portfolio-analytics-section">
                  <div className="portfolio-analytics-section__head">
                    <div>
                      <div className="section__eyebrow">Структура дохода</div>
                      <h3 className="section__title">По типам дохода</h3>
                    </div>
                  </div>
                  <div className="pa-donut-layout">
                    <div className="analytics-donut analytics-donut--glow" style={{ backgroundImage: buildPortfolioDonutGradient(analyticsIncomeKindDonut) }}>
                      <div className="analytics-donut__inner">
                        <strong>{formatAmount(analyticsTotalIncome, user.base_currency_code)}</strong>
                        <span className="analytics-donut__label">Доход</span>
                      </div>
                    </div>
                    <div className="analytics-pill-grid">
                      {analyticsIncomeKindDonut.map((segment) => (
                        <div className="analytics-pill" key={segment.key}>
                          <span className="analytics-pill__dot" style={{ background: segment.color }} />
                          <div className="analytics-pill__content">
                            <div className="analytics-pill__title">{segment.label}</div>
                            <div className="analytics-pill__meta">
                              {formatAmount(segment.amount, user.base_currency_code)} · {(segment.share * 100).toFixed(1)}%
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </section>
              )}

              {analyticsMonthlyBars.length > 0 && (
                <section className="portfolio-analytics-section">
                  <div className="portfolio-analytics-section__head">
                    <div>
                      <div className="section__eyebrow">Динамика</div>
                      <h3 className="section__title">Доход по месяцам</h3>
                    </div>
                  </div>
                  <div className="pa-bar-chart">
                    {(() => {
                      const maxVal = Math.max(...analyticsMonthlyBars.map((b) => Math.abs(b.total)), 1);
                      return analyticsMonthlyBars.map((bar) => (
                        <div key={bar.period} className="pa-bar-chart__col">
                          <div className="pa-bar-chart__bar-wrap">
                            {bar.income > 0 && <div className="pa-bar-chart__bar pa-bar-chart__bar--income" style={{ height: `${Math.max((bar.income / maxVal) * 100, 4)}%` }} title={`Доход: ${formatAmount(bar.income, user.base_currency_code)}`} />}
                            {bar.trades > 0 && <div className="pa-bar-chart__bar pa-bar-chart__bar--trades" style={{ height: `${Math.max((bar.trades / maxVal) * 100, 4)}%` }} title={`Сделки: ${formatAmount(bar.trades, user.base_currency_code)}`} />}
                            {bar.trades < 0 && <div className="pa-bar-chart__bar pa-bar-chart__bar--trades-neg" style={{ height: `${Math.max((Math.abs(bar.trades) / maxVal) * 100, 4)}%` }} title={`Сделки: ${formatAmount(bar.trades, user.base_currency_code)}`} />}
                          </div>
                          <div className="pa-bar-chart__label">{bar.label}</div>
                          <div className="pa-bar-chart__value">{formatAmount(bar.total, user.base_currency_code)}</div>
                        </div>
                      ));
                    })()}
                  </div>
                </section>
              )}

              {analyticsData.totals_by_account.length > 0 && (
                <section className="portfolio-analytics-section">
                  <div className="portfolio-analytics-section__head">
                    <div>
                      <div className="section__eyebrow">Счета</div>
                      <h3 className="section__title">Доходность по счетам</h3>
                    </div>
                  </div>
                  <div className="portfolio-analytics-stack">
                    {analyticsData.totals_by_account.map((account) => {
                      const accountTotal = account.income_total + account.trade_total + account.adjustment_total;
                      return (
                        <div key={account.investment_account_id} className="portfolio-analytics-row">
                          <div className="portfolio-analytics-row__top">
                            <div>
                              <div className="portfolio-analytics-row__title">{account.account_name}</div>
                              <div className="portfolio-analytics-row__meta">
                                {account.owner_type === 'family' ? 'Семейный' : 'Личный'} · {account.income_count} выплат · {account.trade_count} сделок
                              </div>
                            </div>
                            <div className="portfolio-analytics-row__side">
                              <strong className={accountTotal >= 0 ? 'portfolio-analytics-row__result portfolio-analytics-row__result--pos' : 'portfolio-analytics-row__result portfolio-analytics-row__result--neg'}>
                                {formatAmount(accountTotal, user.base_currency_code)}
                              </strong>
                            </div>
                          </div>
                          <div className="portfolio-analytics-row__meta portfolio-analytics-row__meta--inline">
                            Доход {formatAmount(account.income_total, user.base_currency_code)} · Сделки {formatAmount(account.trade_total, user.base_currency_code)}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </section>
              )}
            </>
          )}

          {!analyticsLoading && !analyticsData && (
            <p className="list-row__sub" style={{ textAlign: 'center', padding: 24 }}>
              Нет данных за выбранный период.
            </p>
          )}

          {portfolioAnalyticsBuckets.length > 0 && (
            <section className="portfolio-analytics-section">
              <div className="portfolio-analytics-section__head">
                <div>
                  <div className="section__eyebrow">Активы</div>
                  <h3 className="section__title">Структура по типам бумаг</h3>
                </div>
              </div>
              <div className="portfolio-analytics-stack">
                {portfolioAnalyticsBuckets.map((bucket) => (
                  <div key={bucket.key} className="portfolio-analytics-row">
                    <div className="portfolio-analytics-row__top">
                      <div>
                        <div className="portfolio-analytics-row__title">{bucket.label}</div>
                        <div className="portfolio-analytics-row__meta">
                          {bucket.positionsCount} поз. · Вложено {formatAmount(bucket.investedPrincipal, user.base_currency_code)}
                        </div>
                      </div>
                      <div className="portfolio-analytics-row__side">
                        <strong>{formatAmount(bucket.estimatedValue, user.base_currency_code)}</strong>
                        <span className={bucket.currentResult >= 0 ? 'portfolio-analytics-row__result portfolio-analytics-row__result--pos' : 'portfolio-analytics-row__result portfolio-analytics-row__result--neg'}>
                          {formatAmount(bucket.currentResult, user.base_currency_code)}
                        </span>
                      </div>
                    </div>
                    <div className="portfolio-analytics-row__bar">
                      <span style={{ width: `${Math.max(bucket.share * 100, bucket.share > 0 ? 6 : 0)}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          <section className="portfolio-analytics-section">
            <div className="portfolio-analytics-section__head">
              <div>
                <div className="section__eyebrow">Счета</div>
                <h3 className="section__title">Текущее сравнение</h3>
              </div>
            </div>
            <div className="portfolio-analytics-stack">
              {portfolioAnalyticsAccounts.map((account) => (
                <div key={account.key} className="portfolio-analytics-row">
                  <div className="portfolio-analytics-row__top">
                    <div>
                      <div className="portfolio-analytics-row__title">{account.accountName}</div>
                      <div className="portfolio-analytics-row__meta">
                        {account.ownerLabel} · {account.positionsCount} поз. · Остаток {formatAmount(account.cashValue, user.base_currency_code)}
                      </div>
                    </div>
                    <div className="portfolio-analytics-row__side">
                      <strong>{formatAmount(account.estimatedValue, user.base_currency_code)}</strong>
                      <span className={account.resultValue >= 0 ? 'portfolio-analytics-row__result portfolio-analytics-row__result--pos' : 'portfolio-analytics-row__result portfolio-analytics-row__result--neg'}>
                        {formatAmount(account.resultValue, user.base_currency_code)}
                      </span>
                    </div>
                  </div>
                  <div className="portfolio-analytics-row__meta portfolio-analytics-row__meta--inline">
                    Вложено {formatAmount(account.investedPrincipal, user.base_currency_code)}
                  </div>
                </div>
              ))}
            </div>
          </section>

          {portfolioAnalyticsLeaders.length > 0 && (
            <section className="portfolio-analytics-section">
              <div className="portfolio-analytics-section__head">
                <div>
                  <div className="section__eyebrow">Активы</div>
                  <h3 className="section__title">Крупнейшие позиции</h3>
                </div>
              </div>
              <div className="portfolio-analytics-leaders">
                {portfolioAnalyticsLeaders.map((item) => (
                  <button
                    key={item.positionId}
                    type="button"
                    className="portfolio-analytics-leader"
                    onClick={() => void handleOpenPositionDetails(item.positionId)}
                  >
                    <div className="portfolio-analytics-leader__identity">
                      {item.logoUrl && (
                        <img className="instrument-logo instrument-logo--position" src={item.logoUrl} alt="" loading="lazy" />
                      )}
                      <div>
                        <div className="portfolio-analytics-leader__title">{item.title}</div>
                        <div className="portfolio-analytics-leader__meta">
                          {item.accountName}
                          {item.quantity ? ` · ${item.quantity} шт.` : ''}
                          {item.ticker ? ` · ${item.ticker}` : ''}
                        </div>
                      </div>
                    </div>
                    <div className="portfolio-analytics-leader__side">
                      <strong>{formatAmount(item.estimatedValue, user.base_currency_code)}</strong>
                      <span>{(item.share * 100).toFixed(1)}%</span>
                      {item.currentResult !== null && (
                        <span className={item.currentResult >= 0 ? 'portfolio-analytics-row__result portfolio-analytics-row__result--pos' : 'portfolio-analytics-row__result portfolio-analytics-row__result--neg'}>
                          {formatAmount(item.currentResult, user.base_currency_code)}
                        </span>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            </section>
          )}
        </div>
      )}

      {(() => {
        const posIconColor = selectedPosition ? assetTypeIconColor(selectedPosition.asset_type_code) : { icon: 'chart', color: 'b' };
        const posLogoName = selectedPosition ? getPositionMetadataText(selectedPosition, 'logo_name') : null;
        const posLogoUrl = posLogoName ? getTinkoffInstrumentLogoUrl(posLogoName) : null;
        return (
      <BottomSheet
        open={!!selectedPosition}
        gray
        tag={selectedPosition ? `${selectedPosition.investment_account_owner_type === 'family' ? 'Семейный' : 'Личный'} · ${selectedPosition.investment_account_name}` : ''}
        title={selectedPosition?.title ?? ''}
        icon={selectedPosition ? (posLogoUrl ? <img src={posLogoUrl} alt="" /> : <CategorySvgIcon code={posIconColor.icon} />) : undefined}
        iconColor={posLogoUrl ? undefined : posIconColor.color}
        onClose={() => setSelectedPositionId(null)}
      >
        {selectedPosition && (
          <div className="pf-detail-body">
            {(() => {
              const detailTicker = typeof selectedPosition.metadata?.ticker === 'string' ? selectedPosition.metadata.ticker : null;
              const detailMoexPrice = detailTicker ? moexPrices.get(detailTicker) : null;
              const detailQuote = getResolvedPositionQuote(selectedPosition);
              const detailCurrentTotal = detailQuote.currentTotalValue;
              const detailEntryAmount = getPositionEntryAmount(selectedPosition);
              const detailPnl = getResolvedPositionCurrentResult(selectedPosition);
              const detailPnlPct = detailPnl !== null && detailEntryAmount > 0
                ? (detailPnl / detailEntryAmount) * 100
                : null;
              const isClosingHint = detailQuote.source === 'moex' && detailMoexPrice?.last === null && detailMoexPrice?.prevClose !== null;
              const ccy = selectedPosition.currency_code;
              const pnlSign = detailPnl !== null && detailPnl >= 0 ? 'pos' : 'neg';
              return (
                <>
                  {(detailTicker || isClosingHint) && (
                    <div className="pf-detail-meta-row">
                      {detailTicker && <span className="pf-detail-ticker">{detailTicker}</span>}
                      <span className="pf-detail-pill">{ccy}</span>
                      {isClosingHint && <span className="pf-detail-hint-pill">цена закрытия</span>}
                    </div>
                  )}
                  <div className="pf-dstats">
                    <div className="pf-dstats__cell">
                      <span className="pf-dstats__label">Вложено</span>
                      <span className="pf-dstats__value">{formatNumericAmount(detailEntryAmount, 0)}</span>
                      <span className="pf-dstats__sub">{ccy}</span>
                    </div>
                    <div className="pf-dstats__cell">
                      <span className="pf-dstats__label">Стоимость</span>
                      <span className="pf-dstats__value">
                        {detailCurrentTotal !== null ? formatNumericAmount(detailCurrentTotal, 0) : '—'}
                      </span>
                      <span className="pf-dstats__sub">{detailCurrentTotal !== null ? 'текущая' : 'нет данных'}</span>
                    </div>
                    <div className="pf-dstats__cell">
                      <span className="pf-dstats__label">P&L</span>
                      <span className={`pf-dstats__value pf-dstats__value--${pnlSign}`}>
                        {detailPnl !== null ? `${detailPnl >= 0 ? '+' : ''}${formatNumericAmount(detailPnl, 0)}` : '—'}
                      </span>
                      <span className="pf-dstats__sub">
                        {detailPnlPct !== null ? `${detailPnlPct >= 0 ? '+' : ''}${detailPnlPct.toFixed(1)}%` : '—'}
                      </span>
                    </div>
                  </div>
                </>
              );
            })()}

            {(() => {
              const isDeposit = selectedPosition.asset_type_code === 'deposit' && !!selectedPosition.metadata?.deposit_kind;
              const accrued = typeof selectedPosition.metadata?.accrued_interest === 'number' ? Number(selectedPosition.metadata.accrued_interest) : 0;
              if (!isDeposit || accrued <= 0) return null;
              return (
                <div className="pf-dnext">
                  <div className="pf-dnext__left">
                    <span className="pf-dnext__label">Накоплено сегодня</span>
                    <span className="pf-dnext__date">проценты к получению</span>
                  </div>
                  <span className="pf-dnext__amount">+{formatNumericAmount(accrued, 0)} {currencySymbol(selectedPosition.currency_code)}</span>
                </div>
              );
            })()}

            <div className="pf-dcond">
              <div className="pf-dcond__head">
                <span className="sec-tag">Параметры</span>
              </div>
              <div className="pf-dcond__row">
                <span className="pf-dcond__row-label">Дата входа</span>
                <span className="pf-dcond__row-value">{formatDateLabel(selectedPosition.opened_at)}</span>
              </div>
              {selectedPosition.asset_type_code === 'deposit' && selectedPosition.metadata?.deposit_kind ? (
                <>
                  {typeof selectedPosition.metadata.interest_rate === 'number' && (
                    <div className="pf-dcond__row">
                      <span className="pf-dcond__row-label">Ставка</span>
                      <span className="pf-dcond__row-value">{selectedPosition.metadata.interest_rate}% годовых</span>
                    </div>
                  )}
                  {selectedPosition.metadata.deposit_kind === 'term_deposit' && selectedPosition.metadata.end_date && (
                    <div className="pf-dcond__row">
                      <span className="pf-dcond__row-label">Срок до</span>
                      <span className="pf-dcond__row-value">{formatDateLabel(String(selectedPosition.metadata.end_date))}</span>
                    </div>
                  )}
                  {selectedPosition.metadata.deposit_kind === 'term_deposit' && selectedPosition.metadata.interest_payout && (
                    <div className="pf-dcond__row">
                      <span className="pf-dcond__row-label">Выплата</span>
                      <span className="pf-dcond__row-value">{
                        selectedPosition.metadata.interest_payout === 'at_end' ? 'в конце срока'
                          : selectedPosition.metadata.interest_payout === 'monthly_to_account' ? 'ежемесячно на счёт'
                            : selectedPosition.metadata.interest_payout === 'capitalize'
                              ? `капитализация ${selectedPosition.metadata.capitalization_period === 'daily' ? 'ежедневно' : 'ежемесячно'}`
                              : String(selectedPosition.metadata.interest_payout)
                      }</span>
                    </div>
                  )}
                  {selectedPosition.metadata.deposit_kind === 'savings_account' && selectedPosition.metadata.capitalization_period && (
                    <div className="pf-dcond__row">
                      <span className="pf-dcond__row-label">Капитализация</span>
                      <span className="pf-dcond__row-value">{selectedPosition.metadata.capitalization_period === 'daily' ? 'ежедневно' : 'ежемесячно'}</span>
                    </div>
                  )}
                  {selectedPosition.metadata.deposit_kind === 'term_deposit' && selectedPosition.metadata.end_date && (() => {
                    const projected = calculateProjectedInterest({
                      depositKind: 'term_deposit',
                      principal: selectedPosition.amount_in_currency,
                      annualRate: Number(selectedPosition.metadata.interest_rate),
                      startDate: selectedPosition.opened_at,
                      endDate: String(selectedPosition.metadata.end_date),
                      interestPayout: selectedPosition.metadata.interest_payout as 'at_end' | 'monthly_to_account' | 'capitalize' | undefined,
                      capitalizationPeriod: selectedPosition.metadata.capitalization_period as 'daily' | 'monthly' | undefined,
                    });
                    return projected > 0 ? (
                      <div className="pf-dcond__row">
                        <span className="pf-dcond__row-label">Доход за срок</span>
                        <span className="pf-dcond__row-value pf-dcond__row-value--pos">+{formatAmount(projected, selectedPosition.currency_code)}</span>
                      </div>
                    ) : null;
                  })()}
                </>
              ) : (
                <>
                  {selectedPosition.quantity ? (
                    <div className="pf-dcond__row">
                      <span className="pf-dcond__row-label">Количество</span>
                      <span className="pf-dcond__row-value">{selectedPosition.quantity} шт.</span>
                    </div>
                  ) : null}
                  {getPositionInvestedPrincipal(selectedPosition) > 0 ? (
                    <div className="pf-dcond__row">
                      <span className="pf-dcond__row-label">Себестоимость</span>
                      <span className="pf-dcond__row-value">{formatAmount(getPositionInvestedPrincipal(selectedPosition), user.base_currency_code)}</span>
                    </div>
                  ) : null}
                  {(getPositionMetadataNumber(selectedPosition, 'accrued_interest_paid_in_base') ?? 0) > 0 ? (
                    <div className="pf-dcond__row">
                      <span className="pf-dcond__row-label">НКД при покупке</span>
                      <span className="pf-dcond__row-value">{formatAmount(getPositionMetadataNumber(selectedPosition, 'accrued_interest_paid_in_base') ?? 0, user.base_currency_code)}</span>
                    </div>
                  ) : null}
                  {typeof selectedPosition.metadata?.fees_in_base === 'number' && Number(selectedPosition.metadata.fees_in_base) > 0 ? (
                    <div className="pf-dcond__row">
                      <span className="pf-dcond__row-label">Комиссии</span>
                      <span className="pf-dcond__row-value">{formatAmount(Number(selectedPosition.metadata.fees_in_base), user.base_currency_code)}</span>
                    </div>
                  ) : null}
                  {getPositionRealizedResult(selectedPosition) !== 0 ? (
                    <div className="pf-dcond__row">
                      <span className="pf-dcond__row-label">Реализованный результат</span>
                      <span className={`pf-dcond__row-value pf-dcond__row-value--${getPositionRealizedResult(selectedPosition) >= 0 ? 'pos' : 'neg'}`}>
                        {getPositionRealizedResult(selectedPosition) >= 0 ? '+' : ''}{formatAmount(getPositionRealizedResult(selectedPosition), user.base_currency_code)}
                      </span>
                    </div>
                  ) : null}
                </>
              )}
              {selectedPosition.comment ? (
                <div className="pf-dcond__row pf-dcond__row--comment">
                  <span className="pf-dcond__row-label">Комментарий</span>
                  <span className="pf-dcond__row-value pf-dcond__row-value--text">{selectedPosition.comment}</span>
                </div>
              ) : null}
            </div>

              {(() => {
                const isDepositPosition = selectedPosition.asset_type_code === 'deposit' && !!selectedPosition.metadata?.deposit_kind;
                const isTermDeposit = selectedPosition.metadata?.deposit_kind === 'term_deposit';
                return (
                  <div className="pf-sheet-actions">
                    <button
                      className="btn btn--primary"
                      type="button"
                      onClick={() => handleOpenCloseForm(selectedPosition)}
                    >
                      Закрыть позицию
                    </button>
                    {!isDepositPosition && canRecordPositionIncome(selectedPosition) && (
                      <button
                        className="btn btn--ghost"
                        type="button"
                        onClick={() => handleOpenIncomeForm(selectedPosition)}
                      >
                        Начислить доход
                      </button>
                    )}
                    {!(isDepositPosition && isTermDeposit) && (
                      <button
                        className="btn btn--ghost"
                        type="button"
                        onClick={() => handleOpenPartialCloseForm(selectedPosition)}
                      >
                        Частично закрыть
                      </button>
                    )}
                    {!(isDepositPosition && isTermDeposit) && (
                      <button
                        className="btn btn--ghost"
                        type="button"
                        onClick={() => handleOpenTopUpForm(selectedPosition)}
                      >
                        Пополнить
                      </button>
                    )}
                    {isDepositPosition && (
                      <button
                        className="btn btn--ghost"
                        type="button"
                        onClick={() => {
                          setRateChangeDrafts((prev) => ({
                            ...prev,
                            [selectedPosition.id]: {
                              newRate: String(selectedPosition.metadata?.interest_rate ?? ''),
                              effectiveDate: todayIso(),
                            },
                          }));
                        }}
                      >
                        Изменить ставку
                      </button>
                    )}
                    {!isDepositPosition && (
                      <button
                        className="btn btn--ghost"
                        type="button"
                        onClick={() => handleOpenFeeForm(selectedPosition)}
                      >
                        Комиссия
                      </button>
                    )}
                  </div>
                );
              })()}

              {closeDrafts[selectedPosition.id] && (
                <form className="pf-pos-form" onSubmit={(event) => void handleClosePosition(selectedPosition.id, event)}>
                  <div className="apf-row">
                    <div className="apf-field" style={{ flex: 2 }}>
                      <label className="apf-label">Сумма выхода</label>
                      <input
                        className="apf-input"
                        type="text"
                        inputMode="decimal"
                        placeholder="0"
                        value={closeDrafts[selectedPosition.id].amount}
                        onChange={(event) => handleCloseDraftChange(selectedPosition.id, { amount: event.target.value })}
                        disabled={submittingCloseId === selectedPosition.id}
                      />
                    </div>
                    <div className="apf-field" style={{ flex: 1 }}>
                      <label className="apf-label">Валюта</label>
                      <select
                        className="apf-input"
                        value={closeDrafts[selectedPosition.id].currencyCode}
                        onChange={(event) => handleCloseDraftChange(selectedPosition.id, { currencyCode: event.target.value })}
                        disabled={submittingCloseId === selectedPosition.id}
                      >
                        {currencies.map((currency) => (
                          <option key={currency.code} value={currency.code}>
                            {currency.code}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="apf-field" style={{ flex: 1 }}>
                      <label className="apf-label">Дата</label>
                      <input
                        className="apf-input"
                        type="date"
                        value={closeDrafts[selectedPosition.id].closedAt}
                        onChange={(event) => handleCloseDraftChange(selectedPosition.id, { closedAt: event.target.value })}
                        disabled={submittingCloseId === selectedPosition.id}
                      />
                    </div>
                  </div>
                  {closeDrafts[selectedPosition.id].currencyCode !== user.base_currency_code && (
                    <div className="apf-field">
                      <label className="apf-label">Историческая стоимость в {user.base_currency_code}</label>
                      <input
                        className="apf-input"
                        type="text"
                        inputMode="decimal"
                        placeholder="0"
                        value={closeDrafts[selectedPosition.id].baseAmount}
                        onChange={(event) => handleCloseDraftChange(selectedPosition.id, { baseAmount: event.target.value })}
                        disabled={submittingCloseId === selectedPosition.id}
                      />
                    </div>
                  )}
                  <div className="apf-field">
                    <label className="apf-label">Комментарий</label>
                    <input
                      className="apf-input"
                      type="text"
                      placeholder="Необязательно"
                      value={closeDrafts[selectedPosition.id].comment}
                      onChange={(event) => handleCloseDraftChange(selectedPosition.id, { comment: event.target.value })}
                      disabled={submittingCloseId === selectedPosition.id}
                    />
                  </div>
                  <div className="apf-actions">
                    <button className="apf-submit" type="submit" disabled={submittingCloseId === selectedPosition.id}>
                      {submittingCloseId === selectedPosition.id ? 'Закрываем…' : 'Подтвердить закрытие'}
                    </button>
                  </div>
                </form>
              )}

              {partialCloseDrafts[selectedPosition.id] && (
                <form className="pf-pos-form" onSubmit={(event) => void handlePartialClosePosition(selectedPosition, event)}>
                  <div className="apf-row">
                    <div className="apf-field" style={{ flex: 2 }}>
                      <label className="apf-label">Сумма возврата</label>
                      <input
                        className="apf-input"
                        type="text"
                        inputMode="decimal"
                        placeholder="0"
                        value={partialCloseDrafts[selectedPosition.id].returnAmount}
                        onChange={(event) => handlePartialCloseDraftChange(selectedPosition.id, { returnAmount: event.target.value })}
                        disabled={submittingPartialCloseId === selectedPosition.id}
                      />
                    </div>
                    <div className="apf-field" style={{ flex: 1 }}>
                      <label className="apf-label">Валюта</label>
                      <select
                        className="apf-input"
                        value={partialCloseDrafts[selectedPosition.id].returnCurrencyCode}
                        onChange={(event) => handlePartialCloseDraftChange(selectedPosition.id, { returnCurrencyCode: event.target.value })}
                        disabled={submittingPartialCloseId === selectedPosition.id}
                      >
                        {currencies.map((currency) => (
                          <option key={currency.code} value={currency.code}>
                            {currency.code}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div className="apf-row">
                    <div className="apf-field" style={{ flex: 1 }}>
                      <label className="apf-label">Списать principal</label>
                      <input
                        className="apf-input"
                        type="text"
                        inputMode="decimal"
                        placeholder="0"
                        value={partialCloseDrafts[selectedPosition.id].principalReduction}
                        onChange={(event) => handlePartialCloseDraftChange(selectedPosition.id, { principalReduction: event.target.value })}
                        disabled={submittingPartialCloseId === selectedPosition.id}
                      />
                    </div>
                    {selectedPosition.quantity !== null && selectedPosition.quantity !== undefined && (
                      <div className="apf-field" style={{ flex: 1 }}>
                        <label className="apf-label">Списать количество</label>
                        <input
                          className="apf-input"
                          type="text"
                          inputMode="decimal"
                          placeholder="0"
                          value={partialCloseDrafts[selectedPosition.id].closedQuantity}
                          onChange={(event) => handlePartialCloseDraftChange(selectedPosition.id, { closedQuantity: event.target.value })}
                          disabled={submittingPartialCloseId === selectedPosition.id}
                        />
                      </div>
                    )}
                    <div className="apf-field" style={{ flex: 1 }}>
                      <label className="apf-label">Дата</label>
                      <input
                        className="apf-input"
                        type="date"
                        value={partialCloseDrafts[selectedPosition.id].closedAt}
                        onChange={(event) => handlePartialCloseDraftChange(selectedPosition.id, { closedAt: event.target.value })}
                        disabled={submittingPartialCloseId === selectedPosition.id}
                      />
                    </div>
                  </div>
                  {partialCloseDrafts[selectedPosition.id].returnCurrencyCode !== user.base_currency_code && (
                    <div className="apf-field">
                      <label className="apf-label">Историческая стоимость возврата в {user.base_currency_code}</label>
                      <input
                        className="apf-input"
                        type="text"
                        inputMode="decimal"
                        placeholder="0"
                        value={partialCloseDrafts[selectedPosition.id].returnBaseAmount}
                        onChange={(event) => handlePartialCloseDraftChange(selectedPosition.id, { returnBaseAmount: event.target.value })}
                        disabled={submittingPartialCloseId === selectedPosition.id}
                      />
                    </div>
                  )}
                  <div className="apf-field">
                    <label className="apf-label">Комментарий</label>
                    <input
                      className="apf-input"
                      type="text"
                      placeholder="Необязательно"
                      value={partialCloseDrafts[selectedPosition.id].comment}
                      onChange={(event) => handlePartialCloseDraftChange(selectedPosition.id, { comment: event.target.value })}
                      disabled={submittingPartialCloseId === selectedPosition.id}
                    />
                  </div>
                  <div className="apf-actions">
                    <button className="apf-submit" type="submit" disabled={submittingPartialCloseId === selectedPosition.id}>
                      {submittingPartialCloseId === selectedPosition.id ? 'Проводим…' : 'Подтвердить частичное закрытие'}
                    </button>
                  </div>
                </form>
              )}

              {incomeDrafts[selectedPosition.id] && (
                <form className="pf-pos-form" onSubmit={(event) => void handleRecordIncome(selectedPosition, event)}>
                  <div className="apf-row">
                    <div className="apf-field" style={{ flex: 2 }}>
                      <label className="apf-label">
                        {selectedPosition.asset_type_code === 'deposit' ? 'Сумма процентов' : selectedPosition.asset_type_code === 'security' ? 'Сумма дивидендов' : 'Сумма дохода'}
                      </label>
                      <input
                        className="apf-input"
                        type="text"
                        inputMode="decimal"
                        placeholder="0"
                        value={incomeDrafts[selectedPosition.id].amount}
                        onChange={(event) => handleIncomeDraftChange(selectedPosition.id, { amount: event.target.value })}
                        disabled={submittingIncomeId === selectedPosition.id}
                      />
                    </div>
                    <div className="apf-field" style={{ flex: 1 }}>
                      <label className="apf-label">Валюта</label>
                      <select
                        className="apf-input"
                        value={incomeDrafts[selectedPosition.id].currencyCode}
                        onChange={(event) => handleIncomeDraftChange(selectedPosition.id, { currencyCode: event.target.value })}
                        disabled={submittingIncomeId === selectedPosition.id}
                      >
                        {currencies.map((currency) => (
                          <option key={currency.code} value={currency.code}>
                            {currency.code}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div className="apf-field">
                    <label className="apf-label">Тип дохода</label>
                    <select
                      className="apf-input"
                      value={incomeDrafts[selectedPosition.id].incomeKind}
                      onChange={(event) => handleIncomeDraftChange(selectedPosition.id, { incomeKind: event.target.value })}
                      disabled={submittingIncomeId === selectedPosition.id}
                    >
                      {selectedPosition.asset_type_code === 'deposit' ? (
                        <>
                          <option value="interest">Проценты</option>
                          <option value="other">Другой доход</option>
                        </>
                      ) : selectedPosition.asset_type_code === 'security' ? (
                        <>
                          <option value="dividend">Дивиденды</option>
                          <option value="coupon">Купон</option>
                          <option value="other">Другой доход</option>
                        </>
                      ) : (
                        <>
                          <option value="other">Другой доход</option>
                          <option value="interest">Проценты</option>
                        </>
                      )}
                    </select>
                  </div>
                  <div className="apf-field">
                    <label className="apf-label">Назначение</label>
                    <select
                      className="apf-input"
                      value={incomeDrafts[selectedPosition.id].destination}
                      onChange={(event) => handleIncomeDraftChange(selectedPosition.id, { destination: event.target.value as 'account' | 'position' })}
                      disabled={submittingIncomeId === selectedPosition.id}
                    >
                      <option value="account">На счёт</option>
                      <option value="position">Оставить в активе</option>
                    </select>
                  </div>
                  <div className="apf-field">
                    <label className="apf-label">Дата</label>
                    <input
                      className="apf-input"
                      type="date"
                      value={incomeDrafts[selectedPosition.id].receivedAt}
                      onChange={(event) => handleIncomeDraftChange(selectedPosition.id, { receivedAt: event.target.value })}
                      disabled={submittingIncomeId === selectedPosition.id}
                    />
                  </div>
                  {incomeDrafts[selectedPosition.id].currencyCode !== user.base_currency_code && (
                    <div className="apf-field">
                      <label className="apf-label">Историческая стоимость в {user.base_currency_code}</label>
                      <input
                        className="apf-input"
                        type="text"
                        inputMode="decimal"
                        placeholder="0"
                        value={incomeDrafts[selectedPosition.id].baseAmount}
                        onChange={(event) => handleIncomeDraftChange(selectedPosition.id, { baseAmount: event.target.value })}
                        disabled={submittingIncomeId === selectedPosition.id}
                      />
                    </div>
                  )}
                  <div className="apf-field">
                    <label className="apf-label">Комментарий</label>
                    <input
                      className="apf-input"
                      type="text"
                      placeholder="Необязательно"
                      value={incomeDrafts[selectedPosition.id].comment}
                      onChange={(event) => handleIncomeDraftChange(selectedPosition.id, { comment: event.target.value })}
                      disabled={submittingIncomeId === selectedPosition.id}
                    />
                  </div>
                  <div className="apf-actions">
                    <button className="apf-submit" type="submit" disabled={submittingIncomeId === selectedPosition.id}>
                      {submittingIncomeId === selectedPosition.id ? 'Начисляем…' : 'Подтвердить доход'}
                    </button>
                  </div>
                </form>
              )}

              {topUpDrafts[selectedPosition.id] && (
                <form className="pf-pos-form" onSubmit={(event) => void handleTopUpPosition(selectedPosition, event)}>
                  <div className="apf-row">
                    <div className="apf-field" style={{ flex: 2 }}>
                      <label className="apf-label">Сумма пополнения</label>
                      <input
                        className="apf-input"
                        type="text"
                        inputMode="decimal"
                        placeholder="0"
                        value={topUpDrafts[selectedPosition.id].amount}
                        onChange={(event) => handleTopUpDraftChange(selectedPosition.id, { amount: event.target.value })}
                        disabled={submittingTopUpId === selectedPosition.id}
                      />
                    </div>
                    <div className="apf-field" style={{ flex: 1 }}>
                      <label className="apf-label">Количество</label>
                      <input
                        className="apf-input"
                        type="text"
                        inputMode="decimal"
                        placeholder="—"
                        value={topUpDrafts[selectedPosition.id].quantity}
                        onChange={(event) => handleTopUpDraftChange(selectedPosition.id, { quantity: event.target.value })}
                        disabled={submittingTopUpId === selectedPosition.id}
                      />
                    </div>
                    <div className="apf-field" style={{ flex: 1 }}>
                      <label className="apf-label">Дата</label>
                      <input
                        className="apf-input"
                        type="date"
                        value={topUpDrafts[selectedPosition.id].toppedUpAt}
                        onChange={(event) => handleTopUpDraftChange(selectedPosition.id, { toppedUpAt: event.target.value })}
                        disabled={submittingTopUpId === selectedPosition.id}
                      />
                    </div>
                  </div>
                  <div className="apf-field">
                    <label className="apf-label">Комментарий</label>
                    <input
                      className="apf-input"
                      type="text"
                      placeholder="Необязательно"
                      value={topUpDrafts[selectedPosition.id].comment}
                      onChange={(event) => handleTopUpDraftChange(selectedPosition.id, { comment: event.target.value })}
                      disabled={submittingTopUpId === selectedPosition.id}
                    />
                  </div>
                  <div className="apf-actions">
                    <button className="apf-submit" type="submit" disabled={submittingTopUpId === selectedPosition.id}>
                      {submittingTopUpId === selectedPosition.id ? 'Пополняем…' : 'Подтвердить пополнение'}
                    </button>
                  </div>
                </form>
              )}

              {feeDrafts[selectedPosition.id] && (
                <form className="pf-pos-form" onSubmit={(event) => void handleRecordFee(selectedPosition, event)}>
                  <div className="apf-row">
                    <div className="apf-field" style={{ flex: 2 }}>
                      <label className="apf-label">Сумма комиссии</label>
                      <input
                        className="apf-input"
                        type="text"
                        inputMode="decimal"
                        placeholder="0"
                        value={feeDrafts[selectedPosition.id].amount}
                        onChange={(event) => handleFeeDraftChange(selectedPosition.id, { amount: event.target.value })}
                        disabled={submittingFeeId === selectedPosition.id}
                      />
                    </div>
                    <div className="apf-field" style={{ flex: 1 }}>
                      <label className="apf-label">Валюта</label>
                      <select
                        className="apf-input"
                        value={feeDrafts[selectedPosition.id].currencyCode}
                        onChange={(event) => handleFeeDraftChange(selectedPosition.id, { currencyCode: event.target.value })}
                        disabled={submittingFeeId === selectedPosition.id}
                      >
                        {currencies.map((currency) => (
                          <option key={currency.code} value={currency.code}>
                            {currency.code}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="apf-field" style={{ flex: 1 }}>
                      <label className="apf-label">Дата</label>
                      <input
                        className="apf-input"
                        type="date"
                        value={feeDrafts[selectedPosition.id].chargedAt}
                        onChange={(event) => handleFeeDraftChange(selectedPosition.id, { chargedAt: event.target.value })}
                        disabled={submittingFeeId === selectedPosition.id}
                      />
                    </div>
                  </div>
                  <div className="apf-balance">
                    Доступно: {formatAmount(getAccountBalanceForCurrency(selectedPosition.investment_account_id, feeDrafts[selectedPosition.id].currencyCode), feeDrafts[selectedPosition.id].currencyCode)}
                  </div>
                  <div className="apf-field">
                    <label className="apf-label">Комментарий</label>
                    <input
                      className="apf-input"
                      type="text"
                      placeholder="Необязательно"
                      value={feeDrafts[selectedPosition.id].comment}
                      onChange={(event) => handleFeeDraftChange(selectedPosition.id, { comment: event.target.value })}
                      disabled={submittingFeeId === selectedPosition.id}
                    />
                  </div>
                  <div className="apf-actions">
                    <button className="apf-submit" type="submit" disabled={submittingFeeId === selectedPosition.id}>
                      {submittingFeeId === selectedPosition.id ? 'Списываем…' : 'Подтвердить комиссию'}
                    </button>
                  </div>
                </form>
              )}

              {rateChangeDrafts[selectedPosition.id] && (
                <form className="pf-pos-form" onSubmit={(event) => void handleChangeRate(selectedPosition, event)}>
                  <div className="apf-row">
                    <div className="apf-field" style={{ flex: 1 }}>
                      <label className="apf-label">Новая ставка, % годовых</label>
                      <input
                        className="apf-input"
                        type="text"
                        inputMode="decimal"
                        placeholder="0.0"
                        value={rateChangeDrafts[selectedPosition.id].newRate}
                        onChange={(event) => setRateChangeDrafts((prev) => ({
                          ...prev,
                          [selectedPosition.id]: { ...prev[selectedPosition.id], newRate: event.target.value },
                        }))}
                        disabled={submittingRateChangeId === selectedPosition.id}
                      />
                    </div>
                    <div className="apf-field" style={{ flex: 1 }}>
                      <label className="apf-label">Дата вступления</label>
                      <input
                        className="apf-input"
                        type="date"
                        value={rateChangeDrafts[selectedPosition.id].effectiveDate}
                        onChange={(event) => setRateChangeDrafts((prev) => ({
                          ...prev,
                          [selectedPosition.id]: { ...prev[selectedPosition.id], effectiveDate: event.target.value },
                        }))}
                        disabled={submittingRateChangeId === selectedPosition.id}
                      />
                    </div>
                  </div>
                  <div className="apf-actions">
                    <button className="apf-submit" type="submit" disabled={submittingRateChangeId === selectedPosition.id}>
                      {submittingRateChangeId === selectedPosition.id ? 'Сохраняем…' : 'Изменить ставку'}
                    </button>
                  </div>
                </form>
              )}

              {closeError && <p className="pf-detail-error">{closeError}</p>}
              {incomeError && <p className="pf-detail-error">{incomeError}</p>}
              {topUpError && <p className="pf-detail-error">{topUpError}</p>}
              {partialCloseError && <p className="pf-detail-error">{partialCloseError}</p>}
              {feeError && <p className="pf-detail-error">{feeError}</p>}
              {rateChangeError && <p className="pf-detail-error">{rateChangeError}</p>}
              {deleteError && <p className="pf-detail-error">{deleteError}</p>}
              {cancelIncomeError && <p className="pf-detail-error">{cancelIncomeError}</p>}

              <div className="pf-events">
                <div className="pf-events__head">
                  <span className="sec-tag">События</span>
                </div>
                {eventsError && <p className="pf-detail-error">{eventsError}</p>}
                {eventsLoadingId === selectedPosition.id ? (
                  <p className="pf-events__empty">Загружаем события...</p>
                ) : selectedPositionEvents.length === 0 ? (
                  <p className="pf-events__empty">Событий пока нет</p>
                ) : (
                  <ul className="pf-events__list">
                    {selectedPositionEvents.map((item) => (
                      <li className="pf-events__item" key={item.id}>
                        <div className="pf-events__row-main">
                          <span className="pf-events__tag">{getEventLabel(item)}</span>
                          <strong className="pf-events__amount">
                            {item.amount !== null && item.amount !== undefined && item.currency_code
                              ? formatAmount(item.amount, item.currency_code)
                              : 'Без суммы'}
                          </strong>
                        </div>
                        <div className="pf-events__sub">
                          {formatDateLabel(item.event_at)}
                          {typeof item.metadata?.destination === 'string'
                            ? ` · ${item.metadata.destination === 'position' ? 'В актив' : 'На счёт'}`
                            : ''}
                          {item.quantity ? ` · Количество: ${item.quantity}` : ''}
                          {item.event_type === 'partial_close' && typeof item.metadata?.principal_amount_in_currency === 'number'
                            ? ` · Principal: ${formatAmount(Number(item.metadata.principal_amount_in_currency), selectedPosition.currency_code)}`
                            : ''}
                          {(item.event_type === 'close' || item.event_type === 'partial_close')
                            && typeof item.metadata?.realized_result_in_base === 'number'
                            ? ` · Результат: ${formatAmount(Number(item.metadata.realized_result_in_base), user.base_currency_code)}`
                            : ''}
                          {item.linked_operation_id ? ` · Операция #${item.linked_operation_id}` : ''}
                          {item.comment ? ` · ${item.comment}` : ''}
                        </div>
                        {item.event_type === 'income' && (
                          <div className="pf-events__actions">
                            {selectedPositionCancelledIncomeIds.has(item.id) ? (
                              <span className="tag tag--neutral">Уже отменён</span>
                            ) : (
                              <button
                                className="credits-textbtn credits-textbtn--danger"
                                type="button"
                                disabled={cancellingIncomeEventId === item.id}
                                onClick={() => void handleCancelIncome(selectedPosition.id, item.id)}
                              >
                                {cancellingIncomeEventId === item.id ? 'Отменяем...' : 'Отменить доход'}
                              </button>
                            )}
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <button
                className="pf-archive-btn"
                type="button"
                disabled={deletingPositionId === selectedPosition.id}
                onClick={() => void handleDeletePosition(selectedPosition)}
              >
                <Trash2 size={15} strokeWidth={2} /> {deletingPositionId === selectedPosition.id ? 'Удаляем...' : 'Удалить позицию'}
              </button>
          </div>
        )}
      </BottomSheet>
        );
      })()}

      {/* ── Add position sheet ── */}
      {(() => {
        const TYPE_TILES = [
          { code: 'security', label: 'Ценные бумаги', sub: 'Акции, облигации, фонды', tint: 'b', icon: <TrendingUp size={20} strokeWidth={2} /> },
          { code: 'deposit',  label: 'Депозит',        sub: 'Вклад или накопительный', tint: 'g', icon: <Landmark   size={20} strokeWidth={2} /> },
          { code: 'crypto',   label: 'Крипта',          sub: 'BTC, ETH, TON и другие',  tint: 'o', icon: <Coins      size={20} strokeWidth={2} /> },
          { code: 'other',    label: 'Другое',          sub: 'Металлы, ЗПИФ и прочее',  tint: 'p', icon: <Package    size={20} strokeWidth={2} /> },
        ];
        const resolvedTypeCode = addSheetTypeCode ?? DEFAULT_PORTFOLIO_ASSET_TYPE_CODES[0];
        const resolvedTypeLabel = assetTypeLabel(resolvedTypeCode);
        const sheetTitle = addSheetTypeCode ? `Новая позиция · ${resolvedTypeLabel}` : 'Добавить позицию';
        const sheetAccounts = addSheetTypeCode
          ? accounts.filter(({ account }) =>
              !account.investment_asset_type || account.investment_asset_type === addSheetTypeCode,
            )
          : accounts;
        const addSheetIconColor = addSheetTypeCode ? assetTypeIconColor(addSheetTypeCode) : { icon: 'briefcase', color: 'r' };
        return (
          <BottomSheet
            open={addSheetOpen}
            tag="Портфель"
            title={sheetTitle}
            icon={<CategorySvgIcon code={addSheetIconColor.icon} />}
            iconColor={addSheetIconColor.color}
            onClose={() => { setAddSheetOpen(false); setAddSheetTypeCode(null); }}
          >
            {addSheetTypeCode === null ? (
              <div className="add-pos-types">
                {TYPE_TILES.map((t) => (
                  <button
                    key={t.code}
                    type="button"
                    className="add-pos-type-tile"
                    onClick={() => setAddSheetTypeCode(t.code)}
                  >
                    <span className={`add-pos-type-tile__icon add-pos-type-tile__icon--${t.tint}`}>{t.icon}</span>
                    <div className="add-pos-type-tile__copy">
                      <span className="add-pos-type-tile__label">{t.label}</span>
                      <span className="add-pos-type-tile__sub">{t.sub}</span>
                    </div>
                    <span className="add-pos-type-tile__chev">›</span>
                  </button>
                ))}
              </div>
            ) : (
              <PortfolioPositionDialog
                accounts={sheetAccounts.length > 0 ? sheetAccounts : accounts}
                currencies={currencies}
                user={user}
                defaultAssetTypeCode={resolvedTypeCode}
                defaultAssetTypeLabel={resolvedTypeLabel}
                bare
                onClose={() => { setAddSheetOpen(false); setAddSheetTypeCode(null); }}
                onSuccess={() => {
                  setAddSheetOpen(false);
                  setAddSheetTypeCode(null);
                  void loadPortfolio();
                }}
              />
            )}
          </BottomSheet>
        );
      })()}

      {/* ── Hero type sheet ── */}
      {(() => {
        const sheetTab = assetTabs.find((t) => t.code === heroTypeSheetCode);
        const sheetAccounts = heroTypeSheetCode
          ? accounts.filter(({ account }) =>
              !account.investment_asset_type || account.investment_asset_type === heroTypeSheetCode,
            )
          : [];
        const heroIconColor = heroTypeSheetCode ? assetTypeIconColor(heroTypeSheetCode) : { icon: 'chart', color: 'b' };
        return (
          <BottomSheet
            open={heroTypeSheetCode !== null}
            tag="Портфель"
            title={sheetTab?.label ?? ''}
            icon={<CategorySvgIcon code={heroIconColor.icon} />}
            iconColor={heroIconColor.color}
            onClose={() => setHeroTypeSheetCode(null)}
          >
            <div className="pf-sheet-accounts">
              {sheetAccounts.map(({ account, balances }) => {
                const summary = summaryByAccountId[account.id];
                const liveMetrics = getConnectedSecurityMetrics(account.id);
                const conn = heroTypeSheetCode === 'security'
                  ? tinkoffConnections.find((c) => c.linked_account_id === account.id)
                  : null;
                const isSecurities = heroTypeSheetCode === 'security';
                return (
                  <div key={account.id} className="pf-sheet-account">
                    <div className="pf-sheet-account__head">
                      <div>
                        <div className="pf-sheet-account__name">{account.name}</div>
                        <div className="pf-sheet-account__meta">
                          {account.owner_type === 'family' ? 'Семейный' : 'Личный'}
                          {account.provider_name ? ` · ${account.provider_name}` : ''}
                        </div>
                      </div>
                      {conn && (
                        <button
                          type="button"
                          className="pf-sheet-sync-btn"
                          onClick={() => {
                            setHeroTypeSheetCode(null);
                            setSyncDialogConnection(conn);
                          }}
                        >
                          ↻ Подтянуть
                          {conn.last_synced_at && (
                            <span className="pf-sheet-sync-btn__date">
                              {new Date(conn.last_synced_at).toLocaleDateString('ru')}
                            </span>
                          )}
                        </button>
                      )}
                    </div>
                    <div className="pf-sheet-account__rows">
                      {balances.map((b) => (
                        <div key={b.currency_code} className="pf-sheet-account__row">
                          <span>Кэш {b.currency_code}</span>
                          <strong>{new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(b.amount)} {currencySymbol(b.currency_code)}</strong>
                        </div>
                      ))}
                      {isSecurities && liveMetrics.estimatedValue > 0 && (
                        <div className="pf-sheet-account__row">
                          <span>Оценочная стоимость</span>
                          <strong>{new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(liveMetrics.estimatedValue)} {currencySymbol(user.base_currency_code)}</strong>
                        </div>
                      )}
                      {isSecurities && liveMetrics.investedPrincipal > 0 && (
                        <div className="pf-sheet-account__row">
                          <span>Вложено</span>
                          <strong>{new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(liveMetrics.investedPrincipal)} {currencySymbol(user.base_currency_code)}</strong>
                        </div>
                      )}
                      {isSecurities && liveMetrics.currentResult !== 0 && (
                        <div className={`pf-sheet-account__row${liveMetrics.currentResult >= 0 ? ' pf-sheet-account__row--pos' : ' pf-sheet-account__row--neg'}`}>
                          <span>Доход</span>
                          <strong>{liveMetrics.currentResult >= 0 ? '+' : ''}{new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(liveMetrics.currentResult)} {currencySymbol(user.base_currency_code)}</strong>
                        </div>
                      )}
                      {!isSecurities && summary && summary.realized_income_in_base !== 0 && (
                        <div className={`pf-sheet-account__row${summary.realized_income_in_base >= 0 ? ' pf-sheet-account__row--pos' : ' pf-sheet-account__row--neg'}`}>
                          <span>Доход</span>
                          <strong>{summary.realized_income_in_base >= 0 ? '+' : ''}{new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(summary.realized_income_in_base)} {currencySymbol(user.base_currency_code)}</strong>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
              {sheetAccounts.length === 0 && (
                <p className="pf-sheet-empty">Счетов этого типа нет.</p>
              )}
            </div>
          </BottomSheet>
        );
      })()}


      {syncDialogConnection && (
        <TinkoffSyncDialog
          connectionId={syncDialogConnection.id}
          investmentAccountId={syncDialogConnection.linked_account_id ?? 0}
          baseCurrencyCode={user.base_currency_code}
          onClose={() => setSyncDialogConnection(null)}
          onSuccess={() => {
            setSyncDialogConnection(null);
            void loadPortfolio();
          }}
        />
      )}

      {showNewAccountModal && (() => {
        const ACCOUNT_TYPE_TILES = [
          { code: 'security' as const, label: 'Ценные бумаги', sub: 'Акции, облигации, фонды', tint: 'b', icon: <TrendingUp size={20} strokeWidth={2} /> },
          { code: 'deposit'  as const, label: 'Депозит',        sub: 'Вклад или накопительный', tint: 'g', icon: <Landmark   size={20} strokeWidth={2} /> },
          { code: 'crypto'   as const, label: 'Крипта',          sub: 'BTC, ETH, TON и другие',  tint: 'o', icon: <Coins      size={20} strokeWidth={2} /> },
          { code: 'other'    as const, label: 'Другое',          sub: 'Металлы, ЗПИФ и прочее',  tint: 'p', icon: <Package    size={20} strokeWidth={2} /> },
        ];
        const selectedTile = ACCOUNT_TYPE_TILES.find((t) => t.code === newAccountAssetType);
        const resetAndClose = () => {
          setShowNewAccountModal(false);
          setNewAccountStep('pick');
          setNewAccountName('');
          setNewAccountProvider('');
          setNewAccountAssetType('security');
          setNewAccountOwnerType('user');
          setCreateAccountError(null);
        };
        const newAccIconColor = newAccountStep === 'pick' ? { icon: 'briefcase', color: 'r' } : assetTypeIconColor(newAccountAssetType);
        return (
          <BottomSheet
            open={showNewAccountModal}
            tag="Создать"
            title={newAccountStep === 'pick' ? 'Новый инвестиционный счёт' : `Новый счёт · ${selectedTile?.label ?? ''}`}
            icon={<CategorySvgIcon code={newAccIconColor.icon} />}
            iconColor={newAccIconColor.color}
            onClose={resetAndClose}
          >
            {newAccountStep === 'pick' ? (
              <div className="add-pos-types">
                {ACCOUNT_TYPE_TILES.map((t) => (
                  <button
                    key={t.code}
                    type="button"
                    className="add-pos-type-tile"
                    onClick={() => { setNewAccountAssetType(t.code); setNewAccountStep('form'); }}
                  >
                    <span className={`add-pos-type-tile__icon add-pos-type-tile__icon--${t.tint}`}>{t.icon}</span>
                    <div className="add-pos-type-tile__copy">
                      <span className="add-pos-type-tile__label">{t.label}</span>
                      <span className="add-pos-type-tile__sub">{t.sub}</span>
                    </div>
                    <span className="add-pos-type-tile__chev">›</span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="pf-new-account-form apf-body">
                <div className="apf-field">
                  <label className="apf-label">Название счёта</label>
                  <input
                    className="apf-input"
                    type="text"
                    placeholder="Например: ИИС Тинькофф"
                    value={newAccountName}
                    onChange={(e) => setNewAccountName(e.target.value)}
                    autoFocus
                  />
                </div>
                <div className="apf-field">
                  <label className="apf-label">Брокер / провайдер</label>
                  <input
                    className="apf-input"
                    type="text"
                    placeholder="Например: Тинькофф Инвестиции"
                    value={newAccountProvider}
                    onChange={(e) => setNewAccountProvider(e.target.value)}
                  />
                </div>
                <div className="apf-field">
                  <label className="apf-label">Владелец</label>
                  <div className="apf-segtog pf-new-account-form__seg">
                    <button
                      type="button"
                      className={`apf-segtog__opt${newAccountOwnerType === 'user' ? ' apf-segtog__opt--on' : ''}`}
                      onClick={() => setNewAccountOwnerType('user')}
                    >
                      Личный
                    </button>
                    <button
                      type="button"
                      className={`apf-segtog__opt${newAccountOwnerType === 'family' ? ' apf-segtog__opt--on' : ''}`}
                      onClick={() => setNewAccountOwnerType('family')}
                    >
                      Семейный
                    </button>
                  </div>
                </div>
                {createAccountError && (
                  <p className="pf-new-account-form__error">{createAccountError}</p>
                )}
                <div className="apf-actions">
                  <button type="button" className="apf-cancel" onClick={resetAndClose} disabled={creatingAccount}>
                    Отмена
                  </button>
                  <button
                    type="button"
                    className="apf-submit"
                    onClick={() => void handleCreateAccount()}
                    disabled={!newAccountName.trim() || creatingAccount}
                  >
                    {creatingAccount ? 'Создаём…' : 'Создать счёт'}
                  </button>
                </div>
              </div>
            )}
          </BottomSheet>
        );
      })()}
    </>
  );
}
