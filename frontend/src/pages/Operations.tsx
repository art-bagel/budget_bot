import { useEffect, useMemo, useRef, useState } from 'react';
import type { TouchEvent as ReactTouchEvent } from 'react';

import {
  fetchOperationsAnalytics,
  fetchOperationsHistory,
  reverseOperation,
} from '../api';
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
  '#48ccee',
  '#71d9c8',
  '#6b63ff',
  '#b491f7',
  '#7fc0d9',
  '#8b97a4',
];
const HISTORY_TYPE_OPTIONS = [
  { value: '', label: 'Все типы' },
  { value: 'income', label: 'Доход' },
  { value: 'expense', label: 'Расход' },
  { value: 'allocate', label: 'Распределение по категории' },
  { value: 'group_allocate', label: 'Распределение по группе' },
  { value: 'exchange', label: 'Обмен валют' },
  { value: 'account_transfer', label: 'Перевод между счетами' },
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

type OperationLine = {
  label: string;
  amount?: string;
};

type OperationsViewMode = 'history' | 'analytics';

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
  if (item.type === 'income') {
    return item.income_source_name ? 'Доход · ' + item.income_source_name : 'Доход';
  }
  if (item.type === 'expense') return 'Расход';
  if (item.type === 'allocate') return 'Распределение по категории';
  if (item.type === 'group_allocate') return 'Распределение по группе';
  if (item.type === 'exchange') return 'Обмен валют';
  if (item.type === 'account_transfer') return 'Перевод между счетами';
  return item.type;
}


function getBankEntryLabel(
  ownerType?: string | null,
  accountName?: string | null,
  bankAccountId?: number,
): string {
  const resolvedName = accountName || (bankAccountId ? `Счет #${bankAccountId}` : 'Счет');

  if (ownerType === 'family') return 'Семейный · ' + resolvedName;
  if (ownerType === 'user') return 'Личный · ' + resolvedName;
  return resolvedName;
}


function getBudgetEntryLabel(name: string): string {
  if (name === 'Личный свободный остаток') return 'Личный остаток';
  if (name === 'Семейный свободный остаток') return 'Семейный остаток';
  return name;
}


