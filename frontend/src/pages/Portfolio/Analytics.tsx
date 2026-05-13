import { useMemo, useState } from 'react';
import type {
  PortfolioAnalyticsData,
  PortfolioPosition,
} from '../../types';
import { currencySymbol, formatNumericAmount } from '../../utils/format';
import { getPositionMetadataNumber, getPositionMetadataText } from '../../utils/portfolioPosition';

// ──────────────────────────────────────────────────────────────────────────────
// Period model
// ──────────────────────────────────────────────────────────────────────────────

export type AnalyticsPeriodType = '1M' | '3M' | '6M' | '1Y' | 'ALL';

export const PERIOD_DAYS: Record<Exclude<AnalyticsPeriodType, 'ALL'>, number> = {
  '1M': 30,
  '3M': 91,
  '6M': 182,
  '1Y': 365,
};

export const PERIOD_LABEL: Record<AnalyticsPeriodType, string> = {
  '1M': '1 месяц',
  '3M': '3 месяца',
  '6M': '6 месяцев',
  '1Y': '12 месяцев',
  'ALL': 'Всё время',
};

export const PERIOD_CHIP_LABEL: Record<AnalyticsPeriodType, string> = {
  '1M': '1М',
  '3M': '3М',
  '6M': '6М',
  '1Y': '1Г',
  'ALL': 'Всё',
};

export const PERIOD_TYPES: readonly AnalyticsPeriodType[] = ['1M', '3M', '6M', '1Y', 'ALL'];

export interface AnalyticsPeriodRange {
  dateFrom: string;
  dateTo: string;
  label: string;
  offsetAllowed: boolean;
}

