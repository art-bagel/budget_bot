import { useEffect, useMemo, useRef, useState } from 'react';
import type { TouchEvent as ReactTouchEvent } from 'react';

import {
  fetchOperationsAnalytics,
  fetchOperationsHistory,
  reverseOperation,
} from '../api';
import { hapticLight } from '../telegram';
import { categoryDisplayName } from '../utils/categoryIcon';
import { useHints } from '../hooks/useHints';
import type {
  OperationAnalyticsItem,
  OperationAnalyticsResponse,
  OperationHistoryItem,
  UserContext,
} from '../types';
import { formatAmount } from '../utils/format';


const HISTORY_PAGE_SIZE = 20;
const ANALYTICS_PERIOD_WINDOW = 6;
const ANALYTICS_COLOR_PALETTE = [
  '#00d2ff',
  '#00e090',
  '#ff5580',
  '#ffaa00',
  '#a855ff',
  '#7b8a99',
];
const HISTORY_TYPE_OPTIONS = [
  { value: 'income', label: 'Доход' },
  { value: 'expense', label: 'Расход' },
  { value: 'allocate', label: 'Распределение по категории' },
  { value: 'group_allocate', label: 'Распределение по группе' },
  { value: 'exchange', label: 'Обмен валют' },
  { value: 'account_transfer', label: 'Перевод между счетами' },
  { value: 'investment_trade', label: 'Сделка по инвестиции' },
  { value: 'investment_income', label: 'Доход по инвестициям' },
  { value: 'investment_adjustment', label: 'Корректировка инвестиции' },
  { value: 'cancelled', label: 'Отменённые' },
];
const ANALYTICS_TYPE_OPTIONS: { value: 'expense' | 'income'; label: string }[] = [
  { value: 'expense', label: 'Расходы' },
  { value: 'income', label: 'Доходы' },
];
const ANALYTICS_SCOPE_OPTIONS: { value: 'all' | 'user' | 'family'; label: string }[] = [
  { value: 'all', label: 'Все' },
  { value: 'user', label: 'Личные' },
  { value: 'family', label: 'Семейные' },
];
const ANALYTICS_PERIOD_MODE_OPTIONS: { value: 'week' | 'month' | 'year'; label: string }[] = [
  { value: 'week', label: 'Нед' },
  { value: 'month', label: 'Мес' },
  { value: 'year', label: 'Год' },
];
const INVESTMENT_HISTORY_FILTER_OPTIONS = [
  { value: 'all', label: 'Все' },
  { value: 'trade', label: 'Сделки' },
  { value: 'income', label: 'Доход' },
  { value: 'transfer', label: 'Переводы' },
] as const;
const BANKING_TYPE_FILTER_OPTIONS = [
  { value: 'income', label: 'Доход' },
  { value: 'expense', label: 'Расход' },
  { value: 'allocate', label: 'Распределение' },
  { value: 'exchange', label: 'Обмен' },
  { value: 'account_transfer', label: 'Переводы' },
  { value: 'credit_repayment', label: 'Погашение кредита' },
  { value: 'cancelled', label: 'Отменённые' },
] as const;

type OperationLine = {
  label: string;
  amount?: string;
};

type OperationsViewMode = 'history' | 'investment' | 'analytics';
type InvestmentHistoryFilter = (typeof INVESTMENT_HISTORY_FILTER_OPTIONS)[number]['value'];

type AnalyticsSegment = {
  entryKey: string;
  label: string;
  ownerType: 'user' | 'family' | 'mixed';
  amount: number;
  share: number;
  operationsCount: number;
  color: string;
};

type AnalyticsPeriodMode = 'week' | 'month' | 'year';
type OperationsHistoryScope = 'all' | 'banking';
type OperationsProps = {
  user: UserContext;
  embedded?: boolean;
  initialViewMode?: OperationsViewMode;
  allowedModes?: OperationsViewMode[];
  historyScope?: OperationsHistoryScope;
};


function toIsoDate(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}


function fromIsoDate(value?: string | null): Date {
  if (!value || typeof value !== 'string') {
    return new Date();
  }

  const normalizedValue = value.slice(0, 10);
  const parts = normalizedValue.split('-').map(Number);

  if (parts.length !== 3 || parts.some((part) => Number.isNaN(part))) {
    return new Date();
  }

  const [year, month, day] = parts;
  return new Date(year, month - 1, day);
}


function addDays(value: Date, amount: number): Date {
  const date = new Date(value);
  date.setDate(date.getDate() + amount);
  return date;
}


function addMonths(value: Date, amount: number): Date {
  const date = new Date(value);
  date.setMonth(date.getMonth() + amount);
  return date;
}


function addYears(value: Date, amount: number): Date {
  const date = new Date(value);
  date.setFullYear(date.getFullYear() + amount);
  return date;
}


