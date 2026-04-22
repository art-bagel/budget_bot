import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { TouchEvent as ReactTouchEvent } from 'react';

import {
  fetchOperationsAnalytics,
  fetchOperationsHistory,
  reverseOperation,
} from '../api';
import { hapticLight } from '../telegram';
import { IconTag, IconPlus, IconArrowRightLeft, IconPortfolio, IconCredit, IconChevronRight } from '../components/Icons';
import { CategorySvgIcon } from '../components/CategorySvgIcon';
import { parseCategoryIcon } from '../utils/categoryIcon';
import { useHints } from '../hooks/useHints';
import type {
  OperationAnalyticsItem,
  OperationAnalyticsMonth,
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


function formatBigNumber(amount: number): string {
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(Math.round(amount));
}


function formatBarLabel(periodStart: string, periodMode: AnalyticsPeriodMode): string {
  const date = fromIsoDate(periodStart);
  if (periodMode === 'year') return String(date.getFullYear());
  if (periodMode === 'month') {
    return new Intl.DateTimeFormat('ru-RU', { month: 'short' }).format(date).replace('.', '');
  }
  return `${String(date.getDate()).padStart(2, '0')}.${String(date.getMonth() + 1).padStart(2, '0')}`;
}


const MONTHS_DATIVE = ['январю','февралю','марту','апрелю','маю','июню','июлю','августу','сентябрю','октябрю','ноябрю','декабрю'];

function formatPrevPeriodRef(periodStart: string, periodMode: AnalyticsPeriodMode): string {
  const date = fromIsoDate(periodStart);
  if (periodMode === 'month') return `к ${MONTHS_DATIVE[date.getMonth()]} ${date.getFullYear()}`;
  if (periodMode === 'year') return `к ${date.getFullYear()} г.`;
  const end = new Date(date);
  end.setDate(end.getDate() + 6);
  const fmt = (d: Date) => `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}`;
  return `к ${fmt(date)}–${fmt(end)}`;
}

function computePeriodDelta(periods: OperationAnalyticsMonth[]): { pct: number; prevStart: string } | null {
  if (periods.length < 2) return null;
  const sorted = [...periods].sort((a, b) => a.period_start.localeCompare(b.period_start));
  const idx = sorted.findIndex((p) => p.is_selected);
  if (idx <= 0) return null;
  const current = sorted[idx];
  if (current.amount === 0) return null;
  // Ищем ближайшую предыдущую точку с ненулевым значением
  let prevIdx = idx - 1;
  while (prevIdx >= 0 && sorted[prevIdx].amount === 0) prevIdx--;
  if (prevIdx < 0) return null;
  const prev = sorted[prevIdx];
  return { pct: ((current.amount - prev.amount) / prev.amount) * 100, prevStart: prev.period_start };
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
  return parseCategoryIcon(name).displayName;
}

const OP_DOT_CLASS: Record<string, string> = {
  income: 'income', expense: 'expense', account_transfer: 'xfer',
  allocate: 'alloc', group_allocate: 'alloc', exchange: 'exch',
  investment_trade: 'invest', investment_income: 'invest', investment_adjustment: 'invest',
  credit_repayment: 'credit', cancelled: 'cancel',
};
function getDotClass(value: string): string { return OP_DOT_CLASS[value] ?? 'xfer'; }

const CAT_COLOR_KEYS = ['g', 'o', 'b', 'p', 'r', 'v'] as const;

function getOpIcoClass(item: OperationHistoryItem): string {
  if (item.type === 'income') return 'op-ico--income';
  if (item.type === 'account_transfer') return 'op-ico--xfer';
  if (item.type === 'allocate' || item.type === 'group_allocate') return 'op-ico--alloc';
  if (item.type === 'exchange') return 'op-ico--exch';
  if (item.type === 'investment_trade' || item.type === 'investment_income' || item.type === 'investment_adjustment') return 'op-ico--invest';
  if (item.type === 'credit_repayment') return 'op-ico--credit';
  if (item.type === 'expense') {
    const colorKeys = CAT_COLOR_KEYS;
    return `op-ico--cat-${colorKeys[(item.budget_entries[0]?.category_id ?? 0) % 6]}`;
  }
  return 'op-ico--xfer';
}

function getOpIcoContent(item: OperationHistoryItem): React.ReactNode {
  if (item.type === 'expense') {
    const catName = item.budget_entries[0]?.category_name;
    if (catName) {
      const p = parseCategoryIcon(catName);
      if (p.kind === 'svg' && p.icon) return <CategorySvgIcon code={p.icon} />;
      if (p.kind === 'emoji' && p.icon) return <span className="op-ico__emoji">{p.icon}</span>;
    }
    return <IconTag />;
  }
  if (item.type === 'income') return <IconPlus />;
  if (item.type === 'investment_trade' || item.type === 'investment_income' || item.type === 'investment_adjustment') return <IconPortfolio />;
  if (item.type === 'credit_repayment') return <IconCredit />;
  return <IconArrowRightLeft />;
}

function getOpAmount(item: OperationHistoryItem): { text: string; cls: string } | null {
  const entry = item.type === 'allocate' || item.type === 'group_allocate'
    ? item.budget_entries[0]
    : item.bank_entries[0];
  if (!entry) return null;
  const text = formatSignedAmount(entry.amount, entry.currency_code);
  if (item.type === 'expense') return { text, cls: 'op-row__amt--neg' };
  if (item.type === 'income' || item.type === 'investment_income') return { text, cls: 'op-row__amt--pos' };
  return { text, cls: '' };
}

function getOpSubtitle(item: OperationHistoryItem): string {
  const time = new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' }).format(new Date(item.created_at));
  const ownerLabel = (t?: string | null) => t === 'family' ? 'Семейный' : t === 'user' ? 'Личный' : null;

  if (item.type === 'expense' && item.budget_entries.length > 0) {
    const cat = parseCategoryIcon(item.budget_entries[0].category_name).displayName;
    const owner = ownerLabel(item.bank_entries[0]?.bank_account_owner_type);
    return [cat, owner, time].filter(Boolean).join(' · ');
  }
  if (item.type === 'income') {
    const e = item.bank_entries[0];
    return [ownerLabel(e?.bank_account_owner_type), e?.bank_account_name, time].filter(Boolean).join(' · ');
  }
  if (item.type === 'account_transfer' && item.bank_entries.length >= 2) {
    const from = ownerLabel(item.bank_entries[0].bank_account_owner_type) ?? 'Счет';
    const to = ownerLabel(item.bank_entries[1].bank_account_owner_type) ?? 'Счет';
    return `${from} → ${to} · ${time}`;
  }
  return [ownerLabel(item.bank_entries[0]?.bank_account_owner_type), time].filter(Boolean).join(' · ');
}

function formatDateGroupLabel(isoKey: string): string {
  const date = new Date(isoKey + 'T12:00:00');
  const todayKey = new Date().toLocaleDateString('en-CA');
  const yestKey = new Date(Date.now() - 864e5).toLocaleDateString('en-CA');
  const dayLabel = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' }).format(date);
  if (isoKey === todayKey) return `Сегодня · ${dayLabel}`;
  if (isoKey === yestKey) return `Вчера · ${dayLabel}`;
  return dayLabel;
}

function groupByDate(items: OperationHistoryItem[]): { dateKey: string; dateLabel: string; items: OperationHistoryItem[] }[] {
  const groups = new Map<string, OperationHistoryItem[]>();
  for (const item of items) {
    const key = item.operated_at ?? new Date(item.created_at).toLocaleDateString('en-CA');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(item);
  }
  return Array.from(groups.entries())
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([key, its]) => ({ dateKey: key, dateLabel: formatDateGroupLabel(key), items: its }));
}


