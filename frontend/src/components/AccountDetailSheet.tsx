import { useEffect, useMemo, useState } from 'react';

import { exchangeCurrency, fetchCurrencies } from '../api';
import { useModalOpen } from '../hooks/useModalOpen';
import { hapticRigid } from '../telegram';
import type { Currency, DashboardBankBalance } from '../types';
import { currencySymbol, formatNumericAmount } from '../utils/format';
import { sanitizeDecimalInput } from '../utils/validation';
import BottomSheet from './BottomSheet';
import { IconArrowRightLeft } from './Icons';

interface Props {
  open: boolean;
  bankAccountId: number;
  accountTitle: string;
  baseCurrencyCode: string;
  balances: DashboardBankBalance[];
  ownerKind: 'personal' | 'family';
  onClose: () => void;
  onSuccess: () => void;
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

function formatRub(value: number): string {
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(value);
}

export default function AccountDetailSheet({
  open,
  bankAccountId,
  accountTitle,
  baseCurrencyCode,
  balances,
  ownerKind,
  onClose,
  onSuccess,
}: Props) {
  useModalOpen();

  const [currencies, setCurrencies] = useState<Currency[]>([]);
  const [fromCode, setFromCode] = useState<string>('');
  const [toCode, setToCode] = useState<string>(baseCurrencyCode);
  const [fromAmount, setFromAmount] = useState('');
  const [toAmount, setToAmount] = useState('');
  const [fromPickerOpen, setFromPickerOpen] = useState(false);
  const [toPickerOpen, setToPickerOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  /* ── derived: composition with proportional segments ─── */

  const sortedBalances = useMemo(() => {
    const positive = balances.filter((b) => b.historical_cost_in_base > 0);
    return [...positive].sort((a, b) => b.historical_cost_in_base - a.historical_cost_in_base);
  }, [balances]);

  const totalInBase = useMemo(
    () => sortedBalances.reduce((sum, b) => sum + b.historical_cost_in_base, 0),
    [sortedBalances],
  );

  const balanceByCode = useMemo(() => {
    const map: Record<string, DashboardBankBalance> = {};
    for (const b of balances) map[b.currency_code] = b;
    return map;
  }, [balances]);

  /* ── currency lists for FX picker ─────────────────────── */

  useEffect(() => {
    if (!open) return;
    if (currencies.length > 0) return;
    void fetchCurrencies()
      .then(setCurrencies)
      .catch(() => setCurrencies([]));
  }, [open, currencies.length]);

  // Default `from` to a non-base currency the account holds (if any),
  // otherwise to the base currency.
  useEffect(() => {
    if (!open) return;
    if (fromCode) return;
    const nonBaseHeld = sortedBalances.find(
      (b) => b.currency_code !== baseCurrencyCode && b.amount > 0,
    );
    setFromCode(nonBaseHeld?.currency_code ?? baseCurrencyCode);
  }, [open, fromCode, sortedBalances, baseCurrencyCode]);

  useEffect(() => {
    if (!open) return;
    if (!fromCode) return;
    if (toCode === fromCode) {
      const next = currencies.find((c) => c.code !== fromCode);
      if (next) setToCode(next.code);
      else if (baseCurrencyCode !== fromCode) setToCode(baseCurrencyCode);
    }
  }, [open, fromCode, toCode, currencies, baseCurrencyCode]);

  // Reset transient state when the sheet closes
  useEffect(() => {
    if (open) return;
    setFromAmount('');
    setToAmount('');
    setSubmitError(null);
    setFromPickerOpen(false);
    setToPickerOpen(false);
  }, [open]);

  /* ── FX helpers ────────────────────────────────────────── */

  const availableFromAmount = balanceByCode[fromCode]?.amount ?? 0;
  const fromVal = parseFloat(fromAmount);
  const toVal = parseFloat(toAmount);

  const rateLine = (() => {
    if (!fromCode || !toCode || fromCode === toCode) return null;
    if (!(fromVal > 0) || !(toVal > 0)) return null;
    const rate = toVal / fromVal;
    return `Курс: 1 ${fromCode} = ${formatNumericAmount(rate, 4)} ${currencySymbol(toCode)}`;
  })();

  const canSubmit =
    !submitting &&
    !!fromCode &&
    !!toCode &&
    fromCode !== toCode &&
    fromVal > 0 &&
    toVal > 0 &&
    fromVal <= availableFromAmount + 1e-9;

  const handleSwap = () => {
    if (!fromCode || !toCode) return;
    setFromCode(toCode);
    setToCode(fromCode);
    setFromAmount(toAmount);
    setToAmount(fromAmount);
    hapticRigid();
  };

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      await exchangeCurrency({
        bank_account_id: bankAccountId,
        from_currency_code: fromCode,
        from_amount: fromVal,
        to_currency_code: toCode,
        to_amount: toVal,
      });
      hapticRigid();
      setFromAmount('');
      setToAmount('');
      onSuccess();
    } catch (reason: unknown) {
      setSubmitError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSubmitting(false);
    }
  };