function normalizeAnchorDate(anchorDate: string, periodMode: AnalyticsPeriodMode): string {
  const date = fromIsoDate(anchorDate);

  if (periodMode === 'week') {
    const dayOffset = (date.getDay() + 6) % 7;
    date.setDate(date.getDate() - dayOffset);
  } else if (periodMode === 'month') {
    date.setDate(1);
  } else {
    date.setMonth(0, 1);
  }

  return toIsoDate(date);
}


function getCurrentAnchorDate(periodMode: AnalyticsPeriodMode): string {
  return normalizeAnchorDate(toIsoDate(new Date()), periodMode);
}


function shiftAnchorDate(anchorDate: string, periodMode: AnalyticsPeriodMode, direction: -1 | 1): string {
  const date = fromIsoDate(anchorDate);

  if (periodMode === 'week') {
    return toIsoDate(addDays(date, direction * 7));
  }
  if (periodMode === 'month') {
    return normalizeAnchorDate(toIsoDate(addMonths(date, direction)), 'month');
  }
  return normalizeAnchorDate(toIsoDate(addYears(date, direction)), 'year');
}


function formatPeriodRange(periodStart: string, periodMode: AnalyticsPeriodMode): string {
  const startDate = fromIsoDate(periodStart);

  if (periodMode === 'year') {
    return String(startDate.getFullYear());
  }

  if (periodMode === 'month') {
    return new Intl.DateTimeFormat('ru-RU', {
      month: 'long',
      year: 'numeric',
    }).format(startDate);
  }

  const endDate = addDays(startDate, 6);
  const sameMonth = startDate.getMonth() === endDate.getMonth() && startDate.getFullYear() === endDate.getFullYear();
  const sameYear = startDate.getFullYear() === endDate.getFullYear();

  if (sameMonth) {
    return `${startDate.getDate()}-${endDate.getDate()} ${
      new Intl.DateTimeFormat('ru-RU', { month: 'long', year: 'numeric' }).format(startDate)
    }`;
  }

  if (sameYear) {
    return `${startDate.getDate()} ${
      new Intl.DateTimeFormat('ru-RU', { month: 'short' }).format(startDate).replace('.', '')
    } - ${endDate.getDate()} ${
      new Intl.DateTimeFormat('ru-RU', { month: 'short', year: 'numeric' }).format(endDate).replace('.', '')
    }`;
  }

  return `${startDate.getDate()} ${
    new Intl.DateTimeFormat('ru-RU', { month: 'short', year: '2-digit' }).format(startDate).replace('.', '')
  } - ${endDate.getDate()} ${
    new Intl.DateTimeFormat('ru-RU', { month: 'short', year: '2-digit' }).format(endDate).replace('.', '')
  }`;
}


function getPeriodHint(periodMode: AnalyticsPeriodMode): string {
  if (periodMode === 'week') return 'Нажми на неделю или свайпни влево/вправо для смены периода.';
  if (periodMode === 'year') return 'Нажми на год или свайпни влево/вправо для смены периода.';
  return 'Нажми на месяц или свайпни влево/вправо для смены периода.';
}


function getPeriodSelectOptions(periodMode: AnalyticsPeriodMode, anchorDate: string): { value: string; label: string }[] {
  const baseDate = fromIsoDate(anchorDate);
  const options: { value: string; label: string }[] = [];

  if (periodMode === 'year') {
    for (let offset = -8; offset <= 2; offset += 1) {
      const value = normalizeAnchorDate(toIsoDate(addYears(baseDate, offset)), 'year');
      options.push({
        value,
        label: String(fromIsoDate(value).getFullYear()),
      });
    }
    return options.sort((left, right) => right.value.localeCompare(left.value));
  }

  if (periodMode === 'month') {
    for (let offset = -10; offset <= 1; offset += 1) {
      const value = normalizeAnchorDate(toIsoDate(addMonths(baseDate, offset)), 'month');
      options.push({
        value,
        label: new Intl.DateTimeFormat('ru-RU', { month: 'long', year: 'numeric' }).format(fromIsoDate(value)),
      });
    }
    return options.sort((left, right) => right.value.localeCompare(left.value));
  }

  for (let offset = -10; offset <= 1; offset += 1) {
    const value = normalizeAnchorDate(toIsoDate(addDays(baseDate, offset * 7)), 'week');
    options.push({
      value,
      label: formatPeriodRange(value, 'week'),
    });
  }

  return options.sort((left, right) => right.value.localeCompare(left.value));
}


function formatPercent(share: number): string {
  return new Intl.NumberFormat('ru-RU', {
    style: 'percent',
    maximumFractionDigits: share < 0.1 ? 1 : 0,
  }).format(share);
}


function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat('ru-RU', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(value));
}


function formatSignedAmount(amount: number, currencyCode: string): string {
  const absAmount = Math.abs(amount);
  const prefix = amount > 0 ? '+' : amount < 0 ? '-' : '';
  return prefix + new Intl.NumberFormat('ru-RU', {
    maximumFractionDigits: 2,
  }).format(absAmount) + ' ' + currencyCode;
}


