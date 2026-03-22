import { type FormEvent, useEffect, useMemo, useState } from 'react';

import {
  cancelPortfolioIncome,
  closePortfolioPosition,
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
} from '../api';
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
} from '../types';
import { formatAmount } from '../utils/format';
import { fetchMoexPrices } from '../utils/moex';
import type { MoexPrice } from '../utils/moex';


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

const ASSET_TYPE_OPTIONS = [
  { value: 'security', label: 'Ценные бумаги' },
  { value: 'deposit', label: 'Депозит' },
  { value: 'crypto', label: 'Криптовалюта' },
] as const;

const DEFAULT_PORTFOLIO_ASSET_TYPE_CODES = ['security', 'deposit', 'crypto'] as const;

const SECURITY_KIND_OPTIONS = [
  { value: 'stock', label: 'Акции' },
  { value: 'bond', label: 'Облигации' },
  { value: 'fund', label: 'Фонды' },
] as const;


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
    incomeKind: position.asset_type_code === 'deposit' ? 'interest' : 'dividend',
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
  return position.asset_type_code === 'security' || position.asset_type_code === 'deposit';
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
  const [activeAssetTypeCode, setActiveAssetTypeCode] = useState<string>(DEFAULT_PORTFOLIO_ASSET_TYPE_CODES[0]);
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submittingCloseId, setSubmittingCloseId] = useState<number | null>(null);
  const [submittingIncomeId, setSubmittingIncomeId] = useState<number | null>(null);
  const [submittingTopUpId, setSubmittingTopUpId] = useState<number | null>(null);
  const [submittingPartialCloseId, setSubmittingPartialCloseId] = useState<number | null>(null);
  const [submittingFeeId, setSubmittingFeeId] = useState<number | null>(null);
  const [deletingPositionId, setDeletingPositionId] = useState<number | null>(null);
  const [bulkDeletingPositions, setBulkDeletingPositions] = useState(false);
  const [cancellingIncomeEventId, setCancellingIncomeEventId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [closeError, setCloseError] = useState<string | null>(null);
  const [incomeError, setIncomeError] = useState<string | null>(null);
  const [topUpError, setTopUpError] = useState<string | null>(null);
  const [partialCloseError, setPartialCloseError] = useState<string | null>(null);
  const [feeError, setFeeError] = useState<string | null>(null);
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
  const [assetSwipeStartX, setAssetSwipeStartX] = useState<number | null>(null);
  const [accountSwipeStartX, setAccountSwipeStartX] = useState<number | null>(null);
  const [showClosedPositions, setShowClosedPositions] = useState(false);
  const [moexPrices, setMoexPrices] = useState<Map<string, MoexPrice>>(new Map());
  const [tinkoffLivePrices, setTinkoffLivePrices] = useState<Map<number, TinkoffLivePrice>>(new Map());
  const [tinkoffConnections, setTinkoffConnections] = useState<ExternalConnection[]>([]);
  const [syncDialogConnection, setSyncDialogConnection] = useState<ExternalConnection | null>(null);
  const [showAccountsModal, setShowAccountsModal] = useState(false);
  const [activeAccountTabKey, setActiveAccountTabKey] = useState('all');

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

  const closedPositions = useMemo(
    () => positions.filter((position) => position.status === 'closed'),
    [positions],
  );

  const assetTabs = useMemo<PortfolioAssetTab[]>(() => {
    const positionTypeCodes = Array.from(new Set(positions.map((position) => position.asset_type_code)));
    const knownCodes = [...DEFAULT_PORTFOLIO_ASSET_TYPE_CODES];
    const extraCodes = positionTypeCodes
      .filter((code) => !knownCodes.includes(code as (typeof DEFAULT_PORTFOLIO_ASSET_TYPE_CODES)[number]))
      .sort((left, right) => assetTypeLabel(left).localeCompare(assetTypeLabel(right), 'ru'));

    return [...knownCodes, ...extraCodes].map((code) => ({
      code,
      label: assetTypeLabel(code),
      openCount: openPositions.filter((position) => position.asset_type_code === code).length,
      closedCount: closedPositions.filter((position) => position.asset_type_code === code).length,
      principalInBase: openPositions
        .filter((position) => position.asset_type_code === code)
        .reduce((sum, position) => sum + Number(position.metadata?.amount_in_base ?? 0), 0),
      incomeInBase: positions
        .filter((position) => position.asset_type_code === code)
        .reduce((sum, position) => sum + Number(position.metadata?.income_in_base ?? 0), 0),
      totalInBase: 0,
    })).map((tab) => ({
      ...tab,
      totalInBase: tab.principalInBase + tab.incomeInBase,
    }));
  }, [closedPositions, openPositions, positions]);

  useEffect(() => {
    if (!assetTabs.some((tab) => tab.code === activeAssetTypeCode)) {
      setActiveAssetTypeCode(assetTabs[0]?.code ?? DEFAULT_PORTFOLIO_ASSET_TYPE_CODES[0]);
    }
  }, [activeAssetTypeCode, assetTabs]);

  const activeAssetTab = useMemo(
    () => assetTabs.find((tab) => tab.code === activeAssetTypeCode) ?? assetTabs[0] ?? null,
    [activeAssetTypeCode, assetTabs],
  );

  const filteredOpenPositions = useMemo(
    () => openPositions.filter((position) => position.asset_type_code === activeAssetTypeCode),
    [activeAssetTypeCode, openPositions],
  );

  const filteredClosedPositions = useMemo(
    () => closedPositions.filter((position) => position.asset_type_code === activeAssetTypeCode),
    [activeAssetTypeCode, closedPositions],
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

  const handleDeleteAllPositions = async () => {
    if (bulkDeletingPositions) {
      return;
    }

    const positionsToDelete = positions.filter((position) => position.status === 'open');

    if (positionsToDelete.length === 0) {
      setDeleteError('Нет открытых позиций для удаления.');
      return;
    }

    const isConfirmed = window.confirm(
      `Временно удалить все открытые позиции (${positionsToDelete.length})? `
      + 'Удаление идёт по одной позиции через обычный API, поэтому позиции с доходами, частичными или полными закрытиями могут не удалиться.',
    );

    if (!isConfirmed) {
      return;
    }

    setBulkDeletingPositions(true);
    setDeleteError(null);

    const failedTitles: string[] = [];

    try {
      for (const position of positionsToDelete) {
        setDeletingPositionId(position.id);

        try {
          await deletePortfolioPosition(position.id);

          if (selectedPositionId === position.id) {
            setSelectedPositionId(null);
          }
        } catch (reason: unknown) {
          failedTitles.push(
            `${position.title}: ${reason instanceof Error ? reason.message : String(reason)}`,
          );
        }
      }

      await loadPortfolio();

      if (failedTitles.length > 0) {
        const preview = failedTitles.slice(0, 2).join(' | ');
        const tail = failedTitles.length > 2 ? ` | и ещё ${failedTitles.length - 2}` : '';
        setDeleteError(`Удалили не всё. ${preview}${tail}`);
      }
    } finally {
      setDeletingPositionId(null);
      setBulkDeletingPositions(false);
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

  const hideEstimatedValueInStats = activeAssetTypeCode === 'security' && accountTabs.length > 1;

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

  const visibleAssetPositions = useMemo(
    () => (
      activeAccountTabKey === 'all'
        ? positions.filter((position) => position.asset_type_code === activeAssetTypeCode)
        : positions.filter(
          (position) => position.asset_type_code === activeAssetTypeCode && getPositionAccountKey(position) === activeAccountTabKey,
        )
    ),
    [activeAccountTabKey, activeAssetTypeCode, positions],
  );

  const visibleOpenPositionGroups = useMemo(
    () => (
      activeAccountTabKey === 'all'
        ? filteredOpenPositionGroups
        : filteredOpenPositionGroups.filter((group) => `${group.ownerType}:${group.accountId}` === activeAccountTabKey)
    ),
    [activeAccountTabKey, filteredOpenPositionGroups],
  );

  const activeScopeDisplayMetrics = useMemo(() => {
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
        resultLabel: 'Текущий результат',
      };
    }

    return {
      estimatedValue: visibleOpenPositions.reduce((sum, position) => sum + getResolvedPositionEstimatedValue(position), 0),
      investedPrincipal: visibleOpenPositions.reduce((sum, position) => sum + Number(position.metadata?.amount_in_base ?? 0), 0),
      cashValue: visibleOpenPositionGroups.reduce((sum, group) => sum + getConnectedSecurityMetrics(group.accountId).cashValue, 0),
      resultValue: visibleAssetPositions.reduce((sum, position) => sum + Number(position.metadata?.income_in_base ?? 0), 0),
      resultLabel: 'Доход',
    };
  }, [
    activeAssetTypeCode,
    accountEstimatedValueById,
    accountOpenPrincipalById,
    moexPrices,
    summaryByAccountId,
    tinkoffLivePrices,
    visibleAssetPositions,
    visibleOpenPositionGroups,
    visibleOpenPositions,
  ]);

  const hasMultipleOpenPositionOwners = useMemo(
    () => new Set(visibleOpenPositionGroups.map((group) => group.ownerType)).size > 1,
    [visibleOpenPositionGroups],
  );

  const hasMultipleOpenPositionAccounts = visibleOpenPositionGroups.length > 1;

  const getOpenPositionSections = (positionsForGroup: PortfolioPosition[]): SecuritySection[] => {
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
      <h1 className="page-title">Портфель</h1>

      {error && (
        <p style={{ color: 'var(--tag-out-fg)', fontSize: '0.85rem', marginBottom: 12 }}>
          {error}
        </p>
      )}

      <article className="hero-card hero-card--clickable" onClick={() => setShowAccountsModal(true)} role="button" tabIndex={0}>
        <span className="hero-card__label">Инвестиционный портфель</span>
        <div className="hero-card__value-row">
          <strong className="hero-card__value">
            {formatAmount(totalRealPortfolioValue, user.base_currency_code)}
          </strong>
          {hasPricedPositions && totalPricedEntry > 0 && (
            <span className={`hero-pnl-badge${totalUnrealizedPnl >= 0 ? ' hero-pnl-badge--pos' : ' hero-pnl-badge--neg'}`}>
              {totalUnrealizedPnl >= 0 ? '+' : ''}{formatAmount(totalUnrealizedPnl, user.base_currency_code)}
              {' '}({totalUnrealizedPnl >= 0 ? '+' : ''}{((totalUnrealizedPnl / totalPricedEntry) * 100).toFixed(1)}%)
            </span>
          )}
        </div>
        <div className="hero-card__breakdown">
          <div className="hero-card__breakdown-row">
            <span>Вложено</span>
            <strong>{formatAmount(totalInvestedPrincipalInBase, user.base_currency_code)}</strong>
          </div>
          <div className="hero-card__breakdown-row">
            <span>Оценочная стоимость</span>
            <strong>{formatAmount(totalPositionsValue, user.base_currency_code)}</strong>
          </div>
          <div className="hero-card__breakdown-row">
            <span>Зафиксированный доход</span>
            <strong>{formatAmount(totalRealizedIncomeInBase, user.base_currency_code)}</strong>
          </div>
          <div className="hero-card__breakdown-row">
            <span>Нераспределённый кэш</span>
            <strong>{formatAmount(totalInvestmentCashInBase, user.base_currency_code)}</strong>
          </div>
        </div>
      </article>

      <section className="section">
        <div className="section__header">
          <div>
            <div className="section__eyebrow">Портфель</div>
            <h2 className="section__title">Позиции</h2>
          </div>
          <div className="section__header-actions">
            {openPositions.length > 0 && (
              <button
                className="btn btn--danger"
                type="button"
                onClick={() => void handleDeleteAllPositions()}
                disabled={bulkDeletingPositions}
              >
                {bulkDeletingPositions ? 'Удаляем позиции...' : 'Удалить все открытые'}
              </button>
            )}
            <button
              className="btn btn--icon"
              type="button"
              onClick={() => setIsCreateDialogOpen(true)}
              disabled={accounts.length === 0 || bulkDeletingPositions}
              aria-label="Добавить позицию"
              title="Добавить позицию"
            >
              +
            </button>
          </div>
        </div>
        <div className="panel">
          {assetTabs.length > 1 && (
            <div
              className="portfolio-type-tabs"
              onTouchStart={(event) => handleAssetSwipeStart(event.touches[0].clientX)}
              onTouchEnd={(event) => handleAssetSwipeEnd(event.changedTouches[0].clientX)}
            >
              {assetTabs.map((tab) => (
                <button
                  key={tab.code}
                  type="button"
                  className={[
                    'portfolio-type-tabs__item',
                    activeAssetTypeCode === tab.code ? 'portfolio-type-tabs__item--active' : '',
                  ].filter(Boolean).join(' ')}
                  onClick={() => setActiveAssetTypeCode(tab.code)}
                >
                  {tab.label}
                  {tab.openCount > 0 && (
                    <span className="portfolio-type-tabs__count">{tab.openCount}</span>
                  )}
                </button>
              ))}
            </div>
          )}

          {accountTabs.length > 1 && (
            <div className="portfolio-account-tabs-wrap">
              <div className="section__eyebrow" style={{ marginBottom: 8 }}>Счета</div>
              <div
                className="portfolio-account-tabs"
                onTouchStart={(event) => handleAccountSwipeStart(event.touches[0].clientX)}
                onTouchEnd={(event) => handleAccountSwipeEnd(event.changedTouches[0].clientX)}
              >
                {accountTabs.map((tab) => (
                  <button
                    key={tab.key}
                    type="button"
                    className={[
                      'portfolio-account-tabs__item',
                      activeAccountTab?.key === tab.key ? 'portfolio-account-tabs__item--active' : '',
                    ].filter(Boolean).join(' ')}
                    onClick={() => setActiveAccountTabKey(tab.key)}
                  >
                    <span className="portfolio-account-tabs__copy">
                      <span className="portfolio-account-tabs__name">{tab.accountName}</span>
                      {tab.ownerLabel && <span className="portfolio-account-tabs__meta">{tab.ownerLabel}</span>}
                      <span className="portfolio-account-tabs__value">
                        {formatAmount(tab.estimatedValue, user.base_currency_code)}
                      </span>
                    </span>
                    <span className="portfolio-account-tabs__count">{tab.openCount}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {(
            (!hideEstimatedValueInStats && activeScopeDisplayMetrics.estimatedValue > 0)
            || activeScopeDisplayMetrics.investedPrincipal > 0
            || activeScopeDisplayMetrics.cashValue > 0
            || activeScopeDisplayMetrics.resultValue !== 0
          ) && (
            <div className="portfolio-type-stats">
              {!hideEstimatedValueInStats && activeScopeDisplayMetrics.estimatedValue > 0 && (
                <div className="portfolio-type-stats__row">
                  <span className="portfolio-type-stats__label">Оценочная стоимость</span>
                  <span className="portfolio-type-stats__value">
                    {formatAmount(activeScopeDisplayMetrics.estimatedValue, user.base_currency_code)}
                  </span>
                </div>
              )}
              {activeScopeDisplayMetrics.investedPrincipal > 0 && (
                <div className="portfolio-type-stats__row">
                  <span className="portfolio-type-stats__label">Вложено</span>
                  <span className="portfolio-type-stats__value">
                    {formatAmount(activeScopeDisplayMetrics.investedPrincipal, user.base_currency_code)}
                  </span>
                </div>
              )}
              {activeScopeDisplayMetrics.cashValue > 0 && (
                <div className="portfolio-type-stats__row">
                  <span className="portfolio-type-stats__label">Остаток</span>
                  <span className="portfolio-type-stats__value">
                    {formatAmount(activeScopeDisplayMetrics.cashValue, user.base_currency_code)}
                  </span>
                </div>
              )}
              {activeScopeDisplayMetrics.resultValue !== 0 && (
                <div className="portfolio-type-stats__row">
                  <span className="portfolio-type-stats__label">{activeScopeDisplayMetrics.resultLabel}</span>
                  <span className="portfolio-type-stats__value">
                    {formatAmount(activeScopeDisplayMetrics.resultValue, user.base_currency_code)}
                  </span>
                </div>
              )}
            </div>
          )}

          <div className="portfolio-positions-divider" />

          {accounts.length === 0 ? (
            <p className="list-row__sub">
              Сначала создай инвестиционный счет в настройках и переведи на него деньги с главного экрана.
            </p>
          ) : visibleOpenPositions.length === 0 ? (
            <p className="list-row__sub">Открытых позиций пока нет.</p>
          ) : (
            <div className="dashboard-budget-sections">
              {visibleOpenPositionGroups.map((group, index) => {
                const ownerDivider = hasMultipleOpenPositionOwners
                  && group.ownerType === 'family'
                  && visibleOpenPositionGroups[index - 1]?.ownerType !== 'family';
                const showAccountHeader = visibleOpenPositionGroups.length > 1
                  && (hasMultipleOpenPositionAccounts || hasMultipleOpenPositionOwners);
                const sections = getOpenPositionSections(group.positions);

                return (
                  <div className="dashboard-budget-section" key={`${group.ownerType}-${group.accountId}`}>
                    {ownerDivider ? (
                      <div className="cat-grid__divider" aria-hidden="true">Семейные</div>
                    ) : null}

                    {showAccountHeader ? (
                      <div className="dashboard-budget-section__header">
                        <div>
                          <div className="section__eyebrow">
                            {group.ownerType === 'family' ? 'Семейный счет' : 'Личный счет'}
                          </div>
                          <div className="section__title" style={{ fontSize: '1rem' }}>{group.accountName}</div>
                        </div>
                      </div>
                    ) : null}

                    {sections.map((section) => (
                      <div className="dashboard-budget-section" key={`${group.accountId}-${section.code}`}>
                        {activeAssetTypeCode === 'security' && (
                          <div className="portfolio-position-section-title">{section.label}</div>
                        )}
                        <div className="portfolio-position-grid">
                          {section.positions.map((position) => {
                            const posTicker = typeof position.metadata?.ticker === 'string' ? position.metadata.ticker : null;
                            const isBond = position.metadata?.moex_market === 'bonds';
                            const moexPrice = posTicker ? moexPrices.get(posTicker) : null;
                            const quote = getResolvedPositionQuote(position);
                            const currentPrice = quote.currentPrice;
                            const currentTotalValue = quote.currentTotalValue;
                            const entryAmount = getPositionEntryAmount(position);
                            const logoName = getPositionMetadataText(position, 'logo_name');
                            const logoUrl = logoName ? getTinkoffInstrumentLogoUrl(logoName) : null;
                            const unrealizedPnl = getResolvedPositionCurrentResult(position);
                            const pnlPercent = unrealizedPnl !== null && entryAmount > 0
                              ? (unrealizedPnl / entryAmount) * 100
                              : null;

                            return (
                              <button
                                key={position.id}
                                className="portfolio-position-card"
                                type="button"
                                onClick={() => void handleOpenPositionDetails(position.id)}
                              >
                                <div className="portfolio-position-card__head">
                                  <div className="portfolio-position-card__identity">
                                    {logoUrl && (
                                      <img
                                        className="instrument-logo instrument-logo--position"
                                        src={logoUrl}
                                        alt=""
                                        loading="lazy"
                                      />
                                    )}
                                    <div className="portfolio-position-card__left">
                                      <div className="portfolio-position-card__title">{position.title}</div>
                                      <div className="portfolio-position-card__sub-row">
                                        {currentPrice !== null && position.quantity ? (
                                          <span>
                                            {quote.source === 'tinkoff'
                                              ? formatAmount(currentPrice, position.currency_code)
                                              : isBond
                                              ? `${currentPrice.toFixed(2)}% от ном.`
                                              : formatAmount(currentPrice, position.currency_code)}
                                            {' · '}{position.quantity} шт.
                                            {quote.source === 'moex' && moexPrice?.last === null && <span className="portfolio-position-card__price-hint"> посл. закр.</span>}
                                          </span>
                                        ) : (
                                          <>
                                            {position.quantity ? (
                                              <span>{formatAmount(entryAmount / position.quantity, position.currency_code)} · {position.quantity} шт.</span>
                                            ) : (
                                              <span>{formatAmount(entryAmount, position.currency_code)}</span>
                                            )}
                                          </>
                                        )}
                                      </div>
                                    </div>
                                  </div>
                                  <div className="portfolio-position-card__right">
                                    <div className="portfolio-position-card__amount">
                                      {currentTotalValue !== null
                                        ? formatAmount(currentTotalValue, position.currency_code)
                                        : formatAmount(position.amount_in_currency, position.currency_code)}
                                    </div>
                                    {unrealizedPnl !== null && pnlPercent !== null && (
                                      <div className={`portfolio-position-card__pnl${unrealizedPnl >= 0 ? ' portfolio-position-card__pnl--pos' : ' portfolio-position-card__pnl--neg'}`}>
                                        {unrealizedPnl >= 0 ? '+' : ''}{unrealizedPnl.toFixed(0)} ₽
                                        {' '}({pnlPercent >= 0 ? '+' : ''}{pnlPercent.toFixed(1)}%)
                                      </div>
                                    )}
                                  </div>
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          )}

          {visibleClosedPositions.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <button
                className="btn"
                type="button"
                onClick={() => setShowClosedPositions((prev) => !prev)}
              >
                {showClosedPositions ? 'Скрыть закрытые' : `Закрытые (${visibleClosedPositions.length})`}
              </button>
              {showClosedPositions && (
                <ul className="bank-detail-list" style={{ marginTop: 12 }}>
                  {visibleClosedPositions.map((position) => (
                    <li className="bank-detail-row" key={position.id}>
                      <div className="bank-detail-row__main">
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                            <span className="pill">{position.currency_code}</span>
                            <strong className="bank-detail-row__amount">{position.title}</strong>
                          </div>
                          <div className="bank-detail-row__sub">
                            {position.investment_account_name} · вход {formatAmount(position.amount_in_currency, position.currency_code)}
                            {position.close_amount_in_currency && position.close_currency_code
                              ? ` · выход ${formatAmount(position.close_amount_in_currency, position.close_currency_code)}`
                              : ''}
                            {position.closed_at ? ` · закрыта ${formatDateLabel(position.closed_at)}` : ''}
                          </div>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      </section>

      {selectedPosition && (
        <div className="modal-backdrop" onClick={() => setSelectedPositionId(null)}>
          <div className="modal-card" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <div className="section__header">
                <div>
                  <div className="section__eyebrow">
                    {selectedPosition.investment_account_owner_type === 'family' ? 'Семейный счет' : 'Личный счет'} · {selectedPosition.investment_account_name}
                  </div>
                  <h2 className="section__title">{selectedPosition.title}</h2>
                </div>
              </div>
            </div>

            <div className="modal-body">
              <div className="portfolio-position-detail">
                {(() => {
                  const detailTicker = typeof selectedPosition.metadata?.ticker === 'string' ? selectedPosition.metadata.ticker : null;
                  const detailMoexPrice = detailTicker ? moexPrices.get(detailTicker) : null;
                  const detailQuote = getResolvedPositionQuote(selectedPosition);
                  const detailCurrentPrice = detailQuote.currentPrice;
                  const detailCurrentTotal = detailQuote.currentTotalValue;
                  const detailEntryAmount = getPositionEntryAmount(selectedPosition);
                  const detailPnl = getResolvedPositionCurrentResult(selectedPosition);
                  const detailPnlPct = detailPnl !== null && detailEntryAmount > 0
                    ? (detailPnl / detailEntryAmount) * 100
                    : null;
                  return (
                    <>
                      {detailTicker && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                          <span className="portfolio-position-card__ticker" style={{ fontSize: '0.8rem', padding: '2px 8px' }}>
                            {detailTicker}
                          </span>
                          <span className="pill">{selectedPosition.currency_code}</span>
                          {detailQuote.source === 'moex' && detailMoexPrice?.last === null && detailMoexPrice?.prevClose !== null && (
                            <span className="portfolio-position-card__price-hint">цена закрытия</span>
                          )}
                        </div>
                      )}
                      <div className="portfolio-position-detail__summary">
                        {!detailTicker && <span className="pill">{selectedPosition.currency_code}</span>}
                        <div style={{ flex: 1 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
                            <span className="settings-row__sub">Вложено</span>
                            <strong className="portfolio-position-detail__amount">
                              {formatAmount(detailEntryAmount, selectedPosition.currency_code)}
                            </strong>
                          </div>
                          {detailCurrentTotal !== null && (
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, marginTop: 4 }}>
                              <span className="settings-row__sub">Текущая стоимость</span>
                              <strong className="portfolio-position-detail__amount">
                                {formatAmount(detailCurrentTotal, selectedPosition.currency_code)}
                              </strong>
                            </div>
                          )}
                          {detailPnl !== null && detailPnlPct !== null && (
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, marginTop: 6 }}>
                              <span className="settings-row__sub">Нереализованный P&L</span>
                              <span className={`portfolio-position-card__pnl${detailPnl >= 0 ? ' portfolio-position-card__pnl--pos' : ' portfolio-position-card__pnl--neg'}`}>
                                {detailPnl >= 0 ? '+' : ''}{formatAmount(detailPnl, selectedPosition.currency_code)}
                                {' '}({detailPnlPct >= 0 ? '+' : ''}{detailPnlPct.toFixed(1)}%)
                              </span>
                            </div>
                          )}
                        </div>
                      </div>
                    </>
                  );
                })()}
                <div className="portfolio-position-detail__meta">
                  <span>Дата входа: {formatDateLabel(selectedPosition.opened_at)}</span>
                  {selectedPosition.quantity ? <span>Количество: {selectedPosition.quantity} шт.</span> : null}
                  {getPositionInvestedPrincipal(selectedPosition) > 0
                    ? <span>Себестоимость: {formatAmount(getPositionInvestedPrincipal(selectedPosition), user.base_currency_code)}</span>
                    : null}
                  {(getPositionMetadataNumber(selectedPosition, 'accrued_interest_paid_in_base') ?? 0) > 0
                    ? (
                      <span>
                        НКД при покупке: {formatAmount(getPositionMetadataNumber(selectedPosition, 'accrued_interest_paid_in_base') ?? 0, user.base_currency_code)}
                      </span>
                    )
                    : null}
                  {typeof selectedPosition.metadata?.fees_in_base === 'number' && Number(selectedPosition.metadata.fees_in_base) > 0
                    ? <span>Комиссии: {formatAmount(Number(selectedPosition.metadata.fees_in_base), user.base_currency_code)}</span>
                    : null}
                </div>
                {selectedPosition.comment ? (
                  <p className="list-row__sub" style={{ marginTop: 10 }}>
                    {selectedPosition.comment}
                  </p>
                ) : null}
              </div>

              <div className="form-row">
                <button
                  className="btn btn--primary"
                  type="button"
                  onClick={() => handleOpenCloseForm(selectedPosition)}
                >
                  Закрыть позицию
                </button>
                {canRecordPositionIncome(selectedPosition) && (
                  <button
                    className="btn"
                    type="button"
                    onClick={() => handleOpenIncomeForm(selectedPosition)}
                  >
                    Начислить доход
                  </button>
                )}
                <button
                  className="btn"
                  type="button"
                  onClick={() => handleOpenPartialCloseForm(selectedPosition)}
                >
                  Частично закрыть
                </button>
                <button
                  className="btn"
                  type="button"
                  onClick={() => handleOpenTopUpForm(selectedPosition)}
                >
                  Пополнить
                </button>
                <button
                  className="btn"
                  type="button"
                  onClick={() => handleOpenFeeForm(selectedPosition)}
                >
                  Комиссия
                </button>
                <button
                  className="btn"
                  type="button"
                  disabled={deletingPositionId === selectedPosition.id}
                  onClick={() => void handleDeletePosition(selectedPosition)}
                >
                  {deletingPositionId === selectedPosition.id ? 'Удаляем...' : 'Удалить'}
                </button>
              </div>

              {closeDrafts[selectedPosition.id] && (
                <form onSubmit={(event) => void handleClosePosition(selectedPosition.id, event)}>
                  <div className="form-row">
                    <input
                      className="input"
                      type="text"
                      inputMode="decimal"
                      placeholder="Сумма выхода"
                      value={closeDrafts[selectedPosition.id].amount}
                      onChange={(event) => handleCloseDraftChange(selectedPosition.id, { amount: event.target.value })}
                      disabled={submittingCloseId === selectedPosition.id}
                      style={{ width: 180 }}
                    />
                    <select
                      className="input"
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
                    <input
                      className="input"
                      type="date"
                      value={closeDrafts[selectedPosition.id].closedAt}
                      onChange={(event) => handleCloseDraftChange(selectedPosition.id, { closedAt: event.target.value })}
                      disabled={submittingCloseId === selectedPosition.id}
                    />
                  </div>
                  {closeDrafts[selectedPosition.id].currencyCode !== user.base_currency_code && (
                    <div className="form-row">
                      <input
                        className="input"
                        type="text"
                        inputMode="decimal"
                        placeholder={`Историческая стоимость в ${user.base_currency_code}`}
                        value={closeDrafts[selectedPosition.id].baseAmount}
                        onChange={(event) => handleCloseDraftChange(selectedPosition.id, { baseAmount: event.target.value })}
                        disabled={submittingCloseId === selectedPosition.id}
                        style={{ width: 260 }}
                      />
                    </div>
                  )}
                  <div className="form-row">
                    <input
                      className="input"
                      type="text"
                      placeholder="Комментарий к закрытию"
                      value={closeDrafts[selectedPosition.id].comment}
                      onChange={(event) => handleCloseDraftChange(selectedPosition.id, { comment: event.target.value })}
                      disabled={submittingCloseId === selectedPosition.id}
                      style={{ flex: '1 1 280px' }}
                    />
                    <button className="btn btn--primary" type="submit" disabled={submittingCloseId === selectedPosition.id}>
                      {submittingCloseId === selectedPosition.id ? 'Закрываем...' : 'Подтвердить закрытие'}
                    </button>
                  </div>
                </form>
              )}

              {partialCloseDrafts[selectedPosition.id] && (
                <form onSubmit={(event) => void handlePartialClosePosition(selectedPosition, event)}>
                  <div className="form-row">
                    <input
                      className="input"
                      type="text"
                      inputMode="decimal"
                      placeholder="Сумма возврата"
                      value={partialCloseDrafts[selectedPosition.id].returnAmount}
                      onChange={(event) => handlePartialCloseDraftChange(selectedPosition.id, { returnAmount: event.target.value })}
                      disabled={submittingPartialCloseId === selectedPosition.id}
                      style={{ width: 180 }}
                    />
                    <select
                      className="input"
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
                    <input
                      className="input"
                      type="text"
                      inputMode="decimal"
                      placeholder="Списать principal"
                      value={partialCloseDrafts[selectedPosition.id].principalReduction}
                      onChange={(event) => handlePartialCloseDraftChange(selectedPosition.id, { principalReduction: event.target.value })}
                      disabled={submittingPartialCloseId === selectedPosition.id}
                      style={{ width: 180 }}
                    />
                    {selectedPosition.quantity !== null && selectedPosition.quantity !== undefined && (
                      <input
                        className="input"
                        type="text"
                        inputMode="decimal"
                        placeholder="Списать количество"
                        value={partialCloseDrafts[selectedPosition.id].closedQuantity}
                        onChange={(event) => handlePartialCloseDraftChange(selectedPosition.id, { closedQuantity: event.target.value })}
                        disabled={submittingPartialCloseId === selectedPosition.id}
                        style={{ width: 180 }}
                      />
                    )}
                  </div>
                  <div className="form-row">
                    <input
                      className="input"
                      type="date"
                      value={partialCloseDrafts[selectedPosition.id].closedAt}
                      onChange={(event) => handlePartialCloseDraftChange(selectedPosition.id, { closedAt: event.target.value })}
                      disabled={submittingPartialCloseId === selectedPosition.id}
                    />
                    {partialCloseDrafts[selectedPosition.id].returnCurrencyCode !== user.base_currency_code && (
                      <input
                        className="input"
                        type="text"
                        inputMode="decimal"
                        placeholder={`Историческая стоимость возврата в ${user.base_currency_code}`}
                        value={partialCloseDrafts[selectedPosition.id].returnBaseAmount}
                        onChange={(event) => handlePartialCloseDraftChange(selectedPosition.id, { returnBaseAmount: event.target.value })}
                        disabled={submittingPartialCloseId === selectedPosition.id}
                        style={{ flex: '1 1 260px' }}
                      />
                    )}
                  </div>
                  <div className="form-row">
                    <input
                      className="input"
                      type="text"
                      placeholder="Комментарий к частичному закрытию"
                      value={partialCloseDrafts[selectedPosition.id].comment}
                      onChange={(event) => handlePartialCloseDraftChange(selectedPosition.id, { comment: event.target.value })}
                      disabled={submittingPartialCloseId === selectedPosition.id}
                      style={{ flex: '1 1 280px' }}
                    />
                    <button className="btn btn--primary" type="submit" disabled={submittingPartialCloseId === selectedPosition.id}>
                      {submittingPartialCloseId === selectedPosition.id ? 'Проводим...' : 'Подтвердить частичное закрытие'}
                    </button>
                  </div>
                </form>
              )}

              {incomeDrafts[selectedPosition.id] && (
                <form onSubmit={(event) => void handleRecordIncome(selectedPosition, event)}>
                  <div className="form-row">
                    <input
                      className="input"
                      type="text"
                      inputMode="decimal"
                      placeholder={selectedPosition.asset_type_code === 'deposit' ? 'Сумма процентов' : 'Сумма дивидендов'}
                      value={incomeDrafts[selectedPosition.id].amount}
                      onChange={(event) => handleIncomeDraftChange(selectedPosition.id, { amount: event.target.value })}
                      disabled={submittingIncomeId === selectedPosition.id}
                      style={{ width: 180 }}
                    />
                    <select
                      className="input"
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
                    <select
                      className="input"
                      value={incomeDrafts[selectedPosition.id].incomeKind}
                      onChange={(event) => handleIncomeDraftChange(selectedPosition.id, { incomeKind: event.target.value })}
                      disabled={submittingIncomeId === selectedPosition.id}
                    >
                      {selectedPosition.asset_type_code === 'deposit' ? (
                        <>
                          <option value="interest">Проценты</option>
                          <option value="other">Другой доход</option>
                        </>
                      ) : (
                        <>
                          <option value="dividend">Дивиденды</option>
                          <option value="coupon">Купон</option>
                          <option value="other">Другой доход</option>
                        </>
                      )}
                    </select>
                    <input
                      className="input"
                      type="date"
                      value={incomeDrafts[selectedPosition.id].receivedAt}
                      onChange={(event) => handleIncomeDraftChange(selectedPosition.id, { receivedAt: event.target.value })}
                      disabled={submittingIncomeId === selectedPosition.id}
                    />
                  </div>
                  <div className="form-row">
                    {incomeDrafts[selectedPosition.id].currencyCode !== user.base_currency_code && (
                      <input
                        className="input"
                        type="text"
                        inputMode="decimal"
                        placeholder={`Историческая стоимость в ${user.base_currency_code}`}
                        value={incomeDrafts[selectedPosition.id].baseAmount}
                        onChange={(event) => handleIncomeDraftChange(selectedPosition.id, { baseAmount: event.target.value })}
                        disabled={submittingIncomeId === selectedPosition.id}
                        style={{ flex: '1 1 260px' }}
                      />
                    )}
                    <input
                      className="input"
                      type="text"
                      placeholder="Комментарий к доходу"
                      value={incomeDrafts[selectedPosition.id].comment}
                      onChange={(event) => handleIncomeDraftChange(selectedPosition.id, { comment: event.target.value })}
                      disabled={submittingIncomeId === selectedPosition.id}
                      style={{ flex: '1 1 280px' }}
                    />
                    <button className="btn btn--primary" type="submit" disabled={submittingIncomeId === selectedPosition.id}>
                      {submittingIncomeId === selectedPosition.id ? 'Начисляем...' : 'Подтвердить доход'}
                    </button>
                  </div>
                </form>
              )}

              {topUpDrafts[selectedPosition.id] && (
                <form onSubmit={(event) => void handleTopUpPosition(selectedPosition, event)}>
                  <div className="form-row">
                    <input
                      className="input"
                      type="text"
                      inputMode="decimal"
                      placeholder="Сумма пополнения"
                      value={topUpDrafts[selectedPosition.id].amount}
                      onChange={(event) => handleTopUpDraftChange(selectedPosition.id, { amount: event.target.value })}
                      disabled={submittingTopUpId === selectedPosition.id}
                      style={{ width: 180 }}
                    />
                    <input
                      className="input"
                      type="text"
                      inputMode="decimal"
                      placeholder="Количество, если есть"
                      value={topUpDrafts[selectedPosition.id].quantity}
                      onChange={(event) => handleTopUpDraftChange(selectedPosition.id, { quantity: event.target.value })}
                      disabled={submittingTopUpId === selectedPosition.id}
                      style={{ width: 180 }}
                    />
                    <select
                      className="input"
                      value={topUpDrafts[selectedPosition.id].currencyCode}
                      onChange={(event) => handleTopUpDraftChange(selectedPosition.id, { currencyCode: event.target.value })}
                      disabled={submittingTopUpId === selectedPosition.id}
                    >
                      <option value={selectedPosition.currency_code}>{selectedPosition.currency_code}</option>
                    </select>
                    <input
                      className="input"
                      type="date"
                      value={topUpDrafts[selectedPosition.id].toppedUpAt}
                      onChange={(event) => handleTopUpDraftChange(selectedPosition.id, { toppedUpAt: event.target.value })}
                      disabled={submittingTopUpId === selectedPosition.id}
                    />
                  </div>
                  <div className="form-row">
                    <input
                      className="input"
                      type="text"
                      placeholder="Комментарий к пополнению"
                      value={topUpDrafts[selectedPosition.id].comment}
                      onChange={(event) => handleTopUpDraftChange(selectedPosition.id, { comment: event.target.value })}
                      disabled={submittingTopUpId === selectedPosition.id}
                      style={{ flex: '1 1 280px' }}
                    />
                    <button className="btn btn--primary" type="submit" disabled={submittingTopUpId === selectedPosition.id}>
                      {submittingTopUpId === selectedPosition.id ? 'Пополняем...' : 'Подтвердить пополнение'}
                    </button>
                  </div>
                </form>
              )}

              {feeDrafts[selectedPosition.id] && (
                <form onSubmit={(event) => void handleRecordFee(selectedPosition, event)}>
                  <div className="form-row">
                    <input
                      className="input"
                      type="text"
                      inputMode="decimal"
                      placeholder="Сумма комиссии"
                      value={feeDrafts[selectedPosition.id].amount}
                      onChange={(event) => handleFeeDraftChange(selectedPosition.id, { amount: event.target.value })}
                      disabled={submittingFeeId === selectedPosition.id}
                      style={{ width: 180 }}
                    />
                    <select
                      className="input"
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
                    <input
                      className="input"
                      type="date"
                      value={feeDrafts[selectedPosition.id].chargedAt}
                      onChange={(event) => handleFeeDraftChange(selectedPosition.id, { chargedAt: event.target.value })}
                      disabled={submittingFeeId === selectedPosition.id}
                    />
                    <span className="list-row__sub">
                      Доступно: {formatAmount(getAccountBalanceForCurrency(selectedPosition.investment_account_id, feeDrafts[selectedPosition.id].currencyCode), feeDrafts[selectedPosition.id].currencyCode)}
                    </span>
                  </div>
                  <div className="form-row">
                    <input
                      className="input"
                      type="text"
                      placeholder="Комментарий к комиссии"
                      value={feeDrafts[selectedPosition.id].comment}
                      onChange={(event) => handleFeeDraftChange(selectedPosition.id, { comment: event.target.value })}
                      disabled={submittingFeeId === selectedPosition.id}
                      style={{ flex: '1 1 280px' }}
                    />
                    <button className="btn btn--primary" type="submit" disabled={submittingFeeId === selectedPosition.id}>
                      {submittingFeeId === selectedPosition.id ? 'Списываем...' : 'Подтвердить комиссию'}
                    </button>
                  </div>
                </form>
              )}

              {closeError && <p style={{ color: 'var(--tag-out-fg)', fontSize: '0.85rem', marginTop: 12 }}>{closeError}</p>}
              {incomeError && <p style={{ color: 'var(--tag-out-fg)', fontSize: '0.85rem', marginTop: 12 }}>{incomeError}</p>}
              {topUpError && <p style={{ color: 'var(--tag-out-fg)', fontSize: '0.85rem', marginTop: 12 }}>{topUpError}</p>}
              {partialCloseError && <p style={{ color: 'var(--tag-out-fg)', fontSize: '0.85rem', marginTop: 12 }}>{partialCloseError}</p>}
              {feeError && <p style={{ color: 'var(--tag-out-fg)', fontSize: '0.85rem', marginTop: 12 }}>{feeError}</p>}
              {deleteError && <p style={{ color: 'var(--tag-out-fg)', fontSize: '0.85rem', marginTop: 12 }}>{deleteError}</p>}
              {cancelIncomeError && <p style={{ color: 'var(--tag-out-fg)', fontSize: '0.85rem', marginTop: 12 }}>{cancelIncomeError}</p>}

              <div style={{ marginTop: 12 }}>
                <div className="section__eyebrow" style={{ marginBottom: 8 }}>События</div>
                {eventsError && (
                  <p style={{ color: 'var(--tag-out-fg)', fontSize: '0.85rem' }}>
                    {eventsError}
                  </p>
                )}
                {eventsLoadingId === selectedPosition.id ? (
                  <p className="list-row__sub">Загружаем события...</p>
                ) : (
                  <ul className="bank-detail-list">
                    {selectedPositionEvents.map((item) => (
                      <li className="bank-detail-row" key={item.id}>
                        <div className="bank-detail-row__main">
                          <span className="pill">{getEventLabel(item)}</span>
                          <strong className="bank-detail-row__amount">
                            {item.amount !== null && item.amount !== undefined && item.currency_code
                              ? formatAmount(item.amount, item.currency_code)
                              : 'Без суммы'}
                          </strong>
                        </div>
                        <div className="bank-detail-row__sub">
                          {formatDateLabel(item.event_at)}
                          {item.quantity ? ` · Количество: ${item.quantity}` : ''}
                          {item.event_type === 'partial_close' && typeof item.metadata?.principal_amount_in_currency === 'number'
                            ? ` · Principal: ${formatAmount(Number(item.metadata.principal_amount_in_currency), selectedPosition.currency_code)}`
                            : ''}
                          {item.linked_operation_id ? ` · Операция #${item.linked_operation_id}` : ''}
                          {item.comment ? ` · ${item.comment}` : ''}
                        </div>
                        {item.event_type === 'income' && (
                          <div className="form-row" style={{ paddingTop: 8 }}>
                            {selectedPositionCancelledIncomeIds.has(item.id) ? (
                              <span className="tag tag--neutral">Уже отменен</span>
                            ) : (
                              <button
                                className="btn"
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
            </div>

            <div className="modal-actions">
              <div className="action-pill">
                <button className="action-pill__cancel" type="button" onClick={() => setSelectedPositionId(null)}>
                  Закрыть
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {isCreateDialogOpen && (
        <PortfolioPositionDialog
          accounts={accounts}
          currencies={currencies}
          user={user}
          defaultAssetTypeCode={activeAssetTypeCode}
          defaultAssetTypeLabel={activeAssetTab?.label ?? assetTypeLabel(activeAssetTypeCode)}
          onClose={() => setIsCreateDialogOpen(false)}
          onSuccess={() => {
            setIsCreateDialogOpen(false);
            void loadPortfolio();
          }}
        />
      )}

      {showAccountsModal && (
        <div className="modal-backdrop" onClick={() => setShowAccountsModal(false)}>
          <div className="modal-card modal-card--compact" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="section__title" style={{ fontSize: '1.05rem' }}>Инвестиционные счета</h2>
            </div>
            <div className="modal-body">
              {accounts.map(({ account, balances }) => {
                const summary = summaryByAccountId[account.id];
                const conn = tinkoffConnections.find((c) => c.linked_account_id === account.id);
                const liveMetrics = getConnectedSecurityMetrics(account.id);
                const estimatedValue = liveMetrics.estimatedValue;
                const investedPrincipal = liveMetrics.investedPrincipal;
                const currentResult = liveMetrics.currentResult;
                return (
                  <div key={account.id} className="portfolio-account-modal-item">
                    <div className="portfolio-account-modal-item__header">
                      <div>
                        <div className="portfolio-account-modal-item__name">{account.name}</div>
                        <div className="portfolio-account-modal-item__owner">
                          {account.owner_type === 'family' ? 'Семейный' : 'Личный'}
                          {account.provider_name ? ` · ${account.provider_name}` : ''}
                        </div>
                      </div>
                      {conn && (
                        <button
                          type="button"
                          className="tinkoff-sync-btn"
                          onClick={() => {
                            setShowAccountsModal(false);
                            setSyncDialogConnection(conn);
                          }}
                        >
                          ↻ Подтянуть
                          {conn.last_synced_at && (
                            <span className="tinkoff-sync-btn__last">
                              {new Date(conn.last_synced_at).toLocaleDateString('ru')}
                            </span>
                          )}
                        </button>
                      )}
                    </div>
                    <div className="hero-card__breakdown" style={{ marginTop: 8 }}>
                      {balances.map((b) => (
                        <div key={b.currency_code} className="hero-card__breakdown-row">
                          <span>Кэш {b.currency_code}</span>
                          <strong>{formatAmount(b.amount, b.currency_code)}</strong>
                        </div>
                      ))}
                      {estimatedValue > 0 && (
                        <div className="hero-card__breakdown-row">
                          <span>Оценочная стоимость</span>
                          <strong>{formatAmount(estimatedValue, user.base_currency_code)}</strong>
                        </div>
                      )}
                      {investedPrincipal > 0 && (
                        <div className="hero-card__breakdown-row">
                          <span>Вложено</span>
                          <strong>{formatAmount(investedPrincipal, user.base_currency_code)}</strong>
                        </div>
                      )}
                      {currentResult !== 0 && (
                        <div className="hero-card__breakdown-row">
                          <span>Текущий результат</span>
                          <strong>{formatAmount(currentResult, user.base_currency_code)}</strong>
                        </div>
                      )}
                      {summary && summary.realized_income_in_base !== 0 && (
                        <div className="hero-card__breakdown-row">
                          <span>Зафиксированный доход</span>
                          <strong>{formatAmount(summary.realized_income_in_base, user.base_currency_code)}</strong>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
              {accounts.length === 0 && (
                <p style={{ color: 'var(--text-tertiary)', fontSize: '0.88rem' }}>
                  Инвестиционных счетов нет. Создай в Настройках → Инвестиции.
                </p>
              )}
            </div>
            <div className="modal-actions">
              <button className="btn" type="button" onClick={() => setShowAccountsModal(false)}>
                Закрыть
              </button>
            </div>
          </div>
        </div>
      )}

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
    </>
  );
}
