import { useEffect, useMemo, useState } from 'react';

import { exchangeCurrency, fetchCurrencies } from '../api';
import { useModalOpen } from '../hooks/useModalOpen';
import { hapticRigid } from '../telegram';
import type { Currency, DashboardBankBalance } from '../types';
import { currencySymbol, formatNumericAmount } from '../utils/format';
import { sanitizeDecimalInput } from '../utils/validation';
import BottomSheet from './BottomSheet';
import { IconArrowRightLeft } from './Icons';

type AccountKind = 'personal' | 'family';

interface Props {
  open: boolean;
  hasFamily: boolean;
  personalAccountId: number;
  familyAccountId: number | null;
  baseCurrencyCode: string;
  personalBalances: DashboardBankBalance[];
  familyBalances: DashboardBankBalance[];
  initialAccount?: AccountKind;
  onClose: () => void;
  onSuccess: () => void;
}

const CURRENCY_NAME: Record<string, string> = {
  RUB: 'Рубли', USD: 'Доллары', EUR: 'Евро', GBP: 'Фунты',
  CNY: 'Юани', JPY: 'Иены', CHF: 'Франки', TRY: 'Лиры',
  KZT: 'Тенге', UAH: 'Гривны', BYN: 'Бел. рубли', AMD: 'Драмы',
  GEL: 'Лари', AZN: 'Манаты', UZS: 'Сумы',
};

function currencyName(code: string): string {
  return CURRENCY_NAME[code] ?? code;
}

export default function ExchangeSheet({
  open,
  hasFamily,
  personalAccountId,
  familyAccountId,
  baseCurrencyCode,
  personalBalances,
  familyBalances,
  initialAccount = 'personal',
  onClose,
  onSuccess,
}: Props) {
  useModalOpen();

  const [account, setAccount] = useState<AccountKind>(initialAccount);
  const [currencies, setCurrencies] = useState<Currency[]>([]);
  const [fromCode, setFromCode] = useState('');
  const [toCode, setToCode] = useState(baseCurrencyCode);
  const [fromAmount, setFromAmount] = useState('');
  const [toAmount, setToAmount] = useState('');
  const [fromPickerOpen, setFromPickerOpen] = useState(false);
  const [toPickerOpen, setToPickerOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  /* ── derived: balances and account context ─────────── */

  const balances = account === 'family' ? familyBalances : personalBalances;
  const bankAccountId = account === 'family' && familyAccountId !== null
    ? familyAccountId
    : personalAccountId;

  const balanceByCode = useMemo(() => {
    const map: Record<string, DashboardBankBalance> = {};
    for (const b of balances) map[b.currency_code] = b;
    return map;
  }, [balances]);

  const sortedHeld = useMemo(() => {
    return [...balances]
      .filter((b) => b.amount > 0)
      .sort((a, b) => b.historical_cost_in_base - a.historical_cost_in_base);
  }, [balances]);

  /* ── load currencies once when opened ──────────────── */

  useEffect(() => {
    if (!open) return;
    if (currencies.length > 0) return;
    void fetchCurrencies()
      .then(setCurrencies)
      .catch(() => setCurrencies([]));
  }, [open, currencies.length]);

  /* ── default `from` to a held non-base currency ────── */

  useEffect(() => {
    if (!open) return;
    const nonBaseHeld = sortedHeld.find((b) => b.currency_code !== baseCurrencyCode);
    const candidate = nonBaseHeld?.currency_code ?? sortedHeld[0]?.currency_code ?? baseCurrencyCode;
    setFromCode(candidate);
  }, [open, account, sortedHeld, baseCurrencyCode]);

  useEffect(() => {
    if (!fromCode) return;
    if (toCode === fromCode) {
      const next = currencies.find((c) => c.code !== fromCode);
      setToCode(next?.code ?? (baseCurrencyCode !== fromCode ? baseCurrencyCode : ''));
    }
  }, [fromCode, toCode, currencies, baseCurrencyCode]);

  /* ── reset transient state on close ────────────────── */

  useEffect(() => {
    if (open) return;
    setFromAmount('');
    setToAmount('');
    setSubmitError(null);
    setFromPickerOpen(false);
    setToPickerOpen(false);
  }, [open]);

  /* ── derived helpers ───────────────────────────────── */

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

  const colorIndexOf = (code: string): number => {
    const idx = sortedHeld.findIndex((b) => b.currency_code === code);
    return idx >= 0 ? idx % 6 : 0;
  };

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

  return (
    <BottomSheet
      open={open}
      tag="Обмен валют"
      title={account === 'family' ? 'На семейном счёте' : 'На личном счёте'}
      icon={<IconArrowRightLeft />}
      iconColor={account === 'family' ? 'o' : 'ink'}
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
      {hasFamily && (
        <div className="viewtog viewtog--inline viewtog--inline-soft" role="tablist" aria-label="Счёт">
          <button
            type="button"
            role="tab"
            aria-selected={account === 'personal'}
            className={`viewtog__opt${account === 'personal' ? ' viewtog__opt--on' : ''}`}
            onClick={() => setAccount('personal')}
          >
            Личный
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={account === 'family'}
            className={`viewtog__opt${account === 'family' ? ' viewtog__opt--on' : ''}`}
            onClick={() => setAccount('family')}
          >
            Семейный
          </button>
        </div>
      )}

      <div className="fx">
        <div className="fx__side">
          <span className="fl">Отдаёте</span>
          <div className="fx__row">
            <CurrencyChip
              code={fromCode}
              colorIndex={colorIndexOf(fromCode)}
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
              colorIndex={colorIndexOf(toCode)}
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

      {submitError && <p className="fx__error">{submitError}</p>}
    </BottomSheet>
  );
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