function getOperationTitle(item: OperationHistoryItem): string {
  if (item.comment?.includes('Платёж по кредиту')) return 'Платёж по кредиту';
  if (item.comment?.includes('Частичное закрытие позиции')) return 'Частичное закрытие позиции';
  if (item.comment?.includes('Пополнение позиции')) return 'Пополнение позиции';
  if (item.comment?.includes('Комиссия по позиции')) return 'Комиссия по позиции';
  if (item.type === 'income') {
    return item.income_source_name ? 'Доход · ' + item.income_source_name : 'Доход';
  }
  if (item.type === 'investment_trade') {
    const investmentEntry = item.bank_entries.find((entry) => entry.bank_account_kind === 'investment');
    if (investmentEntry?.amount && investmentEntry.amount < 0) return 'Покупка позиции';
    if (investmentEntry?.amount && investmentEntry.amount > 0) return 'Закрытие позиции';
    return 'Сделка по инвестиции';
  }
  if (item.type === 'investment_income') return 'Доход по инвестициям';
  if (item.type === 'investment_adjustment') {
    const investmentEntry = item.bank_entries.find((entry) => entry.bank_account_kind === 'investment');
    if (investmentEntry?.amount && investmentEntry.amount > 0) return 'Удаление позиции';
    if (investmentEntry?.amount && investmentEntry.amount < 0) return 'Отмена дохода';
    return 'Корректировка инвестиции';
  }
  if (item.type === 'expense') return 'Расход';
  if (item.type === 'allocate') return 'Распределение по категории';
  if (item.type === 'group_allocate') return 'Распределение по группе';
  if (item.type === 'exchange') return 'Обмен валют';
  if (item.type === 'account_transfer') {
    const investmentEntry = item.bank_entries.find((entry) => entry.bank_account_kind === 'investment');
    if (investmentEntry?.amount && investmentEntry.amount > 0) return 'Пополнение investment-счета';
    if (investmentEntry?.amount && investmentEntry.amount < 0) return 'Вывод на cash-счет';
    return 'Перевод между счетами';
  }
  return item.type;
}


function getBankEntryLabel(
  ownerType?: string | null,
  accountKind?: string | null,
  accountName?: string | null,
  bankAccountId?: number,
): string {
  const resolvedName = accountName || (bankAccountId ? `Счет #${bankAccountId}` : 'Счет');
  const scopePrefix = ownerType === 'family' ? 'Семейный' : ownerType === 'user' ? 'Личный' : null;
  const kindSuffix = accountKind === 'investment' ? 'investment' : null;
  const prefix = [scopePrefix, kindSuffix].filter(Boolean).join(' · ');

  if (prefix) return prefix + ' · ' + resolvedName;
  return resolvedName;
}


function getBudgetEntryLabel(name: string): string {
  if (name === 'Личный свободный остаток') return 'Личный остаток';
  if (name === 'Семейный свободный остаток') return 'Семейный остаток';
  return categoryDisplayName(name);
}


function getOperationLines(item: OperationHistoryItem): OperationLine[] {
  const lines: OperationLine[] = [];

  item.bank_entries.forEach((entry) => {
    lines.push({
      label: getBankEntryLabel(
        entry.bank_account_owner_type,
        entry.bank_account_kind,
        entry.bank_account_name,
        entry.bank_account_id,
      ),
      amount: formatSignedAmount(entry.amount, entry.currency_code),
    });
  });

  item.budget_entries.forEach((entry) => {
    lines.push({
      label: getBudgetEntryLabel(entry.category_name),
      amount: formatSignedAmount(entry.amount, entry.currency_code),
    });
  });

  if (item.reversal_of_operation_id) {
    lines.push({ label: 'Отмена операции #' + item.reversal_of_operation_id });
  }

  return lines;
}


function buildAnalyticsSegments(items: OperationAnalyticsItem[], totalAmount: number): AnalyticsSegment[] {
  if (totalAmount <= 0 || items.length === 0) {
    return [];
  }

  const sorted = [...items].sort((left, right) => right.amount - left.amount);
  const head = sorted.slice(0, 5);
  const tail = sorted.slice(5);
  const compactItems = tail.length === 0
    ? head
    : [
        ...head,
        {
          entry_key: 'other',
          label: 'Прочее',
          owner_type: 'user' as const,
          amount: tail.reduce((sum, item) => sum + item.amount, 0),
          operations_count: tail.reduce((sum, item) => sum + item.operations_count, 0),
        },
      ];

  return compactItems.map((item, index) => ({
    entryKey: item.entry_key,
    label: item.label,
    ownerType: item.entry_key === 'other' ? 'mixed' : item.owner_type,
    amount: item.amount,
    share: item.amount / totalAmount,
    operationsCount: item.operations_count,
    color: ANALYTICS_COLOR_PALETTE[index % ANALYTICS_COLOR_PALETTE.length],
  }));
}


function buildDonutGradient(segments: AnalyticsSegment[]): string {
  if (segments.length === 0) {
    return 'conic-gradient(var(--bg-inset) 0turn 1turn)';
  }

  let currentOffset = 0;
  const parts = segments.map((segment) => {
    const start = currentOffset;
    currentOffset += segment.share;
    return `${segment.color} ${start}turn ${currentOffset}turn`;
  });

  return `conic-gradient(${parts.join(', ')})`;
}