const OP_SYSTEM_COMMENT_PREFIXES = ['Платёж по кредиту', 'Частичное закрытие позиции', 'Пополнение позиции', 'Комиссия по позиции'];

function getOpComment(item: OperationHistoryItem): string | null {
  if (!item.comment) return null;
  if (OP_SYSTEM_COMMENT_PREFIXES.some((p) => item.comment!.includes(p))) return null;
  return item.comment;
}

function isCancellable(item: OperationHistoryItem): boolean {
  return !item.has_reversal
    && item.type !== 'investment_income'
    && item.type !== 'investment_trade'
    && item.type !== 'investment_adjustment';
}

function hasOpDetail(item: OperationHistoryItem): boolean {
  if (getOpComment(item)) return true;
  if (item.reversal_of_operation_id) return true;
  if (item.budget_entries.length > 1) return true;
  if (item.budget_entries.length === 1 && (item.type === 'allocate' || item.type === 'group_allocate')) return true;
  if (item.bank_entries.length > 1) return true;
  if (isCancellable(item)) return true;
  return false;
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
    () => new Set(['income', 'expense']),
  );
  const [investmentHistoryFilter, setInvestmentHistoryFilter] = useState<InvestmentHistoryFilter>('all');
  const [bankingTypeFilter, setBankingTypeFilter] = useState<Set<string>>(
    () => new Set(['income', 'expense']),
  );
  const [reversingOperationId, setReversingOperationId] = useState<number | null>(null);
  const [expandedOps, setExpandedOps] = useState<Set<number>>(new Set());
  const [typeFilterOpen, setTypeFilterOpen] = useState(false);
  const typeFilterRef = useRef<HTMLDivElement>(null);
  const loadMoreSentinelRef = useRef<HTMLDivElement>(null);

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

  const loadMoreHistory = useCallback(() => {
    if (canLoadMoreHistory) loadHistory(historyItems.length);
  }, [canLoadMoreHistory, historyItems.length]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const sentinel = loadMoreSentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      (entries) => { if (entries[0].isIntersecting) loadMoreHistory(); },
      { threshold: 0.1 },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [loadMoreHistory]);
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

          {viewMode !== 'analytics' ? (() => {
            const activeFilter = historyScope === 'banking' ? bankingTypeFilter : historyTypeFilter;
            const activeFilterEmpty = activeFilter.size === 0;
            return (
            <>
              {/* Chip-карусель фильтра по типам */}
              {(showHistoryTypeFilter || historyScope === 'banking') && (() => {
                const opts = historyScope === 'banking' ? BANKING_TYPE_FILTER_OPTIONS : HISTORY_TYPE_OPTIONS;
                const active = historyScope === 'banking' ? bankingTypeFilter : historyTypeFilter;
                const setActive = historyScope === 'banking' ? setBankingTypeFilter : setHistoryTypeFilter;
                const allActive = active.size >= opts.length;
                const toggle = (val: string) => setActive((prev) => {
                  const next = new Set(prev);
                  if (next.has(val)) next.delete(val); else next.add(val);
                  return next;
                });
                const toggleAll = () => setActive(
                  allActive ? new Set<string>() : new Set(opts.map((o) => o.value)),
                );
                return (
                  <div className="op-filter" role="group" aria-label="Фильтр операций">
                    <button
                      type="button"
                      className={`op-filter__chip op-filter__chip--all${allActive ? ' op-filter__chip--active' : ''}`}
                      onClick={toggleAll}
                    >Все</button>
                    {opts.map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        className={`op-filter__chip${active.has(opt.value) ? ' op-filter__chip--active' : ''}`}
                        onClick={() => toggle(opt.value)}
                      >
                        <span className={`op-dot op-dot--${getDotClass(opt.value)}`} />
                        {opt.label}
                      </button>
                    ))}
                  </div>
                );
              })()}

              {showInvestmentTypeFilter && (
                <div className="op-filter" role="group">
                  {INVESTMENT_HISTORY_FILTER_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      className={`op-filter__chip${investmentHistoryFilter === option.value ? ' op-filter__chip--active' : ''}`}
                      onClick={() => setInvestmentHistoryFilter(option.value)}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              )}

              {historyError && (
                <p style={{ color: 'var(--neg)', fontSize: '0.85rem', marginBottom: 12 }}>
                  {historyError}
                </p>
              )}

              {activeFilterEmpty ? (
                <p className="op-empty op-empty__msg">Выберите тип операций</p>
              ) : visibleHistoryItems.length === 0 && !loadingHistory ? (
                <p className="op-empty op-empty__msg">Операций пока нет</p>
              ) : (
                <div className="op-groups">
                  {groupByDate(visibleHistoryItems).map((group) => (
                    <div className="op-group" key={group.dateKey}>
                      <div className="op-group__head">{group.dateLabel}</div>
                      {group.items.map((item) => {
                        const amt = getOpAmount(item);
                        const canExpand = hasOpDetail(item);
                        const expanded = expandedOps.has(item.operation_id);
                        const comment = getOpComment(item);

                        const toggleExpand = canExpand
                          ? () => setExpandedOps((prev) => {
                              const next = new Set(prev);
                              next.has(item.operation_id) ? next.delete(item.operation_id) : next.add(item.operation_id);
                              return next;
                            })
                          : undefined;

                        return (
                          <div
                            className={[
                              'op-row',
                              item.has_reversal ? 'op-row--cancelled' : '',
                              canExpand ? 'op-row--expandable' : '',
                            ].filter(Boolean).join(' ')}
                            key={item.operation_id}
                            onClick={toggleExpand}
                          >
                            <span className={`op-ico ${getOpIcoClass(item)}`}>
                              {getOpIcoContent(item)}
                            </span>
                            <div className="op-row__body">
                              <div className="op-row__top">
                                <span className="op-row__name">
                                  <span className="op-row__name-text">{getOperationTitle(item)}</span>
                                  {item.has_reversal && (
                                    <span className="op-row__tag">Отменена</span>
                                  )}
                                </span>
                                <div className="op-row__top-r">
                                  {amt && (
                                    <strong className={`op-row__amt${amt.cls ? ' ' + amt.cls : ''}`}>{amt.text}</strong>
                                  )}
                                  {canExpand && (
                                    <span className={`op-row__chevron${expanded ? ' op-row__chevron--open' : ''}`}>
                                      <IconChevronRight />
                                    </span>
                                  )}
                                </div>
                              </div>
                              <span className="op-row__sub">{getOpSubtitle(item)}</span>
                              {expanded && isCancellable(item) && (
                                <button
                                  className="op-row__cancel"
                                  type="button"
                                  disabled={reversingOperationId === item.operation_id}
                                  onClick={(e) => { e.stopPropagation(); handleReverseOperation(item.operation_id); }}
                                >
                                  {reversingOperationId === item.operation_id ? '...' : 'Отменить'}
                                </button>
                              )}
                              {expanded && (
                                <div className="op-row__detail">
                                  {comment && (
                                    <div className="op-detail__comment">{comment}</div>
                                  )}
                                  {item.budget_entries.length > 0 && (item.budget_entries.length > 1 || item.type === 'allocate' || item.type === 'group_allocate') && (
                                    <div className="op-detail__entries">
                                      {item.budget_entries.map((entry, i) => {
                                        const parsed = parseCategoryIcon(entry.category_name);
                                        const colorKey = CAT_COLOR_KEYS[entry.category_id % CAT_COLOR_KEYS.length];
                                        return (
                                          <div className="op-detail__entry" key={i}>
                                            <span className={`op-detail__ico op-ico--cat-${colorKey}`}>
                                              {parsed.kind === 'svg' && parsed.icon
                                                ? <CategorySvgIcon code={parsed.icon} />
                                                : parsed.kind === 'emoji' && parsed.icon
                                                  ? <span className="op-ico__emoji">{parsed.icon}</span>
                                                  : <IconTag />}
                                            </span>
                                            <span className="op-detail__name">{parsed.displayName}</span>
                                            <span className="op-detail__amt">{formatSignedAmount(entry.amount, entry.currency_code)}</span>
                                          </div>
                                        );
                                      })}
                                    </div>
                                  )}
                                  {item.bank_entries.length > 1 && (
                                    <div className="op-detail__entries op-detail__entries--bank">
                                      {item.bank_entries.map((entry, i) => (
                                        <div className="op-detail__entry" key={i}>
                                          <span className="op-detail__name">{getBankEntryLabel(entry.bank_account_owner_type, entry.bank_account_kind, entry.bank_account_name, entry.bank_account_id)}</span>
                                          <span className="op-detail__amt">{formatSignedAmount(entry.amount, entry.currency_code)}</span>
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                  {item.reversal_of_operation_id && (
                                    <div className="op-detail__note">Отмена операции #{item.reversal_of_operation_id}</div>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ))}
                </div>
              )}

              {!activeFilterEmpty && <div ref={loadMoreSentinelRef} className="op-sentinel" />}
              {loadingHistory && <div className="op-loading">...</div>}
            </>
            );
          })() : (
            <div
              className="analytics-view swipeable"
              onTouchStart={handleAnalyticsTouchStart}
              onTouchEnd={handleAnalyticsTouchEnd}
            >
              <div className="ana-seg">
                {ANALYTICS_TYPE_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    className={['ana-seg__opt', analyticsTypeFilter === option.value ? 'ana-seg__opt--active' : ''].filter(Boolean).join(' ')}
                    type="button"
                    onClick={() => setAnalyticsTypeFilter(option.value)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>

              <div className="ana-scope">
                {ANALYTICS_PERIOD_MODE_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    className={['ana-scope__chip', analyticsPeriodMode === option.value ? 'ana-scope__chip--active' : ''].filter(Boolean).join(' ')}
                    type="button"
                    onClick={() => handleAnalyticsPeriodModeChange(option.value)}
                  >
                    {option.label}
                  </button>
                ))}
                <select
                  ref={periodSelectRef}
                  className="ana-period-select"
                  value={analyticsAnchorDate}
                  onChange={(event) => setAnalyticsAnchorDate(event.target.value)}
                >
                  {periodSelectOptions.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </div>

              {analyticsError && (
                <p style={{ color: 'var(--neg)', fontSize: '0.85rem', marginBottom: 12 }}>
                  {analyticsError}
                </p>
              )}

              {analyticsLoading && !analyticsData ? (
                <p className="list-row__sub">Собираем аналитику...</p>
              ) : analyticsData ? (
                <>
                  {analyticsData.periods.length > 0 && (() => {
                    const maxAmt = Math.max(...analyticsData.periods.map((p) => p.amount), 1);
                    return (
                      <div className="trend">
                        <div className="trend__nav">
                          <button className="trend__nav-btn" type="button" onClick={() => shiftAnalyticsPeriod(-1)}>‹</button>
                          <span className="trend__period-label">{formatPeriodRange(effectivePeriodStart, effectivePeriodMode)}</span>
                          <button className="trend__nav-btn" type="button" onClick={() => shiftAnalyticsPeriod(1)}>›</button>
                        </div>
                        <div className="trend__bars">
                          {analyticsData.periods.map((period) => {
                            const heightPct = Math.max((period.amount / maxAmt) * 100, 3);
                            return (
                              <div
                                key={period.period_start}
                                className={['trend__bar', period.is_selected ? 'trend__bar--active' : ''].filter(Boolean).join(' ')}
                                onClick={() => setAnalyticsAnchorDate(period.period_start)}
                              >
                                <div className="trend__fill" style={{ height: `${heightPct}%` }} />
                                <span className="trend__lbl">{formatBarLabel(period.period_start, effectivePeriodMode)}</span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })()}

                  <div className="ana-hero">
                    <div className="ana-hero__val">
                      <span className="ana-hero__num">{formatBigNumber(analyticsData.total_amount)}</span>
                      <span className="ana-hero__sym">{analyticsData.base_currency_code}</span>
                    </div>
                    <div className="ana-hero__meta">
                      <span>{analyticsTypeFilter === 'expense' ? 'Траты' : 'Доходы'}</span>
                      {(() => {
                        const delta = computePeriodDelta(analyticsData.periods);
                        if (!delta) return null;
                        const isGood = analyticsTypeFilter === 'expense' ? delta.pct < 0 : delta.pct > 0;
                        return (
                          <>
                            <span className={`delta ${isGood ? 'delta--down' : 'delta--up'}`}>
                              {delta.pct < 0 ? '↓' : '↑'} {Math.abs(delta.pct).toFixed(0)}%
                            </span>
                            <span className="ana-hero__cmp">{formatPrevPeriodRef(delta.prevStart, effectivePeriodMode)}</span>
                          </>
                        );
                      })()}
                    </div>
                    <div className="ana-scope-sub">
                      {ANALYTICS_SCOPE_OPTIONS.filter((option) => analyticsHasFamily || option.value !== 'family').map((option) => (
                        <button
                          key={option.value}
                          className={['ana-scope-sub__chip', analyticsOwnerScope === option.value ? 'ana-scope-sub__chip--active' : ''].filter(Boolean).join(' ')}
                          type="button"
                          onClick={() => setAnalyticsOwnerScope(option.value)}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {chartSegments.length > 0 && (
                    <div className="ana-cats">
                      {chartSegments.map((segment, index) => {
                        const colorKeys = ['g', 'o', 'b', 'p', 'r', 'v'];
                        const colorKey = colorKeys[index % colorKeys.length];
                        const parsed = parseCategoryIcon(segment.label);
                        return (
                          <div className="ana-cat" key={segment.entryKey}>
                            <div className={`ana-cat__ico ana-cat__ico--${colorKey}`}>
                              {parsed.kind === 'svg' && parsed.icon
                                ? <CategorySvgIcon code={parsed.icon} />
                                : parsed.kind === 'emoji' && parsed.icon
                                  ? <span className="ana-cat__emoji">{parsed.icon}</span>
                                  : <IconTag />}
                            </div>
                            <div className="ana-cat__body">
                              <div className="ana-cat__top">
                                <span className="ana-cat__name">{parsed.displayName}</span>
                                <span className="ana-cat__amt">{formatAmount(segment.amount, analyticsData.base_currency_code)}</span>
                              </div>
                              <div className="ana-cat__bar-wrap">
                                <div className={`ana-cat__fill ana-cat__fill--${colorKey}`} style={{ width: `${Math.round(segment.share * 100)}%` }} />
                              </div>
                              <div className="ana-cat__foot">
                                <span>{segment.operationsCount} операций</span>
                                <span>{formatPercent(segment.share)}</span>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
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