  /* ── render ────────────────────────────────────────────── */

  const tagIconColor = ownerKind === 'family' ? 'o' : 'ink';
  const noBalances = sortedBalances.length === 0;

  return (
    <BottomSheet
      open={open}
      tag="Счёт"
      title={accountTitle}
      icon={<IconCard />}
      iconColor={tagIconColor}
      onClose={onClose}
      actions={
        <>
          <button className="sh-btn sh-btn--ghost" type="button" onClick={onClose}>
            Закрыть
          </button>
          <button
            className="sh-btn sh-btn--primary"
            type="button"
            onClick={() => void handleSubmit()}
            disabled={!canSubmit}
          >
            {submitting ? '...' : 'Обменять'}
          </button>
        </>
      }
    >
      {/* Total balance hero */}
      <div className="sheet-stat">
        <span className="sheet-stat__tag">Баланс</span>
        <div className="sheet-stat__num">
          <span className="sheet-stat__val">{formatRub(totalInBase)}</span>
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
                        ≈ {formatRub(b.historical_cost_in_base)} {currencySymbol(baseCurrencyCode)}
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

      {/* FX widget */}
      <div className="sub__head sub__head--inline">
        <span className="sub__title">Обменять валюту</span>
      </div>
      <div className="fx">
        <div className="fx__side">
          <span className="fl">Отдаёте</span>
          <div className="fx__row">
            <CurrencyChip
              code={fromCode}
              colorIndex={indexOfCode(sortedBalances, fromCode)}
              open={fromPickerOpen}
              onToggle={() => setFromPickerOpen((v) => !v)}
              onClose={() => setFromPickerOpen(false)}
              onPick={(code) => { setFromCode(code); setFromPickerOpen(false); }}
              currencies={currencies}
              excludeCode={toCode}
            />
            <input
              className="fx__inp"
              type="text"
              inputMode="decimal"
              value={fromAmount}
              onChange={(e) => setFromAmount(sanitizeDecimalInput(e.target.value))}
              placeholder="0"
              aria-label="Сумма отдаёте"
            />
          </div>
          <span className="fx__hint">
            Доступно: {formatNumericAmount(availableFromAmount)} {currencySymbol(fromCode || baseCurrencyCode)}
          </span>
        </div>

        <button
          className="fx__swap"
          type="button"
          onClick={handleSwap}
          aria-label="Поменять местами"
          disabled={!fromCode || !toCode}
        >
          <IconArrowRightLeft />
        </button>

        <div className="fx__side">
          <span className="fl">Получите</span>
          <div className="fx__row">
            <CurrencyChip
              code={toCode}
              colorIndex={indexOfCode(sortedBalances, toCode)}
              open={toPickerOpen}
              onToggle={() => setToPickerOpen((v) => !v)}
              onClose={() => setToPickerOpen(false)}
              onPick={(code) => { setToCode(code); setToPickerOpen(false); }}
              currencies={currencies}
              excludeCode={fromCode}
            />
            <input
              className="fx__inp"
              type="text"
              inputMode="decimal"
              value={toAmount}
              onChange={(e) => setToAmount(sanitizeDecimalInput(e.target.value))}
              placeholder="0"
              aria-label="Сумма получите"
            />
          </div>
          <span className="fx__hint">
            {rateLine ?? 'Введите обе суммы — курс посчитается сам'}
          </span>
        </div>
      </div>

      {submitError && (
        <p className="fx__error">{submitError}</p>
      )}
    </BottomSheet>
  );
}

/* ── helpers ─────────────────────────────────────────────── */

function pluralCurrency(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return 'валюта';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'валюты';
  return 'валют';
}

function indexOfCode(sortedBalances: DashboardBankBalance[], code: string): number {
  const idx = sortedBalances.findIndex((b) => b.currency_code === code);
  return idx >= 0 ? idx % 6 : 0;
}

interface ChipProps {
  code: string;
  colorIndex: number;
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
  onPick: (code: string) => void;
  currencies: Currency[];
  excludeCode: string;
}

function CurrencyChip({
  code,
  colorIndex,
  open,
  onToggle,
  onClose,
  onPick,
  currencies,
  excludeCode,
}: ChipProps) {
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('.fx__cur-wrap')) onClose();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open, onClose]);

  return (
    <div className="fx__cur-wrap">
      <button className="fx__cur" type="button" onClick={onToggle}>
        <span className={`comp__dot comp__dot--c${colorIndex}`} />
        {code || '—'}
        <svg className="fx__chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {open && (
        <div className="fx__cur-drop">
          {currencies
            .filter((c) => c.code !== excludeCode)
            .map((c) => (
              <button
                key={c.code}
                type="button"
                className={`fx__cur-opt${c.code === code ? ' fx__cur-opt--on' : ''}`}
                onClick={() => onPick(c.code)}
              >
                <span className="fx__cur-opt-code">{c.code}</span>
                <span className="fx__cur-opt-name">{currencyName(c.code)}</span>
              </button>
            ))}
        </div>
      )}
    </div>
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