function getInvestmentHistoryKind(item: OperationHistoryItem): InvestmentHistoryFilter {
  if (item.type === 'investment_trade') return 'trade';
  if (item.type === 'investment_income') return 'income';
  if (item.type === 'investment_adjustment') {
    const investmentEntry = item.bank_entries.find((entry) => entry.bank_account_kind === 'investment');
    return investmentEntry?.amount && investmentEntry.amount > 0 ? 'trade' : 'income';
  }
  return 'transfer';
}


export default function Operations({
  user: _user,
  embedded = false,
  initialViewMode = 'history',
  allowedModes,
  historyScope = 'all',
}: OperationsProps) {
  const resolvedAllowedModes = useMemo<OperationsViewMode[]>(
    () => (allowedModes && allowedModes.length > 0 ? allowedModes : ['history', 'investment', 'analytics']),
    [allowedModes],
  );
  const safeInitialViewMode = useMemo<OperationsViewMode>(
    () => (resolvedAllowedModes.includes(initialViewMode) ? initialViewMode : resolvedAllowedModes[0] ?? 'history'),
    [initialViewMode, resolvedAllowedModes],
  );
  const [viewMode, setViewMode] = useState<OperationsViewMode>(safeInitialViewMode);

  const [historyItems, setHistoryItems] = useState<OperationHistoryItem[]>([]);
  const [historyTotalCount, setHistoryTotalCount] = useState(0);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historyTypeFilter, setHistoryTypeFilter] = useState<Set<string>>(
    () => new Set(HISTORY_TYPE_OPTIONS.filter((o) => o.value !== 'cancelled').map((o) => o.value)),
  );
  const [investmentHistoryFilter, setInvestmentHistoryFilter] = useState<InvestmentHistoryFilter>('all');
  const [bankingTypeFilter, setBankingTypeFilter] = useState<Set<string>>(
    () => new Set(BANKING_TYPE_FILTER_OPTIONS.filter((o) => o.value !== 'cancelled').map((o) => o.value)),
  );
  const [reversingOperationId, setReversingOperationId] = useState<number | null>(null);
  const [typeFilterOpen, setTypeFilterOpen] = useState(false);
  const typeFilterRef = useRef<HTMLDivElement>(null);

  const [analyticsData, setAnalyticsData] = useState<OperationAnalyticsResponse | null>(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [analyticsError, setAnalyticsError] = useState<string | null>(null);
  const [analyticsTypeFilter, setAnalyticsTypeFilter] = useState<'expense' | 'income'>('expense');
  const [analyticsOwnerScope, setAnalyticsOwnerScope] = useState<'all' | 'user' | 'family'>('all');
  const [analyticsPeriodMode, setAnalyticsPeriodMode] = useState<AnalyticsPeriodMode>('month');
  const [analyticsAnchorDate, setAnalyticsAnchorDate] = useState(getCurrentAnchorDate('month'));
  const analyticsSwipeRef = useRef<{ startX: number; startY: number } | null>(null);
  const periodSelectRef = useRef<HTMLSelectElement>(null);

  const { hintsEnabled } = useHints();
  const analyticsHasFamily = analyticsData?.has_family ?? true;
  const effectivePeriodMode = analyticsData?.period_mode ?? analyticsPeriodMode;
  const effectivePeriodStart = analyticsData?.period_start ?? analyticsAnchorDate;

  const chartSegments = useMemo(
    () => buildAnalyticsSegments(analyticsData?.items ?? [], analyticsData?.total_amount ?? 0),
    [analyticsData],
  );
  const donutGradient = useMemo(() => buildDonutGradient(chartSegments), [chartSegments]);
  const periodSelectOptions = useMemo(
    () => getPeriodSelectOptions(analyticsPeriodMode, analyticsAnchorDate),
    [analyticsPeriodMode, analyticsAnchorDate],
  );
  const historyTypeFilterKey = useMemo(() => Array.from(historyTypeFilter).sort().join(','), [historyTypeFilter]);
  const showHistoryTypeFilter = viewMode === 'history' && historyScope === 'all';
  const showInvestmentTypeFilter = viewMode === 'investment';
  const nonAnalyticsModes = resolvedAllowedModes.filter((mode) => mode !== 'analytics');
  const showModeSwitch = viewMode !== 'analytics' && nonAnalyticsModes.length > 1;

  const getEffectiveHistoryType = (
    nextViewMode: OperationsViewMode = viewMode,
    nextHistoryTypeFilter: Set<string> = historyTypeFilter,
  ): string | undefined => {
    if (nextViewMode === 'investment') {
      return 'investment';
    }

    if (nextViewMode === 'history' && historyScope === 'banking') {
      return 'banking';
    }

    if (nextViewMode === 'history') {
      const typeValues = Array.from(nextHistoryTypeFilter).filter((v) => v !== 'cancelled');
      const allTypeCount = HISTORY_TYPE_OPTIONS.filter((o) => o.value !== 'cancelled').length;
      if (typeValues.length === 0 && nextHistoryTypeFilter.has('cancelled')) {
        return 'cancelled';
      }
      if (typeValues.length > 0 && typeValues.length < allTypeCount) {
        return typeValues.join(',');
      }
    }

    return undefined;
  };

  const loadHistory = async (
    offset: number,
    replace = false,
    operationType = getEffectiveHistoryType(),
  ) => {
    setLoadingHistory(true);
    setHistoryError(null);

    try {
      const result = await fetchOperationsHistory(
        HISTORY_PAGE_SIZE,
        offset,
        operationType || undefined,
      );
      setHistoryItems((prev) => (replace ? result.items : [...prev, ...result.items]));
      setHistoryTotalCount(result.total_count);
    } catch (error: unknown) {
      setHistoryError(error instanceof Error ? error.message : String(error));
    } finally {
      setLoadingHistory(false);
    }
  };

  const loadAnalytics = async (
    anchorDate = analyticsAnchorDate,
    periodMode = analyticsPeriodMode,
    operationType = analyticsTypeFilter,
    ownerScope = analyticsOwnerScope,
  ) => {
    setAnalyticsLoading(true);
    setAnalyticsError(null);

    try {
      const result = await fetchOperationsAnalytics(
        anchorDate,
        periodMode,
        operationType,
        ownerScope,
        ANALYTICS_PERIOD_WINDOW,
      );
      setAnalyticsData(result);
    } catch (error: unknown) {
      setAnalyticsError(error instanceof Error ? error.message : String(error));
    } finally {
      setAnalyticsLoading(false);
    }
  };

  useEffect(() => {
    if (viewMode === 'analytics') {
      return;
    }
    if (showHistoryTypeFilter) {
      const typeValues = Array.from(historyTypeFilter).filter((v) => v !== 'cancelled');
      if (typeValues.length === 0 && !historyTypeFilter.has('cancelled')) {
        setHistoryItems([]);
        setHistoryTotalCount(0);
        return;
      }
    }
    void loadHistory(0, true);
  }, [viewMode, historyTypeFilterKey]);

  useEffect(() => {
    if (viewMode !== 'analytics') {
      return;
    }
    void loadAnalytics();
  }, [viewMode, analyticsAnchorDate, analyticsPeriodMode, analyticsTypeFilter, analyticsOwnerScope]);

  useEffect(() => {
    if (!analyticsHasFamily && analyticsOwnerScope === 'family') {
      setAnalyticsOwnerScope('all');
    }
  }, [analyticsHasFamily, analyticsOwnerScope]);

  useEffect(() => {
    setViewMode(safeInitialViewMode);
  }, [safeInitialViewMode]);

  useEffect(() => {
    if (!typeFilterOpen) return;
    const handleClick = (event: MouseEvent) => {
      if (typeFilterRef.current && !typeFilterRef.current.contains(event.target as Node)) {
        setTypeFilterOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [typeFilterOpen]);

  useEffect(() => {
    const el = periodSelectRef.current;
    if (!el) return;
    const text = el.options[el.selectedIndex]?.text ?? '';
    const span = document.createElement('span');
    span.style.cssText = 'position:fixed;visibility:hidden;pointer-events:none;font:600 0.8rem/1 system-ui;padding:0 12px;white-space:nowrap;';
    span.textContent = text;
    document.body.appendChild(span);
    el.style.width = `${span.offsetWidth + 2}px`;
    document.body.removeChild(span);
  }, [analyticsAnchorDate, analyticsPeriodMode]);

  const canLoadMoreHistory = !loadingHistory && historyItems.length < historyTotalCount;
  const visibleHistoryItems = useMemo(() => {
    let items = historyItems;

    if (embedded) {
      items = items.filter((item) => !item.reversal_of_operation_id);
    }

    if (historyScope === 'banking') {
      items = items.filter((item) => {
        const checkedTypes = Array.from(bankingTypeFilter).filter((value) => value !== 'cancelled');
        if (checkedTypes.length === 0) return item.has_reversal && bankingTypeFilter.has('cancelled');
        if (item.has_reversal && !bankingTypeFilter.has('cancelled')) return false;

        const isCreditRepayment = item.type === 'account_transfer' && item.comment?.includes('Платёж по кредиту');
        if (isCreditRepayment) return bankingTypeFilter.has('credit_repayment');
        if (item.type === 'account_transfer') return bankingTypeFilter.has('account_transfer');
        if (item.type === 'group_allocate') return bankingTypeFilter.has('allocate');

        return bankingTypeFilter.has(item.type);
      });
    }

    if (showHistoryTypeFilter && !historyTypeFilter.has('cancelled')) {
      items = items.filter((item) => !item.has_reversal);
    }

    if (viewMode === 'investment' && investmentHistoryFilter !== 'all') {
      items = items.filter((item) => getInvestmentHistoryKind(item) === investmentHistoryFilter);
    }

    return items;
  }, [historyItems, investmentHistoryFilter, viewMode, embedded, historyScope, bankingTypeFilter, historyTypeFilter, showHistoryTypeFilter]);

  const handleReverseOperation = async (operationId: number) => {
    setReversingOperationId(operationId);
    setHistoryError(null);

    try {
      await reverseOperation({ operation_id: operationId });
      await loadHistory(0, true);
      if (viewMode === 'analytics') {
        await loadAnalytics();
      }
    } catch (error: unknown) {
      setHistoryError(error instanceof Error ? error.message : String(error));
    } finally {
      setReversingOperationId(null);
    }
  };

  const shiftAnalyticsPeriod = (direction: -1 | 1) => {
    setAnalyticsAnchorDate((prev) => shiftAnchorDate(prev, analyticsPeriodMode, direction));
    hapticLight();
  };

  const handleAnalyticsTouchStart = (event: ReactTouchEvent<HTMLDivElement>) => {
    analyticsSwipeRef.current = {
      startX: event.touches[0].clientX,
      startY: event.touches[0].clientY,
    };
  };

  const handleAnalyticsTouchEnd = (event: ReactTouchEvent<HTMLDivElement>) => {
    const swipe = analyticsSwipeRef.current;
    analyticsSwipeRef.current = null;
    if (!swipe || analyticsLoading) return;

    const dx = event.changedTouches[0].clientX - swipe.startX;
    const dy = event.changedTouches[0].clientY - swipe.startY;

    if (Math.abs(dx) < 48) return;
    if (Math.abs(dy) > Math.abs(dx) * 0.6) return;

    shiftAnalyticsPeriod(dx < 0 ? 1 : -1);
  };

  const handleAnalyticsPeriodModeChange = (periodMode: AnalyticsPeriodMode) => {
    setAnalyticsPeriodMode(periodMode);
    setAnalyticsAnchorDate(getCurrentAnchorDate(periodMode));
  };

  return (
    <>
      {!embedded && <h1 className="page-title">Операции</h1>}

      <section className={['section', embedded ? 'section--embedded' : ''].filter(Boolean).join(' ')}>
        {!embedded && (
          <div className="section__header">
            <h2 className="section__title">История и аналитика</h2>
          </div>
        )}
        <div className={[embedded ? '' : 'panel', !embedded && viewMode === 'analytics' ? 'panel--analytics' : ''].filter(Boolean).join(' ')}>
          {showModeSwitch && <div className="operations-mode-switch">
            {nonAnalyticsModes.map((mode) => (
              <button
                key={mode}
                className={[
                  'operations-mode-switch__item',
                  viewMode === mode ? 'operations-mode-switch__item--active' : '',
                ].filter(Boolean).join(' ')}
                type="button"
                onClick={() => setViewMode(mode)}
              >
                {mode === 'investment' ? 'Инвестиции' : 'История'}
              </button>
            ))}
          </div>}

          {viewMode !== 'analytics' ? (
            <>
              <div className="section__header">
                <h3 className="section__title">
                  {viewMode === 'investment'
                    ? 'Инвестиционные операции'
                    : historyScope === 'banking'
                      ? 'История по счетам'
                      : 'История операций'}
                </h3>
                <div className="section__header-actions">
                  {showHistoryTypeFilter ? (
                    <div className="multiselect" ref={typeFilterRef}>
                      <button
                        className="input input--compact multiselect__trigger"
                        type="button"
                        onClick={() => setTypeFilterOpen((prev) => !prev)}
                      >
                        {historyTypeFilter.size === HISTORY_TYPE_OPTIONS.length
                          ? 'Все типы'
                          : historyTypeFilter.size === 0
                            ? 'Не выбрано'
                            : `Выбрано: ${historyTypeFilter.size}`}
                      </button>
                      {typeFilterOpen && (
                        <div className="multiselect__dropdown">
                          {HISTORY_TYPE_OPTIONS.map((option) => (
                            <label key={option.value} className="multiselect__option">
                              <input
                                type="checkbox"
                                checked={historyTypeFilter.has(option.value)}
                                onChange={() => {
                                  setHistoryTypeFilter((prev) => {
                                    const next = new Set(prev);
                                    if (next.has(option.value)) {
                                      next.delete(option.value);
                                    } else {
                                      next.add(option.value);
                                    }
                                    return next;
                                  });
                                }}
                              />
                              {option.label}
                            </label>
                          ))}
                          <button
                            className="multiselect__clear"
                            type="button"
                            onClick={() => {
                              if (historyTypeFilter.size === HISTORY_TYPE_OPTIONS.length) {
                                setHistoryTypeFilter(new Set());
                              } else {
                                setHistoryTypeFilter(new Set(HISTORY_TYPE_OPTIONS.map((o) => o.value)));
                              }
                            }}
                          >
                            {historyTypeFilter.size === HISTORY_TYPE_OPTIONS.length ? 'Сбросить' : 'Выбрать все'}
                          </button>
                        </div>
                      )}
                    </div>
                  ) : showInvestmentTypeFilter ? (
                    <div className="analytics-toolbar__row">
                      {INVESTMENT_HISTORY_FILTER_OPTIONS.map((option) => (
                        <button
                          key={option.value}
                          className={[
                            'analytics-chip',
                            'analytics-chip--compact',
                            investmentHistoryFilter === option.value ? 'analytics-chip--active' : '',
                          ].filter(Boolean).join(' ')}
                          type="button"
                          onClick={() => setInvestmentHistoryFilter(option.value)}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                  ) : historyScope === 'banking' ? (
                    <div className="multiselect" ref={typeFilterRef}>
                      <button
                        className="input input--compact multiselect__trigger"
                        type="button"
                        onClick={() => setTypeFilterOpen((prev) => !prev)}
                      >
                        {bankingTypeFilter.size === BANKING_TYPE_FILTER_OPTIONS.length
                          ? 'Все типы'
                          : bankingTypeFilter.size === 0
                            ? 'Не выбрано'
                            : `Выбрано: ${bankingTypeFilter.size}`}
                      </button>
                      {typeFilterOpen && (
                        <div className="multiselect__dropdown">
                          {BANKING_TYPE_FILTER_OPTIONS.map((option) => (
                            <label key={option.value} className="multiselect__option">
                              <input
                                type="checkbox"
                                checked={bankingTypeFilter.has(option.value)}
                                onChange={() => {
                                  setBankingTypeFilter((prev) => {
                                    const next = new Set(prev);
                                    if (next.has(option.value)) {
                                      next.delete(option.value);
                                    } else {
                                      next.add(option.value);
                                    }
                                    return next;
                                  });
                                }}
                              />
                              {option.label}
                            </label>
                          ))}
                          <button
                            className="multiselect__clear"
                            type="button"
                            onClick={() => {
                              if (bankingTypeFilter.size === BANKING_TYPE_FILTER_OPTIONS.length) {
                                setBankingTypeFilter(new Set());
                              } else {
                                setBankingTypeFilter(new Set(BANKING_TYPE_FILTER_OPTIONS.map((o) => o.value)));
                              }
                            }}
                          >
                            {bankingTypeFilter.size === BANKING_TYPE_FILTER_OPTIONS.length ? 'Сбросить' : 'Выбрать все'}
                          </button>
                        </div>
                      )}
                    </div>
                  ) : null}
                  <span className="tag tag--neutral">{historyTotalCount} всего</span>
                </div>
              </div>

              {viewMode === 'investment' && (
                <p className="list-row__sub" style={{ marginBottom: 12 }}>
                  Здесь собраны сделки по позициям, доход по инвестициям и переводы между обычными и investment-счетами.
                </p>
              )}
              {viewMode === 'history' && historyScope === 'banking' && (
                <p className="list-row__sub" style={{ marginBottom: 12 }}>
                  Здесь только движения по личным и семейным счетам без инвестиционных операций.
                </p>
              )}

              {historyError && (
                <p style={{ color: 'var(--tag-out-fg)', fontSize: '0.85rem', marginBottom: 12 }}>
                  {historyError}
                </p>
              )}

              {visibleHistoryItems.length === 0 && !loadingHistory ? (
                <p className="list-row__sub">Операций пока нет</p>
              ) : (
                <div className="history-list">
                  <ul>
                    {visibleHistoryItems.map((item) => (
                      <li
                        className={[
                          'list-row',
                          'list-row--history',
                          item.type === 'income' || item.type === 'investment_income' ? 'list-row--history-income' : '',
                          item.type === 'expense' ? 'list-row--history-expense' : '',
                          item.type === 'exchange' ? 'list-row--history-exchange' : '',
                        ].filter(Boolean).join(' ')}
                        key={'history-' + item.operation_id}
                      >
                        <div className="history-header">
                          <div className="list-row__title">
                            {getOperationTitle(item)}
                            {item.has_reversal && (
                              <span className="tag tag--neutral history-status-tag">Отменена</span>
                            )}
                          </div>
                          <div className="history-side">
                            {!item.has_reversal
                              && item.type !== 'investment_income'
                              && item.type !== 'investment_trade'
                              && item.type !== 'investment_adjustment' && (
                              <button
                                className="btn"
                                type="button"
                                disabled={reversingOperationId === item.operation_id}
                                onClick={() => handleReverseOperation(item.operation_id)}
                              >
                                {reversingOperationId === item.operation_id ? '...' : 'Отменить'}
                              </button>
                            )}
                          </div>
                        </div>
                        <div className="history-main">
                          <div className="list-row__sub">
                            {item.comment && <span>{item.comment}</span>}
                            <span>{formatDateTime(item.created_at)}</span>
                          </div>
                          <div className="history-lines">
                            {getOperationLines(item).map((line, index) => (
                              <div
                                className="history-line"
                                key={item.operation_id + '-line-' + index}
                              >
                                <span className="history-line__label">{line.label}</span>
                                {line.amount && (
                                  <span className="history-line__amount">{line.amount}</span>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {canLoadMoreHistory && (
                <div className="form-row">
                  <button
                    className="btn"
                    type="button"
                    disabled={loadingHistory}
                    onClick={() => loadHistory(historyItems.length)}
                  >
                    {loadingHistory ? '...' : 'Показать еще'}
                  </button>
                </div>
              )}
            </>
          ) : (
            <div
              className="analytics-view swipeable"
              onTouchStart={handleAnalyticsTouchStart}
              onTouchEnd={handleAnalyticsTouchEnd}
            >
              <div className="analytics-toolbar">
                <div className="analytics-toolbar__row">
                  {ANALYTICS_TYPE_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      className={[
                        'analytics-chip',
                        analyticsTypeFilter === option.value ? 'analytics-chip--active' : '',
                      ].filter(Boolean).join(' ')}
                      type="button"
                      onClick={() => setAnalyticsTypeFilter(option.value)}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
                <div className="analytics-toolbar__row">
                  {ANALYTICS_PERIOD_MODE_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      className={[
                        'analytics-chip',
                        'analytics-chip--compact',
                        analyticsPeriodMode === option.value ? 'analytics-chip--active' : '',
                      ].filter(Boolean).join(' ')}
                      type="button"
                      onClick={() => handleAnalyticsPeriodModeChange(option.value)}
                    >
                      {option.label}
                    </button>
                  ))}
                  <select
                    ref={periodSelectRef}
                    className="analytics-period-select"
                    value={analyticsAnchorDate}
                    onChange={(event) => setAnalyticsAnchorDate(event.target.value)}
                  >
                    {periodSelectOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="analytics-toolbar__row">
                  {ANALYTICS_SCOPE_OPTIONS.filter((option) => analyticsHasFamily || option.value !== 'family').map((option) => (
                    <button
                      key={option.value}
                      className={[
                        'analytics-chip',
                        analyticsOwnerScope === option.value ? 'analytics-chip--active' : '',
                      ].filter(Boolean).join(' ')}
                      type="button"
                      onClick={() => setAnalyticsOwnerScope(option.value)}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>

              {analyticsError && (
                <p style={{ color: 'var(--tag-out-fg)', fontSize: '0.85rem', marginBottom: 12 }}>
                  {analyticsError}
                </p>
              )}

              {analyticsLoading && !analyticsData ? (
                <p className="list-row__sub">Собираем аналитику...</p>
              ) : analyticsData ? (
                <>
                  <div className="analytics-hero">
                    <div className="analytics-hero__amount">
                      {formatAmount(analyticsData.total_amount, analyticsData.base_currency_code)}
                    </div>
                    <div className="analytics-hero__label">
                      {analyticsTypeFilter === 'expense' ? 'Траты' : 'Доходы'}
                    </div>
                    <div className="analytics-hero__meta">
                      <span>
                        {analyticsOwnerScope === 'family'
                          ? 'Семейный срез'
                          : analyticsOwnerScope === 'user'
                            ? 'Личный срез'
                            : 'Все счета'}
                      </span>
                      {hintsEnabled && <span>{getPeriodHint(effectivePeriodMode)}</span>}
                    </div>
                  </div>

                  <section className="analytics-showcase">
                    <div className="analytics-showcase__chart">
                      <div className="analytics-donut-nav">
                        <button className="analytics-donut-nav__arrow" type="button" onClick={() => shiftAnalyticsPeriod(-1)}>‹</button>
                        <div className="analytics-donut-wrap">
                          <div className="analytics-donut analytics-donut--glow" style={{ backgroundImage: donutGradient }}>
                            <div className="analytics-donut__inner">
                              {analyticsData.total_amount <= 0 ? (
                                <>
                                  <span className="analytics-donut__label">Нет операций</span>
                                  <strong>—</strong>
                                </>
                              ) : (
                                <>
                                  <span className="analytics-donut__label">Структура</span>
                                  <strong>{chartSegments[0] ? formatPercent(chartSegments[0].share) : '0%'}</strong>
                                </>
                              )}
                            </div>
                          </div>
                        </div>
                        <button className="analytics-donut-nav__arrow" type="button" onClick={() => shiftAnalyticsPeriod(1)}>›</button>
                      </div>
                    </div>

                    {chartSegments.length > 0 && (
                      <div className="analytics-pill-grid">
                        {chartSegments.map((segment) => (
                          <div className="analytics-pill" key={segment.entryKey}>
                            <span
                              className="analytics-pill__dot"
                              style={{ backgroundColor: segment.color, color: segment.color }}
                            />
                            <div className="analytics-pill__content">
                              <div className="analytics-pill__title">{segment.label}</div>
                              <div className="analytics-pill__meta">
                                <span>{formatAmount(segment.amount, analyticsData.base_currency_code)}</span>
                                <span>{formatPercent(segment.share)}</span>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </section>
                </>
              ) : (
                <p className="list-row__sub">Аналитика пока не загружена.</p>
              )}
            </div>
          )}
        </div>
      </section>
    </>
  );
}
