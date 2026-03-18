import { type FormEvent, useEffect, useMemo, useState } from 'react';

import {
  cancelPortfolioIncome,
  closePortfolioPosition,
  createPortfolioPosition,
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
};

const ASSET_TYPE_OPTIONS = [
  { value: 'security', label: 'Ценные бумаги' },
  { value: 'deposit', label: 'Депозит' },
  { value: 'crypto', label: 'Криптовалюта' },
] as const;

const DEFAULT_PORTFOLIO_ASSET_TYPE_CODES = ['security', 'deposit', 'crypto'] as const;


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
  const [loading, setLoading] = useState(true);
  const [submittingCreate, setSubmittingCreate] = useState(false);
  const [submittingCloseId, setSubmittingCloseId] = useState<number | null>(null);
  const [submittingIncomeId, setSubmittingIncomeId] = useState<number | null>(null);
  const [submittingTopUpId, setSubmittingTopUpId] = useState<number | null>(null);
  const [submittingPartialCloseId, setSubmittingPartialCloseId] = useState<number | null>(null);
  const [submittingFeeId, setSubmittingFeeId] = useState<number | null>(null);
  const [deletingPositionId, setDeletingPositionId] = useState<number | null>(null);
  const [cancellingIncomeEventId, setCancellingIncomeEventId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
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
  const [newInvestmentAccountId, setNewInvestmentAccountId] = useState('');
  const [newAssetTypeCode, setNewAssetTypeCode] = useState<(typeof ASSET_TYPE_OPTIONS)[number]['value']>('security');
  const [newTitle, setNewTitle] = useState('');
  const [newQuantity, setNewQuantity] = useState('');
  const [newAmount, setNewAmount] = useState('');
  const [newCurrencyCode, setNewCurrencyCode] = useState(user.base_currency_code);
  const [newOpenedAt, setNewOpenedAt] = useState(todayIso());
  const [newComment, setNewComment] = useState('');

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
      setNewInvestmentAccountId((currentValue) => {
        if (currentValue && investmentAccounts.some((account) => String(account.id) === currentValue)) {
          return currentValue;
        }
        return investmentAccounts[0] ? String(investmentAccounts[0].id) : '';
      });
      setNewCurrencyCode((currentValue) => (
        loadedCurrencies.some((currency) => currency.code === currentValue)
          ? currentValue
          : (loadedCurrencies[0]?.code ?? user.base_currency_code)
      ));
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadPortfolio();
  }, [user.user_id]);

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

  const selectedAccountBalances = useMemo(
    () => accounts.find(({ account }) => String(account.id) === newInvestmentAccountId)?.balances ?? [],
    [accounts, newInvestmentAccountId],
  );

  const selectedCurrencyBalance = useMemo(
    () => selectedAccountBalances.find((balance) => balance.currency_code === newCurrencyCode)?.amount ?? 0,
    [selectedAccountBalances, newCurrencyCode],
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

  const handleToggleEvents = async (positionId: number) => {
    if (selectedPositionId === positionId) {
      setSelectedPositionId(null);
      return;
    }

    setSelectedPositionId(positionId);
    if (!eventsByPosition[positionId]) {
      await loadEventsForPosition(positionId);
    }
  };

  const handleCreatePosition = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!newInvestmentAccountId || !newTitle.trim() || !newAmount.trim() || submittingCreate) {
      return;
    }

    if (Number(newAmount) > selectedCurrencyBalance) {
      setCreateError('Недостаточно денег на инвестиционном счете для открытия позиции.');
      return;
    }

    setSubmittingCreate(true);
    setCreateError(null);

    try {
      await createPortfolioPosition({
        investment_account_id: Number(newInvestmentAccountId),
        asset_type_code: newAssetTypeCode,
        title: newTitle.trim(),
        quantity: newQuantity.trim() ? Number(newQuantity) : undefined,
        amount_in_currency: Number(newAmount),
        currency_code: newCurrencyCode,
        opened_at: newOpenedAt || undefined,
        comment: newComment.trim() || undefined,
      });
      setNewAssetTypeCode('security');
      setNewTitle('');
      setNewQuantity('');
      setNewAmount('');
      setNewOpenedAt(todayIso());
      setNewComment('');
      await loadPortfolio();
    } catch (reason: unknown) {
      setCreateError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSubmittingCreate(false);
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

      <section className="section">
        <div className="section__header">
          <h2 className="section__title">Сводка</h2>
        </div>
        <div className="panel">
          {error && (
            <p style={{ color: 'var(--tag-out-fg)', fontSize: '0.85rem', marginBottom: 12 }}>
              {error}
            </p>
          )}

          <div className="balance-scroll">
            <article className="balance-card">
              <div className="balance-card__head">
                <span className="pill">BASE</span>
                <span className="tag tag--neutral">{accounts.length} счетов</span>
              </div>
              <span className="balance-card__amount">
                {formatAmount(totalHistoricalInBase, user.base_currency_code)}
              </span>
              <span className="balance-card__sub">Историческая стоимость investment-счетов</span>
            </article>
            <article className="balance-card">
              <div className="balance-card__head">
                <span className="pill">OPEN</span>
                <span className="tag tag--neutral">{openPositions.length} позиций</span>
              </div>
              <span className="balance-card__amount">{openPositions.length}</span>
              <span className="balance-card__sub">Открытых ручных позиций в портфеле</span>
            </article>
            <article className="balance-card">
              <div className="balance-card__head">
                <span className="pill">PRINCIPAL</span>
                <span className="tag tag--neutral">BASE</span>
              </div>
              <span className="balance-card__amount">
                {formatAmount(totalInvestedPrincipalInBase, user.base_currency_code)}
              </span>
              <span className="balance-card__sub">Вложенный principal по открытым позициям</span>
            </article>
            <article className="balance-card">
              <div className="balance-card__head">
                <span className="pill">INCOME</span>
                <span className="tag tag--neutral">BASE</span>
              </div>
              <span className="balance-card__amount">
                {formatAmount(totalRealizedIncomeInBase, user.base_currency_code)}
              </span>
              <span className="balance-card__sub">Зафиксированный доход по портфелю</span>
            </article>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="section__header">
          <h2 className="section__title">Типы активов</h2>
        </div>
        <div className="panel">
          <div className="portfolio-type-tabs" role="tablist" aria-label="Типы инвестиционных активов">
            {assetTabs.map((tab) => (
              <button
                key={tab.code}
                type="button"
                role="tab"
                aria-selected={activeAssetTypeCode === tab.code}
                className={[
                  'analytics-chip',
                  activeAssetTypeCode === tab.code ? 'analytics-chip--active' : '',
                ].filter(Boolean).join(' ')}
                onClick={() => {
                  setActiveAssetTypeCode(tab.code);
                  if (ASSET_TYPE_OPTIONS.some((option) => option.value === tab.code)) {
                    setNewAssetTypeCode(tab.code as (typeof ASSET_TYPE_OPTIONS)[number]['value']);
                  }
                }}
              >
                {tab.label} · {tab.openCount}
              </button>
            ))}
          </div>

          {activeAssetTab && (
            <div className="portfolio-type-tabs__summary">
              <span className="tag tag--neutral">
                Открыто: {activeAssetTab.openCount}
              </span>
              <span className="tag tag--neutral">
                Закрыто: {activeAssetTab.closedCount}
              </span>
              <span className="tag tag--neutral">
                Principal: {formatAmount(activeAssetTab.principalInBase, user.base_currency_code)}
              </span>
            </div>
          )}
        </div>
      </section>

      <section className="section">
        <div className="section__header">
          <h2 className="section__title">Новая позиция</h2>
        </div>
        <div className="panel">
          {accounts.length === 0 ? (
            <p className="list-row__sub">
              Сначала создай инвестиционный счет в настройках и переведи на него деньги с главного экрана.
            </p>
          ) : (
            <form onSubmit={(event) => void handleCreatePosition(event)}>
              <div className="form-row">
                <select
                  className="input"
                  value={newInvestmentAccountId}
                  onChange={(event) => setNewInvestmentAccountId(event.target.value)}
                  disabled={submittingCreate}
                >
                  {accounts.map(({ account }) => (
                    <option key={account.id} value={account.id}>
                      {account.name} · {account.owner_type === 'family' ? 'семейный' : 'личный'}
                    </option>
                  ))}
                </select>

                <select
                  className="input"
                  value={newAssetTypeCode}
                  onChange={(event) => setNewAssetTypeCode(event.target.value as (typeof ASSET_TYPE_OPTIONS)[number]['value'])}
                  disabled={submittingCreate}
                >
                  {ASSET_TYPE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-row">
                <input
                  className="input"
                  type="text"
                  placeholder="Название позиции"
                  value={newTitle}
                  onChange={(event) => setNewTitle(event.target.value)}
                  disabled={submittingCreate}
                  style={{ flex: '1 1 280px' }}
                />
                <input
                  className="input"
                  type="text"
                  inputMode="decimal"
                  placeholder="Количество, если есть"
                  value={newQuantity}
                  onChange={(event) => setNewQuantity(event.target.value)}
                  disabled={submittingCreate}
                  style={{ width: 180 }}
                />
              </div>

              <div className="form-row">
                <input
                  className="input"
                  type="text"
                  inputMode="decimal"
                  placeholder="Сумма входа"
                  value={newAmount}
                  onChange={(event) => setNewAmount(event.target.value)}
                  disabled={submittingCreate}
                  style={{ width: 180 }}
                />
                <select
                  className="input"
                  value={newCurrencyCode}
                  onChange={(event) => setNewCurrencyCode(event.target.value)}
                  disabled={submittingCreate}
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
                  value={newOpenedAt}
                  onChange={(event) => setNewOpenedAt(event.target.value)}
                  disabled={submittingCreate}
                />
                <span className="list-row__sub">
                  Доступно: {formatAmount(selectedCurrencyBalance, newCurrencyCode)}
                </span>
              </div>

              <div className="form-row">
                <input
                  className="input"
                  type="text"
                  placeholder="Комментарий"
                  value={newComment}
                  onChange={(event) => setNewComment(event.target.value)}
                  disabled={submittingCreate}
                  style={{ flex: '1 1 320px' }}
                />
                <button className="btn btn--primary" type="submit" disabled={submittingCreate}>
                  {submittingCreate ? 'Сохраняем...' : 'Добавить позицию'}
                </button>
              </div>

              {createError && (
                <p style={{ color: 'var(--tag-out-fg)', fontSize: '0.85rem' }}>
                  {createError}
                </p>
              )}
            </form>
          )}
        </div>
      </section>

      <section className="section">
        <div className="section__header">
          <h2 className="section__title">
            {activeAssetTab ? `${activeAssetTab.label} · Открытые позиции` : 'Открытые позиции'}
          </h2>
        </div>
        <div className="panel">
          {filteredOpenPositions.length === 0 ? (
            <p className="list-row__sub">
              {activeAssetTab ? `Открытых позиций типа «${activeAssetTab.label}» пока нет.` : 'Открытых позиций пока нет.'}
            </p>
          ) : (
            <div className="dashboard-budget-sections">
              {filteredOpenPositions.map((position) => {
                const closeDraft = closeDrafts[position.id];
                const incomeDraft = incomeDrafts[position.id];
                const topUpDraft = topUpDrafts[position.id];
                const partialCloseDraft = partialCloseDrafts[position.id];
                const feeDraft = feeDrafts[position.id];
                const events = eventsByPosition[position.id] ?? [];
                const feeBalance = feeDraft ? getAccountBalanceForCurrency(position.investment_account_id, feeDraft.currencyCode) : 0;
                const cancelledIncomeIds = new Set(
                  events
                    .filter((item) => item.event_type === 'adjustment' && item.metadata?.action === 'cancel_income')
                    .map((item) => Number(item.metadata?.cancelled_event_id))
                    .filter((value) => Number.isFinite(value)),
                );

                return (
                  <div className="dashboard-budget-section" key={position.id}>
                    <div className="dashboard-budget-section__header">
                      <div>
                        <div className="section__eyebrow">
                          {assetTypeLabel(position.asset_type_code)} · {position.investment_account_name}
                        </div>
                        <div className="section__title" style={{ fontSize: '1rem' }}>{position.title}</div>
                      </div>
                      <span className="tag tag--neutral">{position.investment_account_owner_name}</span>
                    </div>

                    <div className="bank-detail-list">
                      <div className="bank-detail-row">
                        <div className="bank-detail-row__main">
                          <span className="pill">{position.currency_code}</span>
                          <strong className="bank-detail-row__amount">
                            {formatAmount(position.amount_in_currency, position.currency_code)}
                          </strong>
                        </div>
                        <div className="bank-detail-row__sub">
                          Дата входа: {formatDateLabel(position.opened_at)}
                          {position.quantity ? ` · Количество: ${position.quantity}` : ''}
                          {typeof position.metadata?.amount_in_base === 'number'
                            ? ` · Себестоимость: ${formatAmount(Number(position.metadata.amount_in_base), user.base_currency_code)}`
                            : ''}
                          {typeof position.metadata?.fees_in_base === 'number' && Number(position.metadata.fees_in_base) > 0
                            ? ` · Комиссии: ${formatAmount(Number(position.metadata.fees_in_base), user.base_currency_code)}`
                            : ''}
                        </div>
                      </div>
                    </div>

                    {position.comment && (
                      <p className="list-row__sub" style={{ marginTop: 12 }}>
                        {position.comment}
                      </p>
                    )}

                    <div className="form-row">
                      <button
                        className="btn btn--primary"
                        type="button"
                        onClick={() => handleOpenCloseForm(position)}
                      >
                        Закрыть позицию
                      </button>
                      {canRecordPositionIncome(position) && (
                        <button
                          className="btn"
                          type="button"
                          onClick={() => handleOpenIncomeForm(position)}
                        >
                          Начислить доход
                        </button>
                      )}
                      <button
                        className="btn"
                        type="button"
                        onClick={() => handleOpenPartialCloseForm(position)}
                      >
                        Частично закрыть
                      </button>
                      <button
                        className="btn"
                        type="button"
                        onClick={() => handleOpenTopUpForm(position)}
                      >
                        Пополнить позицию
                      </button>
                      <button
                        className="btn"
                        type="button"
                        onClick={() => handleOpenFeeForm(position)}
                      >
                        Списать комиссию
                      </button>
                      <button
                        className="btn"
                        type="button"
                        disabled={deletingPositionId === position.id}
                        onClick={() => void handleDeletePosition(position)}
                      >
                        {deletingPositionId === position.id ? 'Удаляем...' : 'Удалить позицию'}
                      </button>
                      <button
                        className="btn"
                        type="button"
                        onClick={() => void handleToggleEvents(position.id)}
                      >
                        {selectedPositionId === position.id ? 'Скрыть события' : 'Показать события'}
                      </button>
                    </div>

                    {closeDraft && (
                      <form onSubmit={(event) => void handleClosePosition(position.id, event)}>
                        <div className="form-row">
                          <input
                            className="input"
                            type="text"
                            inputMode="decimal"
                            placeholder="Сумма выхода"
                            value={closeDraft.amount}
                            onChange={(event) => handleCloseDraftChange(position.id, { amount: event.target.value })}
                            disabled={submittingCloseId === position.id}
                            style={{ width: 180 }}
                          />
                          <select
                            className="input"
                            value={closeDraft.currencyCode}
                            onChange={(event) => handleCloseDraftChange(position.id, { currencyCode: event.target.value })}
                            disabled={submittingCloseId === position.id}
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
                            value={closeDraft.closedAt}
                            onChange={(event) => handleCloseDraftChange(position.id, { closedAt: event.target.value })}
                            disabled={submittingCloseId === position.id}
                          />
                        </div>
                        {closeDraft.currencyCode !== user.base_currency_code && (
                          <div className="form-row">
                            <input
                              className="input"
                              type="text"
                              inputMode="decimal"
                              placeholder={`Историческая стоимость в ${user.base_currency_code}`}
                              value={closeDraft.baseAmount}
                              onChange={(event) => handleCloseDraftChange(position.id, { baseAmount: event.target.value })}
                              disabled={submittingCloseId === position.id}
                              style={{ width: 260 }}
                            />
                            <span className="list-row__sub">
                              Нужна, чтобы вернуть валюту на счет с корректной себестоимостью.
                            </span>
                          </div>
                        )}
                        <div className="form-row">
                          <input
                            className="input"
                            type="text"
                            placeholder="Комментарий к закрытию"
                            value={closeDraft.comment}
                            onChange={(event) => handleCloseDraftChange(position.id, { comment: event.target.value })}
                            disabled={submittingCloseId === position.id}
                            style={{ flex: '1 1 280px' }}
                          />
                          <button
                            className="btn btn--primary"
                            type="submit"
                            disabled={submittingCloseId === position.id}
                          >
                            {submittingCloseId === position.id ? 'Закрываем...' : 'Подтвердить закрытие'}
                          </button>
                        </div>
                      </form>
                    )}

                    {partialCloseDraft && (
                      <form onSubmit={(event) => void handlePartialClosePosition(position, event)}>
                        <div className="form-row">
                          <input
                            className="input"
                            type="text"
                            inputMode="decimal"
                            placeholder="Сумма возврата"
                            value={partialCloseDraft.returnAmount}
                            onChange={(event) => handlePartialCloseDraftChange(position.id, { returnAmount: event.target.value })}
                            disabled={submittingPartialCloseId === position.id}
                            style={{ width: 180 }}
                          />
                          <select
                            className="input"
                            value={partialCloseDraft.returnCurrencyCode}
                            onChange={(event) => handlePartialCloseDraftChange(position.id, { returnCurrencyCode: event.target.value })}
                            disabled={submittingPartialCloseId === position.id}
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
                            value={partialCloseDraft.principalReduction}
                            onChange={(event) => handlePartialCloseDraftChange(position.id, { principalReduction: event.target.value })}
                            disabled={submittingPartialCloseId === position.id}
                            style={{ width: 180 }}
                          />
                          {position.quantity !== null && position.quantity !== undefined && (
                            <input
                              className="input"
                              type="text"
                              inputMode="decimal"
                              placeholder="Списать количество"
                              value={partialCloseDraft.closedQuantity}
                              onChange={(event) => handlePartialCloseDraftChange(position.id, { closedQuantity: event.target.value })}
                              disabled={submittingPartialCloseId === position.id}
                              style={{ width: 180 }}
                            />
                          )}
                          <input
                            className="input"
                            type="date"
                            value={partialCloseDraft.closedAt}
                            onChange={(event) => handlePartialCloseDraftChange(position.id, { closedAt: event.target.value })}
                            disabled={submittingPartialCloseId === position.id}
                          />
                        </div>
                        {partialCloseDraft.returnCurrencyCode !== user.base_currency_code && (
                          <div className="form-row">
                            <input
                              className="input"
                              type="text"
                              inputMode="decimal"
                              placeholder={`Историческая стоимость возврата в ${user.base_currency_code}`}
                              value={partialCloseDraft.returnBaseAmount}
                              onChange={(event) => handlePartialCloseDraftChange(position.id, { returnBaseAmount: event.target.value })}
                              disabled={submittingPartialCloseId === position.id}
                              style={{ width: 320 }}
                            />
                            <span className="list-row__sub">
                              Нужна для корректной себестоимости валюты, возвращенной на investment-счет.
                            </span>
                          </div>
                        )}
                        <div className="form-row">
                          <input
                            className="input"
                            type="text"
                            placeholder="Комментарий к частичному закрытию"
                            value={partialCloseDraft.comment}
                            onChange={(event) => handlePartialCloseDraftChange(position.id, { comment: event.target.value })}
                            disabled={submittingPartialCloseId === position.id}
                            style={{ flex: '1 1 280px' }}
                          />
                          <button
                            className="btn btn--primary"
                            type="submit"
                            disabled={submittingPartialCloseId === position.id}
                          >
                            {submittingPartialCloseId === position.id ? 'Проводим...' : 'Подтвердить частичное закрытие'}
                          </button>
                        </div>
                      </form>
                    )}

                    {incomeDraft && (
                      <form onSubmit={(event) => void handleRecordIncome(position, event)}>
                        <div className="form-row">
                          <input
                            className="input"
                            type="text"
                            inputMode="decimal"
                            placeholder={position.asset_type_code === 'deposit' ? 'Сумма процентов' : 'Сумма дивидендов'}
                            value={incomeDraft.amount}
                            onChange={(event) => handleIncomeDraftChange(position.id, { amount: event.target.value })}
                            disabled={submittingIncomeId === position.id}
                            style={{ width: 180 }}
                          />
                          <select
                            className="input"
                            value={incomeDraft.currencyCode}
                            onChange={(event) => handleIncomeDraftChange(position.id, { currencyCode: event.target.value })}
                            disabled={submittingIncomeId === position.id}
                          >
                            {currencies.map((currency) => (
                              <option key={currency.code} value={currency.code}>
                                {currency.code}
                              </option>
                            ))}
                          </select>
                          <select
                            className="input"
                            value={incomeDraft.incomeKind}
                            onChange={(event) => handleIncomeDraftChange(position.id, { incomeKind: event.target.value })}
                            disabled={submittingIncomeId === position.id}
                          >
                            {position.asset_type_code === 'deposit' ? (
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
                            value={incomeDraft.receivedAt}
                            onChange={(event) => handleIncomeDraftChange(position.id, { receivedAt: event.target.value })}
                            disabled={submittingIncomeId === position.id}
                          />
                        </div>
                        {incomeDraft.currencyCode !== user.base_currency_code && (
                          <div className="form-row">
                            <input
                              className="input"
                              type="text"
                              inputMode="decimal"
                              placeholder={`Историческая стоимость в ${user.base_currency_code}`}
                              value={incomeDraft.baseAmount}
                              onChange={(event) => handleIncomeDraftChange(position.id, { baseAmount: event.target.value })}
                              disabled={submittingIncomeId === position.id}
                              style={{ width: 260 }}
                            />
                            <span className="list-row__sub">
                              Нужна для сохранения себестоимости дохода в базовой валюте.
                            </span>
                          </div>
                        )}
                        <div className="form-row">
                          <input
                            className="input"
                            type="text"
                            placeholder="Комментарий к доходу"
                            value={incomeDraft.comment}
                            onChange={(event) => handleIncomeDraftChange(position.id, { comment: event.target.value })}
                            disabled={submittingIncomeId === position.id}
                            style={{ flex: '1 1 280px' }}
                          />
                          <button
                            className="btn btn--primary"
                            type="submit"
                            disabled={submittingIncomeId === position.id}
                          >
                            {submittingIncomeId === position.id ? 'Начисляем...' : 'Подтвердить доход'}
                          </button>
                        </div>
                      </form>
                    )}

                    {topUpDraft && (
                      <form onSubmit={(event) => void handleTopUpPosition(position, event)}>
                        <div className="form-row">
                          <input
                            className="input"
                            type="text"
                            inputMode="decimal"
                            placeholder="Сумма пополнения"
                            value={topUpDraft.amount}
                            onChange={(event) => handleTopUpDraftChange(position.id, { amount: event.target.value })}
                            disabled={submittingTopUpId === position.id}
                            style={{ width: 180 }}
                          />
                          <input
                            className="input"
                            type="text"
                            inputMode="decimal"
                            placeholder="Количество, если есть"
                            value={topUpDraft.quantity}
                            onChange={(event) => handleTopUpDraftChange(position.id, { quantity: event.target.value })}
                            disabled={submittingTopUpId === position.id}
                            style={{ width: 180 }}
                          />
                          <select
                            className="input"
                            value={topUpDraft.currencyCode}
                            onChange={(event) => handleTopUpDraftChange(position.id, { currencyCode: event.target.value })}
                            disabled={submittingTopUpId === position.id}
                          >
                            <option value={position.currency_code}>{position.currency_code}</option>
                          </select>
                          <input
                            className="input"
                            type="date"
                            value={topUpDraft.toppedUpAt}
                            onChange={(event) => handleTopUpDraftChange(position.id, { toppedUpAt: event.target.value })}
                            disabled={submittingTopUpId === position.id}
                          />
                        </div>
                        <div className="form-row">
                          <input
                            className="input"
                            type="text"
                            placeholder="Комментарий к пополнению"
                            value={topUpDraft.comment}
                            onChange={(event) => handleTopUpDraftChange(position.id, { comment: event.target.value })}
                            disabled={submittingTopUpId === position.id}
                            style={{ flex: '1 1 280px' }}
                          />
                          <button
                            className="btn btn--primary"
                            type="submit"
                            disabled={submittingTopUpId === position.id}
                          >
                            {submittingTopUpId === position.id ? 'Пополняем...' : 'Подтвердить пополнение'}
                          </button>
                        </div>
                      </form>
                    )}

                    {feeDraft && (
                      <form onSubmit={(event) => void handleRecordFee(position, event)}>
                        <div className="form-row">
                          <input
                            className="input"
                            type="text"
                            inputMode="decimal"
                            placeholder="Сумма комиссии"
                            value={feeDraft.amount}
                            onChange={(event) => handleFeeDraftChange(position.id, { amount: event.target.value })}
                            disabled={submittingFeeId === position.id}
                            style={{ width: 180 }}
                          />
                          <select
                            className="input"
                            value={feeDraft.currencyCode}
                            onChange={(event) => handleFeeDraftChange(position.id, { currencyCode: event.target.value })}
                            disabled={submittingFeeId === position.id}
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
                            value={feeDraft.chargedAt}
                            onChange={(event) => handleFeeDraftChange(position.id, { chargedAt: event.target.value })}
                            disabled={submittingFeeId === position.id}
                          />
                          <span className="list-row__sub">
                            Доступно: {formatAmount(feeBalance, feeDraft.currencyCode)}
                          </span>
                        </div>
                        <div className="form-row">
                          <input
                            className="input"
                            type="text"
                            placeholder="Комментарий к комиссии"
                            value={feeDraft.comment}
                            onChange={(event) => handleFeeDraftChange(position.id, { comment: event.target.value })}
                            disabled={submittingFeeId === position.id}
                            style={{ flex: '1 1 280px' }}
                          />
                          <button
                            className="btn btn--primary"
                            type="submit"
                            disabled={submittingFeeId === position.id}
                          >
                            {submittingFeeId === position.id ? 'Списываем...' : 'Подтвердить комиссию'}
                          </button>
                        </div>
                      </form>
                    )}

                    {selectedPositionId === position.id && (
                      <div style={{ marginTop: 12 }}>
                        {eventsError && (
                          <p style={{ color: 'var(--tag-out-fg)', fontSize: '0.85rem' }}>
                            {eventsError}
                          </p>
                        )}
                        {eventsLoadingId === position.id ? (
                          <p className="list-row__sub">Загружаем события...</p>
                        ) : (
                          <ul className="bank-detail-list">
                            {events.map((item) => (
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
                                    ? ` · Principal: ${formatAmount(Number(item.metadata.principal_amount_in_currency), position.currency_code)}`
                                    : ''}
                                  {item.linked_operation_id ? ` · Операция #${item.linked_operation_id}` : ''}
                                  {item.comment ? ` · ${item.comment}` : ''}
                                </div>
                                {item.event_type === 'income' && (
                                  <div className="form-row" style={{ paddingTop: 8 }}>
                                    {cancelledIncomeIds.has(item.id) ? (
                                      <span className="tag tag--neutral">Уже отменен</span>
                                    ) : (
                                      <button
                                        className="btn"
                                        type="button"
                                        disabled={cancellingIncomeEventId === item.id}
                                        onClick={() => void handleCancelIncome(position.id, item.id)}
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
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {closeError && (
            <p style={{ color: 'var(--tag-out-fg)', fontSize: '0.85rem', marginTop: 12 }}>
              {closeError}
            </p>
          )}

          {incomeError && (
            <p style={{ color: 'var(--tag-out-fg)', fontSize: '0.85rem', marginTop: 12 }}>
              {incomeError}
            </p>
          )}

          {topUpError && (
            <p style={{ color: 'var(--tag-out-fg)', fontSize: '0.85rem', marginTop: 12 }}>
              {topUpError}
            </p>
          )}

          {partialCloseError && (
            <p style={{ color: 'var(--tag-out-fg)', fontSize: '0.85rem', marginTop: 12 }}>
              {partialCloseError}
            </p>
          )}

          {feeError && (
            <p style={{ color: 'var(--tag-out-fg)', fontSize: '0.85rem', marginTop: 12 }}>
              {feeError}
            </p>
          )}

          {deleteError && (
            <p style={{ color: 'var(--tag-out-fg)', fontSize: '0.85rem', marginTop: 12 }}>
              {deleteError}
            </p>
          )}

          {cancelIncomeError && (
            <p style={{ color: 'var(--tag-out-fg)', fontSize: '0.85rem', marginTop: 12 }}>
              {cancelIncomeError}
            </p>
          )}
        </div>
      </section>

      <section className="section">
        <div className="section__header">
          <h2 className="section__title">
            {activeAssetTab ? `${activeAssetTab.label} · Закрытые позиции` : 'Закрытые позиции'}
          </h2>
        </div>
        <div className="panel">
          {filteredClosedPositions.length === 0 ? (
            <p className="list-row__sub">
              {activeAssetTab ? `Закрытых позиций типа «${activeAssetTab.label}» пока нет.` : 'Закрытых позиций пока нет.'}
            </p>
          ) : (
            <ul className="bank-detail-list">
              {filteredClosedPositions.map((position) => (
                <li className="bank-detail-row" key={position.id}>
                  <div className="bank-detail-row__main">
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <span className="pill">{position.currency_code}</span>
                        <strong className="bank-detail-row__amount">{position.title}</strong>
                        <span className="tag tag--neutral">{assetTypeLabel(position.asset_type_code)}</span>
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
      </section>

      <section className="section">
        <div className="section__header">
          <h2 className="section__title">Инвестиционные счета</h2>
        </div>
        <div className="panel">
          {accounts.length === 0 ? (
            <p className="list-row__sub">Инвестиционных счетов пока нет.</p>
          ) : (
            <div className="dashboard-budget-sections">
              {accounts.map(({ account, balances }) => (
                <div className="dashboard-budget-section" key={account.id}>
                  {(() => {
                    const summary = summaryItems.find((item) => item.investment_account_id === account.id);

                    return (
                      <>
                  <div className="dashboard-budget-section__header">
                    <div>
                      <div className="section__eyebrow">
                        {account.owner_type === 'family' ? 'Семейный investment' : 'Личный investment'}
                      </div>
                      <div className="section__title" style={{ fontSize: '1rem' }}>{account.name}</div>
                    </div>
                    <span className="tag tag--neutral">
                      {account.provider_name || `Счет #${account.id}`}
                    </span>
                  </div>

                  {summary && (
                    <div className="form-row" style={{ paddingTop: 0 }}>
                      <span className="tag tag--neutral">
                        Cash: {formatAmount(summary.cash_balance_in_base, user.base_currency_code)}
                      </span>
                      <span className="tag tag--neutral">
                        Principal: {formatAmount(summary.invested_principal_in_base, user.base_currency_code)}
                      </span>
                      <span className="tag tag--neutral">
                        Income: {formatAmount(summary.realized_income_in_base, user.base_currency_code)}
                      </span>
                      <span className="tag tag--neutral">
                        Open: {summary.open_positions_count}
                      </span>
                    </div>
                  )}

                  {balances.length === 0 ? (
                    <p className="list-row__sub">На этом счете пока нет валютных остатков.</p>
                  ) : (
                    <ul className="bank-detail-list">
                      {balances.map((balance) => (
                        <li className="bank-detail-row" key={`${account.id}-${balance.currency_code}`}>
                          <div className="bank-detail-row__main">
                            <span className="pill">{balance.currency_code}</span>
                            <strong className="bank-detail-row__amount">
                              {formatAmount(balance.amount, balance.currency_code)}
                            </strong>
                          </div>
                          <div className="bank-detail-row__sub">
                            Себестоимость: {formatAmount(balance.historical_cost_in_base, balance.base_currency_code)}
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                      </>
                    );
                  })()}
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      <section className="section">
        <div className="section__header">
          <h2 className="section__title">Следующий шаг</h2>
        </div>
        <div className="panel">
          <p className="list-row__sub">
            Базовый инвестиционный контур уже собран: переводы, ручные позиции, пополнение, частичное и полное закрытие, доходы, комиссии и безопасные корректировки.
            Дальше логично добавить справочник типов активов, ручную valuation и более детальную доходность по позициям.
          </p>
        </div>
      </section>
    </>
  );
}