export function getAnalyticsPeriodRange(
  periodType: AnalyticsPeriodType,
  offset: number,
): AnalyticsPeriodRange {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  if (periodType === 'ALL') {
    const start = new Date(2000, 0, 1);
    return {
      dateFrom: start.toISOString().slice(0, 10),
      dateTo: today.toISOString().slice(0, 10),
      label: PERIOD_LABEL.ALL,
      offsetAllowed: false,
    };
  }

  const days = PERIOD_DAYS[periodType];
  const end = new Date(today);
  end.setDate(end.getDate() + offset * days);
  const start = new Date(end);
  start.setDate(start.getDate() - days);

  const fmtShort = (d: Date) => d.toLocaleDateString('ru-RU', { day: '2-digit', month: 'short' });
  const label = offset === 0
    ? PERIOD_LABEL[periodType]
    : `${fmtShort(start)} – ${fmtShort(end)}`;

  return {
    dateFrom: start.toISOString().slice(0, 10),
    dateTo: end.toISOString().slice(0, 10),
    label,
    offsetAllowed: true,
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// Constants
// ──────────────────────────────────────────────────────────────────────────────

type AssetTabCode = 'all' | 'security' | 'deposit' | 'crypto' | 'other';

const ASSET_TINT: Record<AssetTabCode, 'ink' | 'mint' | 'coral' | 'grape'> = {
  all: 'ink',
  security: 'ink',
  deposit: 'mint',
  crypto: 'coral',
  other: 'grape',
};

const ASSET_HEX: Record<AssetTabCode, string> = {
  all: '#0A0B0D',
  security: '#0A0B0D',
  deposit: '#2F9E7F',
  crypto: '#E86A4F',
  other: '#7A56C7',
};

const INCOME_KIND_LABELS: Record<string, string> = {
  dividend: 'Дивиденды',
  interest: 'Проценты по вкладам',
  coupon: 'Купоны',
  reward: 'Награды',
  staking: 'Стейкинг',
  lending: 'Лендинг',
  liquidity: 'Пулы ликвидности',
  other: 'Прочее',
};

const INCOME_KIND_COLOR: Record<string, string> = {
  dividend: '#E86A4F',
  coupon: '#2F9E7F',
  interest: '#7A56C7',
  reward: '#FFDD2D',
  staking: '#FFDD2D',
  lending: '#FFDD2D',
  liquidity: '#FFDD2D',
  other: '#9AA0A8',
};

const ASSET_LABEL: Record<AssetTabCode, string> = {
  all: 'Весь портфель',
  security: 'Ценные бумаги',
  deposit: 'Депозиты',
  crypto: 'Крипта',
  other: 'Прочее',
};

function isAssetCode(s: string): s is AssetTabCode {
  return s === 'all' || s === 'security' || s === 'deposit' || s === 'crypto' || s === 'other';
}

function pluralRu(n: number, forms: [string, string, string]): string {
  const abs = Math.abs(n);
  const mod10 = abs % 10;
  const mod100 = abs % 100;
  if (mod100 >= 11 && mod100 <= 14) return forms[2];
  if (mod10 === 1) return forms[0];
  if (mod10 >= 2 && mod10 <= 4) return forms[1];
  return forms[2];
}

// ──────────────────────────────────────────────────────────────────────────────
// Inline SVG icons
// ──────────────────────────────────────────────────────────────────────────────

const I = {
  chart: () => (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M5 19V11M10 19V7M15 19v-6M20 19v-9" />
    </svg>
  ),
  safe: () => (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8">
      <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
      <circle cx="13" cy="12" r="3.2" />
      <path d="M13 9.5V11M7 12h2M13 19.5v1M17 19.5v1" strokeLinecap="round" />
    </svg>
  ),
  coin: () => (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="12" cy="12" r="8.5" />
      <path d="M14.5 9H11a1.8 1.8 0 0 0 0 3.6h2a1.8 1.8 0 0 1 0 3.6H9M12 7.5V9M12 15v1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  diamond: () => (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round">
      <path d="m12 3 9 7-9 11L3 10l9-7z" />
      <path d="M3 10h18" strokeWidth="1.4" />
    </svg>
  ),
  source: () => (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
      <path d="M2 13.5h12M3 13V8M6 13V5M9 13V9M12 13V3" />
    </svg>
  ),
  calendar: () => (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.4">
      <rect x="2" y="3.5" width="12" height="10" rx="1.4" />
      <path d="M2 6.5h12M5.5 2v3M10.5 2v3" strokeLinecap="round" />
    </svg>
  ),
  trophy: () => (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 2h6v4a3 3 0 0 1-6 0V2zM3.5 3v1.5a2 2 0 0 0 1.5 1.9M12.5 3v1.5a2 2 0 0 1-1.5 1.9M6 14h4M7.5 9.5h1V14" />
    </svg>
  ),
  donut: () => (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.4">
      <circle cx="8" cy="8" r="6" />
      <circle cx="8" cy="8" r="2.5" />
    </svg>
  ),
  hourglass: () => (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 2.5h8M4 13.5h8M5 2.5c0 3 6 3.5 6 5.5s-6 2.5-6 5.5M11 2.5c0 3-6 3.5-6 5.5s6 2.5 6 5.5" />
    </svg>
  ),
  trade: () => (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 5h9l-2-2M14 11H5l2 2" />
    </svg>
  ),
  info: () => (
    <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.4">
      <circle cx="8" cy="8" r="6.5" />
      <path d="M8 7v4M8 5v.01" strokeLinecap="round" />
    </svg>
  ),
  chevL: () => (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="m10 3-5 5 5 5" />
    </svg>
  ),
  chevR: () => (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="m6 3 5 5-5 5" />
    </svg>
  ),
};

function ScopeIcon({ tab }: { tab: AssetTabCode }) {
  switch (tab) {
    case 'security':
    case 'all': return I.chart();
    case 'deposit': return I.safe();
    case 'crypto': return I.coin();
    case 'other': return I.diamond();
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Component
// ──────────────────────────────────────────────────────────────────────────────

interface Props {
  data: PortfolioAnalyticsData | null;
  loading: boolean;
  periodType: AnalyticsPeriodType;
  periodOffset: number;
  periodRange: AnalyticsPeriodRange;
  onPeriodOffsetChange: (offset: number) => void;
  activeAssetTypeCode: string;
  baseCurrencyCode: string;
  openPositions: PortfolioPosition[];
  onOpenPosition?: (positionId: number) => void;
}

export default function PortfolioAnalyticsPane(props: Props) {
  const {
    data, loading, periodType, periodOffset, periodRange,
    onPeriodOffsetChange, activeAssetTypeCode,
    baseCurrencyCode, openPositions, onOpenPosition,
  } = props;

  const tab: AssetTabCode = isAssetCode(activeAssetTypeCode) ? activeAssetTypeCode : 'all';
  const ccySym = currencySymbol(baseCurrencyCode);

  // ─── Filter helpers ────────────────────────────────────────────────────────
  const matchesAsset = (code: string) => tab === 'all' || code === tab;

  // ─── Period-wide total return for the active scope ─────────────────────────
  const scopeTotalReturn = useMemo(() => {
    if (!data) return 0;
    return data.totals_by_asset_type
      .filter((t) => matchesAsset(t.asset_type_code))
      .reduce((s, t) => s + t.income_total + t.trade_total + t.adjustment_total, 0);
  }, [data, tab]);

  // ─── Source of return (stacked bar by income kind + capital) ───────────────
  const sourceOfReturn = useMemo(() => {
    if (!data) return [] as { kind: string; label: string; amount: number; color: string }[];

    const byKind = new Map<string, number>();
    for (const item of data.income_feed) {
      if (!matchesAsset(item.asset_type_code)) continue;
      byKind.set(item.income_kind, (byKind.get(item.income_kind) ?? 0) + item.amount_in_base);
    }

    const tradeTotal = data.totals_by_asset_type
      .filter((t) => matchesAsset(t.asset_type_code))
      .reduce((s, t) => s + t.trade_total, 0);
    if (tradeTotal !== 0) {
      byKind.set('capital', tradeTotal);
    }

    const adjustmentTotal = data.totals_by_asset_type
      .filter((t) => matchesAsset(t.asset_type_code))
      .reduce((s, t) => s + t.adjustment_total, 0);
    if (adjustmentTotal !== 0) {
      byKind.set('adjustment', adjustmentTotal);
    }

    const labelFor = (kind: string) => {
      if (kind === 'capital') return 'Прирост капитала';
      if (kind === 'adjustment') return 'Отмены доходов';
      return INCOME_KIND_LABELS[kind] ?? kind;
    };
    const colorFor = (kind: string) => {
      if (kind === 'capital') return '#0A0B0D';
      if (kind === 'adjustment') return '#9AA0A8';
      return INCOME_KIND_COLOR[kind] ?? '#9AA0A8';
    };

    return Array.from(byKind.entries())
      .filter(([, v]) => v !== 0)
      .map(([kind, amount]) => ({ kind, label: labelFor(kind), amount, color: colorFor(kind) }))
      .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
  }, [data, tab]);

  const sourceTotalAbs = useMemo(
    () => sourceOfReturn.reduce((s, x) => s + Math.abs(x.amount), 0),
    [sourceOfReturn],
  );

  // ─── Monthly bars (period-aware, asset-filtered) ───────────────────────────
  const monthlyBars = useMemo(() => {
    if (!data) return [] as {
      period: string;
      label: string;
      monthLabel: string;
      date: Date;
      total: number;
    }[];
    const map = new Map<string, number>();
    const consume = (items: { period: string; asset_type_code: string; total_amount: number }[]) => {
      for (const it of items) {
        if (!matchesAsset(it.asset_type_code)) continue;
        map.set(it.period, (map.get(it.period) ?? 0) + it.total_amount);
      }
    };
    consume(data.monthly_income);
    consume(data.monthly_trades);
    consume(data.monthly_adjustments);
    const entries = Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
    return entries.map(([period, total]) => {
      // Backend returns `period` as `YYYY-MM-01` (date_trunc('month',…)::date).
      const d = new Date(period);
      const monthShort = isNaN(d.getTime())
        ? period
        : d.toLocaleDateString('ru-RU', { month: 'short' }).replace('.', '');
      return {
        period,
        label: monthShort.charAt(0).toUpperCase(),
        monthLabel: monthShort,
        date: d,
        total,
      };
    });
  }, [data, tab]);

  const monthlyMax = useMemo(
    () => Math.max(1, ...monthlyBars.map((b) => Math.abs(b.total))),
    [monthlyBars],
  );

  const [pickedMonth, setPickedMonth] = useState<string | null>(null);
  const pickedBar = useMemo(() => {
    if (!pickedMonth) return monthlyBars[monthlyBars.length - 1] ?? null;
    return monthlyBars.find((b) => b.period === pickedMonth) ?? null;
  }, [pickedMonth, monthlyBars]);

  // ─── Contributors (top winners / losers by income, asset-filtered) ─────────
  const contributors = useMemo(() => {
    if (!data) return [] as { positionId: number; title: string; asset: string; account: string; amount: number }[];
    const byPos = new Map<number, { title: string; asset: string; account: string; amount: number }>();
    for (const item of data.income_feed) {
      if (!matchesAsset(item.asset_type_code)) continue;
      const existing = byPos.get(item.position_id);
      if (existing) {
        existing.amount += item.amount_in_base;
      } else {
        byPos.set(item.position_id, {
          title: item.position_title,
          asset: item.asset_type_code,
          account: item.account_name,
          amount: item.amount_in_base,
        });
      }
    }
    const arr = Array.from(byPos.entries())
      .map(([positionId, v]) => ({ positionId, ...v }))
      .sort((a, b) => b.amount - a.amount);

    const positives = arr.filter((x) => x.amount > 0).slice(0, 3);
    const negatives = arr.filter((x) => x.amount < 0).slice(-2);
    return [...positives, ...negatives];
  }, [data, tab]);

  const contributorMax = useMemo(
    () => Math.max(1, ...contributors.map((c) => Math.abs(c.amount))),
    [contributors],
  );

  // ─── Asset-type donut (Все only) ───────────────────────────────────────────
  const assetDonut = useMemo(() => {
    if (!data) return [] as { code: AssetTabCode; label: string; amount: number; share: number; color: string }[];
    const total = data.totals_by_asset_type.reduce(
      (s, t) => s + Math.max(0, t.income_total + t.trade_total + t.adjustment_total),
      0,
    );
    if (total <= 0) return [];
    return data.totals_by_asset_type
      .map((t) => {
        const amount = t.income_total + t.trade_total + t.adjustment_total;
        const code: AssetTabCode = isAssetCode(t.asset_type_code) ? t.asset_type_code : 'other';
        return {
          code,
          label: ASSET_LABEL[code],
          amount,
          share: amount > 0 ? amount / total : 0,
          color: ASSET_HEX[code],
        };
      })
      .filter((s) => s.amount > 0)
      .sort((a, b) => b.amount - a.amount);
  }, [data]);

  // ─── Deposit progress (Депозиты only) ──────────────────────────────────────
  const deposits = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayMs = today.getTime();

    return openPositions
      .filter((p) => p.asset_type_code === 'deposit')
      .map((p) => {
        const rate = getPositionMetadataNumber(p, 'interest_rate');
        const kind = getPositionMetadataText(p, 'deposit_kind');
        const accrued = getPositionMetadataNumber(p, 'accrued_interest') ?? 0;
        const endDate = getPositionMetadataText(p, 'end_date');
        const opened = new Date(p.opened_at);
        opened.setHours(0, 0, 0, 0);
        const openedMs = opened.getTime();

        let progress = 0;
        let daysToEnd: number | null = null;
        let isOpenEnded = false;
        let endDateLabel: string | null = null;

        if (kind === 'savings_account' || !endDate) {
          isOpenEnded = true;
          progress = 100;
        } else {
          const end = new Date(endDate);
          end.setHours(0, 0, 0, 0);
          const endMs = end.getTime();
          const total = Math.max(1, endMs - openedMs);
          progress = Math.max(0, Math.min(100, ((todayMs - openedMs) / total) * 100));
          daysToEnd = Math.max(0, Math.round((endMs - todayMs) / 86400000));
          endDateLabel = end.toLocaleDateString('ru-RU', { day: '2-digit', month: 'long', year: 'numeric' });
        }

        return {
          id: p.id,
          title: p.title,
          accountName: p.investment_account_name,
          rate,
          principal: p.amount_in_currency,
          accrued,
          progress,
          daysToEnd,
          isOpenEnded,
          endDateLabel,
          openedAt: p.opened_at,
          currency: p.currency_code,
        };
      })
      .sort((a, b) => (b.principal ?? 0) - (a.principal ?? 0));
  }, [openPositions]);

  const depositKpi = useMemo(() => {
    if (deposits.length === 0) return null;
    const totalPrincipal = deposits.reduce((s, d) => s + (d.principal ?? 0), 0);
    const totalAccrued = deposits.reduce((s, d) => s + d.accrued, 0);
    const weightedRate = totalPrincipal > 0
      ? deposits.reduce((s, d) => s + (d.rate ?? 0) * (d.principal ?? 0), 0) / totalPrincipal
      : 0;
    const minDaysToEnd = deposits
      .map((d) => d.daysToEnd)
      .filter((x): x is number => x !== null)
      .reduce((min, x) => x < min ? x : min, Number.POSITIVE_INFINITY);

    return {
      weightedRate,
      totalAccrued,
      daysToNext: Number.isFinite(minDaysToEnd) ? minDaysToEnd : null,
      count: deposits.length,
    };
  }, [deposits]);

  // ─── Trade activity (Бумаги only) ──────────────────────────────────────────
  const tradeActivity = useMemo(() => {
    if (!data || tab !== 'security') return null;
    const sec = data.totals_by_asset_type.find((t) => t.asset_type_code === 'security');
    if (!sec) return null;

    const dividendTotal = data.income_feed
      .filter((i) => i.asset_type_code === 'security' && i.income_kind === 'dividend')
      .reduce((s, x) => s + x.amount_in_base, 0);
    const couponTotal = data.income_feed
      .filter((i) => i.asset_type_code === 'security' && i.income_kind === 'coupon')
      .reduce((s, x) => s + x.amount_in_base, 0);

    const turnover = Math.abs(sec.trade_total);
    return {
      tradeCount: sec.trade_count,
      turnover,
      netFlow: sec.trade_total,
      dividendTotal,
      couponTotal,
      maxPayout: Math.max(1, dividendTotal, couponTotal),
    };
  }, [data, tab]);

  // ─── Render helpers ────────────────────────────────────────────────────────
  const fmtSigned = (n: number) => {
    const abs = formatNumericAmount(Math.abs(n), 0);
    return `${n < 0 ? '−' : '+'}${abs}`;
  };
  const fmt = (n: number) => formatNumericAmount(Math.abs(n), 0);

  const scopeMeta = useMemo(() => {
    if (tab === 'all') {
      const positions = openPositions.length;
      const accounts = new Set(openPositions.map((p) => p.investment_account_id)).size;
      return `${positions} ${pluralRu(positions, ['позиция', 'позиции', 'позиций'])} · ${accounts} ${pluralRu(accounts, ['счёт', 'счёта', 'счетов'])}`;
    }
    const filtered = openPositions.filter((p) => p.asset_type_code === tab);
    const accounts = new Set(filtered.map((p) => p.investment_account_id)).size;
    return `${filtered.length} ${pluralRu(filtered.length, ['позиция', 'позиции', 'позиций'])} · ${accounts} ${pluralRu(accounts, ['счёт', 'счёта', 'счетов'])}`;
  }, [openPositions, tab]);

  if (loading && !data) {
    return <div className="pf-an-stub">Загрузка…</div>;
  }

  if (!data) {
    return <div className="pf-an-stub">Нет данных за выбранный период.</div>;
  }

  const isNegativeScope = scopeTotalReturn < 0;

  return (
    <div className="pf-an">
      {/* ── Scope strip ── */}
      <header className="pf-an-scope">
        <span className={`pf-an-scope__ico pf-an-scope__ico--${ASSET_TINT[tab]}`} aria-hidden="true">
          <ScopeIcon tab={tab} />
        </span>
        <div className="pf-an-scope__meta">
          <span className="pf-an-scope__title">{ASSET_LABEL[tab]}</span>
          <span className="pf-an-scope__sub">{scopeMeta} · {periodRange.label}</span>
        </div>
        {periodRange.offsetAllowed && (
          <div className="pf-an-scope__nav" role="group" aria-label="Период">
            <button
              type="button"
              className="pf-an-scope__arrow"
              onClick={() => onPeriodOffsetChange(periodOffset - 1)}
              aria-label="Предыдущий период"
            >
              {I.chevL()}
            </button>
            <button
              type="button"
              className="pf-an-scope__arrow"
              onClick={() => onPeriodOffsetChange(Math.min(0, periodOffset + 1))}
              disabled={periodOffset >= 0}
              aria-label="Следующий период"
            >
              {I.chevR()}
            </button>
          </div>
        )}
        <span className={`pf-an-scope__pill${isNegativeScope ? ' pf-an-scope__pill--neg' : ' pf-an-scope__pill--pos'}`}>
          {fmtSigned(scopeTotalReturn)} {ccySym}
        </span>
      </header>

      {/* ── M1: Источники дохода ── */}
      {sourceOfReturn.length > 0 && (
        <section className="pf-an-card">
          <header className="pf-an-card__head">
            <span className="pf-an-card__ico pf-an-card__ico--ink">{I.source()}</span>
            <div className="pf-an-card__title-meta">
              <h3 className="pf-an-card__title">Откуда пришёл доход</h3>
              <span className="pf-an-card__sub">
                За {periodRange.label.toLowerCase()} · {sourceOfReturn.length} {pluralRu(sourceOfReturn.length, ['источник', 'источника', 'источников'])}
              </span>
            </div>
            <span className={`pf-an-card__pill${scopeTotalReturn < 0 ? ' pf-an-card__pill--neg' : ' pf-an-card__pill--pos'}`}>
              {fmtSigned(scopeTotalReturn)} {ccySym}
            </span>
          </header>

          <div className="pf-an-src">
            <div className="pf-an-src__bar" role="img" aria-label="Распределение источников дохода">
              {sourceOfReturn.map((s) => (
                <span
                  key={s.kind}
                  className="pf-an-src__seg"
                  style={{ flex: Math.max(Math.abs(s.amount), 1), background: s.color }}
                  title={`${s.label}: ${fmtSigned(s.amount)} ${ccySym}`}
                />
              ))}
            </div>

            <ul className="pf-an-src__legend">
              {sourceOfReturn.map((s) => {
                const share = sourceTotalAbs > 0 ? Math.abs(s.amount) / sourceTotalAbs : 0;
                return (
                  <li key={s.kind}>
                    <span className="pf-an-src__dot" style={{ background: s.color }} />
                    <span className="pf-an-src__name">{s.label}</span>
                    <span className={`pf-an-src__amt${s.amount < 0 ? ' pf-an-src__amt--neg' : ' pf-an-src__amt--pos'}`}>
                      {fmtSigned(s.amount)}<i>{ccySym}</i>
                    </span>
                    <span className="pf-an-src__pct">{(share * 100).toFixed(0)}%</span>
                  </li>
                );
              })}
            </ul>
          </div>
        </section>
      )}

      {/* ── M2: По месяцам ── */}
      {monthlyBars.length > 0 && (
        <section className="pf-an-card">
          <header className="pf-an-card__head">
            <span className="pf-an-card__ico pf-an-card__ico--mint">{I.calendar()}</span>
            <div className="pf-an-card__title-meta">
              <h3 className="pf-an-card__title">По месяцам</h3>
              <span className="pf-an-card__sub">
                {monthlyBars.length} {pluralRu(monthlyBars.length, ['месяц', 'месяца', 'месяцев'])} · нажмите на столбец
              </span>
            </div>
            <div className="pf-an-card__legend-mini">
              <span className="pf-an-legend-dot pf-an-legend-dot--pos" /><i>прибыль</i>
              <span className="pf-an-legend-dot pf-an-legend-dot--neg" /><i>убыток</i>
            </div>
          </header>

          <div className="pf-an-mbar" role="group" aria-label="P&amp;L по месяцам">
            {monthlyBars.map((b) => {
              const heightPct = (Math.abs(b.total) / monthlyMax) * 100;
              const isPos = b.total >= 0;
              const isPicked = pickedBar?.period === b.period;
              return (
                <button
                  key={b.period}
                  type="button"
                  className={`pf-an-mbar__cell${isPicked ? ' pf-an-mbar__cell--on' : ''}`}
                  onClick={() => setPickedMonth(b.period)}
                  title={`${b.monthLabel || b.period}: ${fmtSigned(b.total)} ${ccySym}`}
                >
                  <span
                    className={`pf-an-mbar__bar pf-an-mbar__bar--${isPos ? 'pos' : 'neg'}`}
                    style={{ height: `${Math.max(heightPct, 3)}%` }}
                  />
                  <span className="pf-an-mbar__label">{b.label}</span>
                </button>
              );
            })}
          </div>

          {pickedBar && (
            <div className="pf-an-mbar__pick" aria-live="polite">
              <span className="pf-an-mbar__pick-month">
                {isNaN(pickedBar.date.getTime())
                  ? pickedBar.period
                  : pickedBar.date.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' })}
              </span>
              <span className={`pf-an-mbar__pick-val${pickedBar.total < 0 ? ' pf-an-mbar__pick-val--neg' : ' pf-an-mbar__pick-val--pos'}`}>
                {fmtSigned(pickedBar.total)}<i>{ccySym}</i>
              </span>
              <span className="pf-an-mbar__pick-meta">
                {pickedBar.total >= 0 ? 'прибыль за месяц' : 'убыток за месяц'}
              </span>
            </div>
          )}
        </section>
      )}

      {/* ── M3: Лидеры и аутсайдеры ── */}
      {contributors.length > 0 && tab !== 'deposit' && (
        <section className="pf-an-card">
          <header className="pf-an-card__head">
            <span className="pf-an-card__ico pf-an-card__ico--coral">{I.trophy()}</span>
            <div className="pf-an-card__title-meta">
              <h3 className="pf-an-card__title">Лидеры и аутсайдеры</h3>
              <span className="pf-an-card__sub">Топ-вклад в доход за период</span>
            </div>
          </header>

          <ul className="pf-an-cont">
            {contributors.map((c, index) => {
              const mag = (Math.abs(c.amount) / contributorMax) * 100;
              const isPos = c.amount >= 0;
              const posIdx = isPos ? index + 1 : null;
              return (
                <li key={c.positionId} className={`pf-an-cont__row${isPos ? ' pf-an-cont__row--pos' : ' pf-an-cont__row--neg'}`}>
                  <button
                    type="button"
                    className="pf-an-cont__btn"
                    onClick={() => onOpenPosition?.(c.positionId)}
                  >
                    <span className={`pf-an-cont__rank${posIdx === 1 ? ' pf-an-cont__rank--lead' : ''}`}>
                      {posIdx ?? '−'}
                    </span>
                    <span className="pf-an-cont__bar">
                      <span
                        className={`pf-an-cont__fill pf-an-cont__fill--${isPos ? 'pos' : 'neg'}`}
                        style={{ width: `${mag / 2}%` }}
                      />
                    </span>
                    <span className="pf-an-cont__meta">
                      <span className="pf-an-cont__name">{c.title}</span>
                      <span className="pf-an-cont__sub">{c.account}</span>
                    </span>
                    <span className="pf-an-cont__amt">
                      <strong className={isPos ? 'pf-an-pos' : 'pf-an-neg'}>
                        {fmtSigned(c.amount)}<i>{ccySym}</i>
                      </strong>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* ── M4: Donut «Распределение» — only on "Все" ── */}
      {tab === 'all' && assetDonut.length > 0 && (
        <section className="pf-an-card">
          <header className="pf-an-card__head">
            <span className="pf-an-card__ico pf-an-card__ico--grape">{I.donut()}</span>
            <div className="pf-an-card__title-meta">
              <h3 className="pf-an-card__title">Распределение дохода</h3>
              <span className="pf-an-card__sub">По типам активов за период</span>
            </div>
          </header>

          <div className="pf-an-donut">
            <DonutSvg segments={assetDonut} />
            <div className="pf-an-donut__center">
              {assetDonut[0] && (
                <>
                  <span className="pf-an-donut__eyebrow">{assetDonut[0].label}</span>
                  <strong className="pf-an-donut__value">{(assetDonut[0].share * 100).toFixed(0)}%</strong>
                  <span className="pf-an-donut__sub">главный источник</span>
                </>
              )}
            </div>
          </div>

          <ul className="pf-an-donut__legend">
            {assetDonut.map((s) => (
              <li key={s.code}>
                <span className="pf-an-donut__dot" style={{ background: s.color }} />
                <span className="pf-an-donut__lab">{s.label}</span>
                <em>{(s.share * 100).toFixed(1)}%</em>
                <i>{fmtSigned(s.amount)} {ccySym}</i>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ── M5: Прогресс по вкладам — only Депозиты ── */}
      {tab === 'deposit' && deposits.length > 0 && (
        <section className="pf-an-card">
          <header className="pf-an-card__head">
            <span className="pf-an-card__ico pf-an-card__ico--mint">{I.hourglass()}</span>
            <div className="pf-an-card__title-meta">
              <h3 className="pf-an-card__title">Прогресс по вкладам</h3>
              <span className="pf-an-card__sub">Срок · накоплено · до выплаты</span>
            </div>
          </header>

          <ul className="pf-an-depo">
            {deposits.map((d) => (
              <li key={d.id} className="pf-an-depo__row">
                <button
                  type="button"
                  className="pf-an-depo__btn"
                  onClick={() => onOpenPosition?.(d.id)}
                >
                  <div className="pf-an-depo__top">
                    <span className="pf-an-depo__name">{d.title} · {d.accountName}</span>
                    {d.rate !== null && <span className="pf-an-depo__rate">{d.rate}%</span>}
                  </div>
                  <div className={`pf-an-depo__progress${d.isOpenEnded ? ' pf-an-depo__progress--open' : ''}`}>
                    <span className="pf-an-depo__progress-fill" style={{ width: `${d.progress}%` }} />
                    {!d.isOpenEnded && (
                      <span className="pf-an-depo__progress-tick" style={{ left: `${d.progress}%` }} />
                    )}
                  </div>
                  <div className="pf-an-depo__foot">
                    <span className="pf-an-depo__foot-left">
                      {d.isOpenEnded
                        ? 'До востребования'
                        : d.daysToEnd === 0
                          ? 'Заканчивается сегодня'
                          : `${Math.round(d.progress)}% срока · до ${d.endDateLabel}`}
                    </span>
                    {d.accrued > 0 && (
                      <span className="pf-an-depo__accrued">+{fmt(d.accrued)} {currencySymbol(d.currency)} начислено</span>
                    )}
                  </div>
                </button>
              </li>
            ))}
          </ul>

          {depositKpi && (
            <div className="pf-an-kpi-row">
              <div className="pf-an-kpi">
                <span className="pf-an-kpi__label">Средневзв. ставка</span>
                <strong className="pf-an-kpi__value">{depositKpi.weightedRate.toFixed(1)}<i>%</i></strong>
                <span className="pf-an-kpi__note">по {depositKpi.count} {pluralRu(depositKpi.count, ['вкладу', 'вкладам', 'вкладам'])}</span>
              </div>
              <div className="pf-an-kpi pf-an-kpi--mid">
                <span className="pf-an-kpi__label">Накоплено</span>
                <strong className="pf-an-kpi__value pf-an-pos">+{fmt(depositKpi.totalAccrued)}<i>{ccySym}</i></strong>
                <span className="pf-an-kpi__note">в открытых вкладах</span>
              </div>
              <div className="pf-an-kpi">
                <span className="pf-an-kpi__label">До выплаты</span>
                <strong className="pf-an-kpi__value">
                  {depositKpi.daysToNext !== null ? depositKpi.daysToNext : '—'}
                  {depositKpi.daysToNext !== null && <i>дн</i>}
                </strong>
                <span className="pf-an-kpi__note">ближайший вклад</span>
              </div>
            </div>
          )}
        </section>
      )}

      {/* ── M7: Активность сделок — only Бумаги ── */}
      {tab === 'security' && tradeActivity && (
        <section className="pf-an-card">
          <header className="pf-an-card__head">
            <span className="pf-an-card__ico pf-an-card__ico--ink">{I.trade()}</span>
            <div className="pf-an-card__title-meta">
              <h3 className="pf-an-card__title">Активность · сделки</h3>
              <span className="pf-an-card__sub">За {periodRange.label.toLowerCase()}</span>
            </div>
          </header>

          <div className="pf-an-kpi-row">
            <div className="pf-an-kpi">
              <span className="pf-an-kpi__label">Сделок</span>
              <strong className="pf-an-kpi__value">{tradeActivity.tradeCount}</strong>
              <span className="pf-an-kpi__note">за период</span>
            </div>
            <div className="pf-an-kpi pf-an-kpi--mid">
              <span className="pf-an-kpi__label">Оборот</span>
              <strong className="pf-an-kpi__value">{fmt(tradeActivity.turnover)}<i>{ccySym}</i></strong>
              <span className="pf-an-kpi__note">сумма по сделкам</span>
            </div>
            <div className="pf-an-kpi">
              <span className="pf-an-kpi__label">Нетто</span>
              <strong className={`pf-an-kpi__value${tradeActivity.netFlow >= 0 ? ' pf-an-pos' : ' pf-an-neg'}`}>
                {fmtSigned(tradeActivity.netFlow)}<i>{ccySym}</i>
              </strong>
              <span className="pf-an-kpi__note">{tradeActivity.netFlow >= 0 ? 'прибыль' : 'убыток'}</span>
            </div>
          </div>

          {(tradeActivity.dividendTotal > 0 || tradeActivity.couponTotal > 0) && (
            <div className="pf-an-paystr">
              {tradeActivity.dividendTotal > 0 && (
                <div className="pf-an-paystr__row">
                  <span className="pf-an-paystr__label">Дивиденды</span>
                  <span className="pf-an-paystr__bar">
                    <span style={{ width: `${(tradeActivity.dividendTotal / tradeActivity.maxPayout) * 100}%` }} />
                  </span>
                  <strong className="pf-an-paystr__val pf-an-pos">+{fmt(tradeActivity.dividendTotal)}<i>{ccySym}</i></strong>
                </div>
              )}
              {tradeActivity.couponTotal > 0 && (
                <div className="pf-an-paystr__row">
                  <span className="pf-an-paystr__label">Купоны</span>
                  <span className="pf-an-paystr__bar pf-an-paystr__bar--mint">
                    <span style={{ width: `${(tradeActivity.couponTotal / tradeActivity.maxPayout) * 100}%` }} />
                  </span>
                  <strong className="pf-an-paystr__val pf-an-pos">+{fmt(tradeActivity.couponTotal)}<i>{ccySym}</i></strong>
                </div>
              )}
            </div>
          )}
        </section>
      )}

      {sourceOfReturn.length === 0 && monthlyBars.length === 0 && contributors.length === 0 && deposits.length === 0 && (
        <p className="pf-an-stub">Нет данных по этому типу активов за выбранный период.</p>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Donut SVG (stroke-dasharray segments)
// ──────────────────────────────────────────────────────────────────────────────

function DonutSvg({ segments }: { segments: { code: string; share: number; color: string }[] }) {
  let offset = 0;
  return (
    <svg className="pf-an-donut__svg" viewBox="0 0 100 100" aria-hidden="true">
      <circle cx="50" cy="50" r="42" fill="none" strokeWidth="13" className="pf-an-donut__track" pathLength="100" />
      {segments.map((s) => {
        const len = s.share * 100;
        const seg = (
          <circle
            key={s.code}
            cx="50"
            cy="50"
            r="42"
            fill="none"
            stroke={s.color}
            strokeWidth="13"
            strokeDasharray={`${len} ${100 - len}`}
            strokeDashoffset={-offset}
            pathLength="100"
          />
        );
        offset += len;
        return seg;
      })}
    </svg>
  );
}
