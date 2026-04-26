import { useMemo } from 'react';

import { useModalOpen } from '../hooks/useModalOpen';
import type { DashboardBankBalance } from '../types';
import { currencySymbol, formatNumericAmount } from '../utils/format';
import BottomSheet from './BottomSheet';

interface Props {
  open: boolean;
  accountTitle: string;
  baseCurrencyCode: string;
  balances: DashboardBankBalance[];
  ownerKind: 'personal' | 'family';
  onClose: () => void;
}

const CURRENCY_NAME: Record<string, string> = {
  RUB: 'Рубли',
  USD: 'Доллары',
  EUR: 'Евро',
  GBP: 'Фунты',
  CNY: 'Юани',
  JPY: 'Иены',
  CHF: 'Франки',
  TRY: 'Лиры',
  KZT: 'Тенге',
  UAH: 'Гривны',
  BYN: 'Бел. рубли',
  AMD: 'Драмы',
  GEL: 'Лари',
  AZN: 'Манаты',
  UZS: 'Сумы',
};

function currencyName(code: string): string {
  return CURRENCY_NAME[code] ?? code;
}

function formatBase(value: number): string {
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(value);
}

function pluralCurrency(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return 'валюта';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'валюты';
  return 'валют';
}

export default function AccountDetailSheet({
  open,
  accountTitle,
  baseCurrencyCode,
  balances,
  ownerKind,
  onClose,
}: Props) {
  useModalOpen();

  const sortedBalances = useMemo(() => {
    const positive = balances.filter((b) => b.historical_cost_in_base > 0);
    return [...positive].sort((a, b) => b.historical_cost_in_base - a.historical_cost_in_base);
  }, [balances]);

  const totalInBase = useMemo(
    () => sortedBalances.reduce((sum, b) => sum + b.historical_cost_in_base, 0),
    [sortedBalances],
  );

  const noBalances = sortedBalances.length === 0;
  const tagIconColor = ownerKind === 'family' ? 'o' : 'ink';

  return (
    <BottomSheet
      open={open}
      tag="Счёт"
      title={accountTitle}
      icon={<IconCard />}
      iconColor={tagIconColor}
      onClose={onClose}
      actions={
        <button className="sh-btn sh-btn--ghost" type="button" onClick={onClose}>
          Закрыть
        </button>
      }
    >
      {/* Total balance hero */}
      <div className="sheet-stat">
        <span className="sheet-stat__tag">Баланс</span>
        <div className="sheet-stat__num">
          <span className="sheet-stat__val">{formatBase(totalInBase)}</span>
          <span className="sheet-stat__sym">{currencySymbol(baseCurrencyCode)}</span>
        </div>
        <div className="sheet-stat__meta">
          <span className="ghost-chip">
            {noBalances
              ? 'Пока нет валютных остатков'
              : `${sortedBalances.length} ${pluralCurrency(sortedBalances.length)}`}
          </span>
        </div>
      </div>

      {/* Composition: bar + per-currency rows */}
      {!noBalances && (
        <div className="comp">
          <div className="comp__bar" role="img" aria-label="Состав валют">
            {sortedBalances.map((b, i) => (
              <span
                key={b.currency_code}
                className={`comp__seg comp__seg--c${i % 6}`}
                style={{ flex: Math.max(b.historical_cost_in_base, 1) }}
              />
            ))}
          </div>
          <ul className="comp__list">
            {sortedBalances.map((b, i) => {
              const pct = totalInBase > 0
                ? Math.round((b.historical_cost_in_base / totalInBase) * 100)
                : 0;
              const isBase = b.currency_code === baseCurrencyCode;
              return (
                <li className="comp__row" key={b.currency_code}>
                  <span className={`comp__dot comp__dot--c${i % 6}`} />
                  <span className="comp__name">{currencyName(b.currency_code)}</span>
                  <span className="comp__native">
                    {formatNumericAmount(b.amount)} {currencySymbol(b.currency_code)}
                    {!isBase && (
                      <span className="comp__conv">
                        ≈ {formatBase(b.historical_cost_in_base)} {currencySymbol(baseCurrencyCode)}
                      </span>
                    )}
                  </span>
                  <span className="comp__pct">{pct}%</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </BottomSheet>
  );
}

function IconCard() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3.5" y="6" width="17" height="12" rx="2" />
      <path d="M3.5 10.5h17M7 15h3" />
    </svg>
  );
}