function getOperationLines(item: OperationHistoryItem): OperationLine[] {
  const lines: OperationLine[] = [];

  item.bank_entries.forEach((entry) => {
    lines.push({
      label: getBankEntryLabel(
        entry.bank_account_owner_type,
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


function getOwnerLabel(ownerType: 'user' | 'family' | 'mixed'): string {
  if (ownerType === 'family') return 'Семейное';
  if (ownerType === 'mixed') return 'Сводно';
  return 'Личное';
}


export default function Operations({ user: _user }: { user: UserContext }) {
  const [viewMode, setViewMode] = useState<OperationsViewMode>('history');

  const [historyItems, setHistoryItems] = useState<OperationHistoryItem[]>([]);
  const [historyTotalCount, setHistoryTotalCount] = useState(0);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historyTypeFilter, setHistoryTypeFilter] = useState('');
  const [reversingOperationId, setReversingOperationId] = useState<number | null>(null);

  const [analyticsData, setAnalyticsData] = useState<OperationAnalyticsResponse | null>(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [analyticsError, setAnalyticsError] = useState<string | null>(null);
  const [analyticsTypeFilter, setAnalyticsTypeFilter] = useState<'expense' | 'income'>('expense');
  const [analyticsOwnerScope, setAnalyticsOwnerScope] = useState<'all' | 'user' | 'family'>('all');
  const [analyticsPeriodMode, setAnalyticsPeriodMode] = useState<AnalyticsPeriodMode>('month');
  const [analyticsAnchorDate, setAnalyticsAnchorDate] = useState(getCurrentAnchorDate('month'));
  const analyticsSwipeRef = useRef<{ startX: number; startY: number } | null>(null);

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

  const loadHistory = async (
    offset: number,
    replace = false,
    operationType = historyTypeFilter,
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
    void loadHistory(0, true);
  }, [historyTypeFilter]);

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

  const canLoadMoreHistory = !loadingHistory && historyItems.length < historyTotalCount;

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
    navigator.vibrate?.(10);
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
      <h1 className="page-title">Операции</h1>

      <section className="section">
        <div className="section__header">
          <h2 className="section__title">История и аналитика</h2>
        </div>
        <div className={['panel', viewMode === 'analytics' ? 'panel--analytics' : ''].filter(Boolean).join(' ')}>
          <div className="operations-mode-switch">
            <button
              className={[
                'operations-mode-switch__item',
                viewMode === 'history' ? 'operations-mode-switch__item--active' : '',
              ].filter(Boolean).join(' ')}
              type="button"
              onClick={() => setViewMode('history')}
            >
              История
            </button>
            <button
              className={[
                'operations-mode-switch__item',
                viewMode === 'analytics' ? 'operations-mode-switch__item--active' : '',
              ].filter(Boolean).join(' ')}
              type="button"
              onClick={() => setViewMode('analytics')}
            >
              Аналитика
            </button>
          </div>

          {viewMode === 'history' ? (
            <>
              <div className="section__header">
                <h3 className="section__title">История операций</h3>
                <div className="section__header-actions">
                  <select
                    className="input input--compact"
                    value={historyTypeFilter}
                    onChange={(event) => setHistoryTypeFilter(event.target.value)}
                  >
                    {HISTORY_TYPE_OPTIONS.map((option) => (
                      <option key={option.value || 'all'} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <span className="tag tag--neutral">{historyTotalCount} всего</span>
                </div>
              </div>

              {historyError && (
                <p style={{ color: 'var(--tag-out-fg)', fontSize: '0.85rem', marginBottom: 12 }}>
                  {historyError}
                </p>
              )}

              {historyItems.length === 0 && !loadingHistory ? (
                <p className="list-row__sub">Операций пока нет</p>
              ) : (
                <div className="history-list">
                  <ul>
                    {historyItems.map((item) => (
                      <li
                        className={[
                          'list-row',
                          'list-row--history',
                          item.type === 'income' ? 'list-row--history-income' : '',
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
                            {!item.has_reversal && (
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
                <div className="analytics-toolbar__group">
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
                <div className="analytics-toolbar__group analytics-toolbar__group--filters">
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
                    className="input input--compact analytics-period-select"
                    value={analyticsAnchorDate}
                    onChange={(event) => setAnalyticsAnchorDate(event.target.value)}
                  >
                    {periodSelectOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <select
                    className="input input--compact"
                    value={analyticsOwnerScope}
                    onChange={(event) => setAnalyticsOwnerScope(event.target.value as 'all' | 'user' | 'family')}
                  >
                    {ANALYTICS_SCOPE_OPTIONS.filter((option) => analyticsHasFamily || option.value !== 'family').map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
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
                    <div className="analytics-hero__eyebrow">
                      {formatPeriodRange(effectivePeriodStart, effectivePeriodMode)}
                    </div>
                    <div className="analytics-hero__amount">
                      {formatAmount(analyticsData.total_amount, analyticsData.base_currency_code)}
                    </div>
                    <div className="analytics-hero__label">
                      {analyticsTypeFilter === 'expense' ? 'Траты' : 'Доходы'}
                    </div>
                    <div className="analytics-hero__meta">
                      <span>{analyticsData.total_operations} операций</span>
                      <span>
                        {analyticsOwnerScope === 'family'
                          ? 'Семейный срез'
                          : analyticsOwnerScope === 'user'
                            ? 'Личный срез'
                            : 'Все счета'}
                      </span>
                      <span>{getPeriodHint(effectivePeriodMode)}</span>
                    </div>
                  </div>

                  {analyticsData.total_amount <= 0 ? (
                    <p className="list-row__sub">
                      За выбранный период пока нет данных для аналитики.
                    </p>
                  ) : (
                    <>
                      <section className="analytics-showcase">
                        <div className="analytics-showcase__chart">
                          <div className="analytics-donut-wrap">
                            <div className="analytics-donut analytics-donut--glow" style={{ backgroundImage: donutGradient }}>
                              <div className="analytics-donut__inner">
                                <span className="analytics-donut__label">Структура</span>
                                <strong>{chartSegments[0] ? formatPercent(chartSegments[0].share) : '0%'}</strong>
                              </div>
                            </div>
                          </div>
                        </div>

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
                      </section>
                      <section className="analytics-card analytics-card--full">
                        <div className="analytics-card__title">
                          {analyticsTypeFilter === 'expense' ? 'Детализация категорий' : 'Детализация источников'}
                        </div>
                        <div className="analytics-ranking">
                          {analyticsData.items.map((item, index) => {
                            const share = analyticsData.total_amount > 0
                              ? item.amount / analyticsData.total_amount
                              : 0;

                            return (
                              <div className="analytics-ranking__item" key={item.entry_key + '-' + item.owner_type}>
                                <div className="analytics-ranking__head">
                                  <div>
                                    <div className="analytics-ranking__title">
                                      {index + 1}. {item.label}
                                    </div>
                                    <div className="analytics-ranking__meta">
                                      {getOwnerLabel(item.owner_type)} · {item.operations_count} операций
                                    </div>
                                  </div>
                                  <div className="analytics-ranking__amount">
                                    {formatAmount(item.amount, analyticsData.base_currency_code)}
                                  </div>
                                </div>
                                <div className="analytics-ranking__bar">
                                  <div
                                    className="analytics-ranking__bar-fill"
                                    style={{ width: `${Math.max(share * 100, 4)}%` }}
                                  />
                                </div>
                                <div className="analytics-ranking__share">{formatPercent(share)}</div>
                              </div>
                            );
                          })}
                        </div>
                      </section>
                    </>
                  )}
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
