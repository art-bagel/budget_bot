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
  partialClosePortfolioPosition,
  recordPortfolioFee,
  recordPortfolioIncome,
  topUpPortfolioPosition,
} from '../api';
import PortfolioPositionDialog from '../components/PortfolioPositionDialog';
import type {
  BankAccount,
  Currency,
  DashboardBankBalance,
  PortfolioEvent,
  PortfolioPosition,
  PortfolioSummaryItem,
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
  const [showClosedPositions, setShowClosedPositions] = useState(false);
  const [moexPrices, setMoexPrices] = useState<Map<string, MoexPrice>>(new Map());

  const loadPortfolio = async () => {
    setLoading(true);
    setError(null);

    try {
      const [investmentAccounts, loadedPositions, loadedCurrencies, loadedSummary] = await Promise.all([
        fetchBankAccounts('investment'),
        fetchPortfolioPositions(),
        fetchCurrencies(),
        fetchPortfolioSummary(),
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

  const totalInvestedPrincipalInBase = useMemo(
    () => summaryItems.reduce((sum, item) => sum + item.invested_principal_in_base, 0),
    [summaryItems],
  );

  const totalRealizedIncomeInBase = useMemo(
    () => summaryItems.reduce((sum, item) => sum + item.realized_income_in_base, 0),
    [summaryItems],
  );

  const totalInvestmentCashInBase = useMemo(
    () => summaryItems.reduce((sum, item) => sum + item.cash_balance_in_base, 0),
    [summaryItems],
  );

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

  const hasMultipleOpenPositionOwners = useMemo(
    () => new Set(filteredOpenPositionGroups.map((group) => group.ownerType)).size > 1,
    [filteredOpenPositionGroups],
  );

  const hasMultipleOpenPositionAccounts = filteredOpenPositionGroups.length > 1;

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

      <article className="hero-card">
        <span className="hero-card__label">Инвестиционный портфель</span>
        <strong className="hero-card__value">
          {formatAmount(totalInvestedPrincipalInBase + totalRealizedIncomeInBase + totalInvestmentCashInBase, user.base_currency_code)}
        </strong>
        <div className="hero-card__breakdown">
          <div className="hero-card__breakdown-row">
            <span>Вложено</span>
            <strong>{formatAmount(totalInvestedPrincipalInBase, user.base_currency_code)}</strong>
          </div>
          <div className="hero-card__breakdown-row">
            <span>Доход</span>
            <strong>{formatAmount(totalRealizedIncomeInBase, user.base_currency_code)}</strong>
          </div>
          <div className="hero-card__breakdown-row">
            <span>Кэш</span>
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
          <button
            className="btn btn--icon"
            type="button"
            onClick={() => setIsCreateDialogOpen(true)}
            disabled={accounts.length === 0}
            aria-label="Добавить позицию"
            title="Добавить позицию"
          >
            +
          </button>
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

          {activeAssetTab && (activeAssetTab.principalInBase > 0 || activeAssetTab.incomeInBase > 0) && (
            <div className="portfolio-type-stats">
              {activeAssetTab.principalInBase > 0 && (
                <div className="portfolio-type-stats__row">
                  <span className="portfolio-type-stats__label">Вложено</span>
                  <span className="portfolio-type-stats__value">
                    {formatAmount(activeAssetTab.principalInBase, user.base_currency_code)}
                  </span>
                </div>
              )}
              {activeAssetTab.incomeInBase > 0 && (
                <div className="portfolio-type-stats__row">
                  <span className="portfolio-type-stats__label">Доход</span>
                  <span className="portfolio-type-stats__value">
                    {formatAmount(activeAssetTab.incomeInBase, user.base_currency_code)}
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
          ) : filteredOpenPositions.length === 0 ? (
            <p className="list-row__sub">Открытых позиций пока нет.</p>
          ) : (
            <div className="dashboard-budget-sections">
              {filteredOpenPositionGroups.map((group, index) => {
                const ownerDivider = hasMultipleOpenPositionOwners
                  && group.ownerType === 'family'
                  && filteredOpenPositionGroups[index - 1]?.ownerType !== 'family';
                const showAccountHeader = hasMultipleOpenPositionAccounts || hasMultipleOpenPositionOwners;
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
                            const unitPrice = formatUnitPrice(position.amount_in_currency, position.quantity, position.currency_code);
                            const posTicker = typeof position.metadata?.ticker === 'string' ? position.metadata.ticker : null;
                            const posMarket = position.metadata?.moex_market;
                            const moexPrice = posTicker ? moexPrices.get(posTicker) : null;
                            const currentPrice = moexPrice?.last ?? moexPrice?.prevClose ?? null;
                            const isBond = posMarket === 'bonds';

                            // For shares: P&L = (currentPrice * quantity) - entryAmount
                            // For bonds: price is % of nominal (usually 1000 RUB), show price only
                            const unrealizedPnl = !isBond && currentPrice !== null && position.quantity
                              ? currentPrice * position.quantity - position.amount_in_currency
                              : null;
                            const pnlPercent = unrealizedPnl !== null && position.amount_in_currency > 0
                              ? (unrealizedPnl / position.amount_in_currency) * 100
                              : null;

                            return (
                              <button
                                key={position.id}
                                className="portfolio-position-card"
                                type="button"
                                onClick={() => void handleOpenPositionDetails(position.id)}
                              >
                                <div className="portfolio-position-card__head">
                                  <div className="portfolio-position-card__title">
                                    {posTicker && (
                                      <span className="portfolio-position-card__ticker">{posTicker}</span>
                                    )}
                                    {position.title}
                                  </div>
                                  <div className="portfolio-position-card__amount">
                                    {formatAmount(position.amount_in_currency, position.currency_code)}
                                  </div>
                                </div>
                                {currentPrice !== null && (
                                  <div className="portfolio-position-card__price-row">
                                    <span className="portfolio-position-card__price">
                                      {isBond
                                        ? `${currentPrice.toFixed(2)}% от ном.`
                                        : formatAmount(currentPrice, position.currency_code)}
                                    </span>
                                    {pnlPercent !== null && (
                                      <span className={`portfolio-position-card__pnl${unrealizedPnl! >= 0 ? ' portfolio-position-card__pnl--pos' : ' portfolio-position-card__pnl--neg'}`}>
                                        {unrealizedPnl! >= 0 ? '+' : ''}{unrealizedPnl!.toFixed(0)} ₽
                                        {' '}({pnlPercent >= 0 ? '+' : ''}{pnlPercent.toFixed(1)}%)
                                      </span>
                                    )}
                                    {moexPrice?.last === null && (
                                      <span className="portfolio-position-card__price-hint">посл. закр.</span>
                                    )}
                                  </div>
                                )}
                                <div className="portfolio-position-card__meta">
                                  {unitPrice ? <span>Цена входа: {unitPrice}</span> : null}
                                  {position.quantity ? <span>{position.quantity} шт</span> : null}
                                  {typeof position.metadata?.amount_in_base === 'number' ? (
                                    <span>Себестоимость: {formatAmount(Number(position.metadata.amount_in_base), user.base_currency_code)}</span>
                                  ) : null}
                                  {typeof position.metadata?.fees_in_base === 'number' && Number(position.metadata.fees_in_base) > 0 ? (
                                    <span>Комиссии</span>
                                  ) : null}
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

          {filteredClosedPositions.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <button
                className="btn"
                type="button"
                onClick={() => setShowClosedPositions((prev) => !prev)}
              >
                {showClosedPositions ? 'Скрыть закрытые' : `Закрытые (${filteredClosedPositions.length})`}
              </button>
              {showClosedPositions && (
                <ul className="bank-detail-list" style={{ marginTop: 12 }}>
                  {filteredClosedPositions.map((position) => (
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
                <div className="portfolio-position-detail__summary">
                  <span className="pill">{selectedPosition.currency_code}</span>
                  <strong className="portfolio-position-detail__amount">
                    {formatAmount(selectedPosition.amount_in_currency, selectedPosition.currency_code)}
                  </strong>
                </div>
                <div className="portfolio-position-detail__meta">
                  <span>Дата входа: {formatDateLabel(selectedPosition.opened_at)}</span>
                  {selectedPosition.quantity ? <span>Количество: {selectedPosition.quantity}</span> : null}
                  {typeof selectedPosition.metadata?.amount_in_base === 'number'
                    ? <span>Себестоимость: {formatAmount(Number(selectedPosition.metadata.amount_in_base), user.base_currency_code)}</span>
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
    </>
  );
}
