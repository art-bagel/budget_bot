import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';

import { createPortfolioPosition } from '../api';
import { useModalOpen } from '../hooks/useModalOpen';
import { useMoexSearch } from '../hooks/useMoexSearch';
import type { BankAccount, Currency, DashboardBankBalance, UserContext } from '../types';
import { formatAmount } from '../utils/format';
import { groupToSecurityKind } from '../utils/moex';
import type { MoexMarket, MoexSecurityInfo } from '../utils/moex';
import { calculateProjectedInterest } from '../utils/depositInterest';
import { sanitizeDecimalInput } from '../utils/validation';


type AccountWithBalances = {
  account: BankAccount;
  balances: DashboardBankBalance[];
};

type Props = {
  accounts: AccountWithBalances[];
  currencies: Currency[];
  user: UserContext;
  defaultAssetTypeCode: string;
  defaultAssetTypeLabel: string;
  onClose: () => void;
  onSuccess: () => void;
  bare?: boolean;
};

const SECURITY_KIND_OPTIONS = [
  { value: 'stock', label: 'Акции' },
  { value: 'bond', label: 'Облигации' },
  { value: 'fund', label: 'Фонды' },
] as const;

const DEPOSIT_KIND_OPTIONS = [
  { value: 'term_deposit', label: 'Вклад' },
  { value: 'savings_account', label: 'Накопительный счёт' },
] as const;

type DepositKind = (typeof DEPOSIT_KIND_OPTIONS)[number]['value'];

const INTEREST_PAYOUT_OPTIONS = [
  { value: 'at_end', label: 'В конце срока' },
  { value: 'monthly_to_account', label: 'Ежемесячно на счёт' },
  { value: 'capitalize', label: 'Капитализация' },
] as const;

type InterestPayout = (typeof INTEREST_PAYOUT_OPTIONS)[number]['value'];

const CAPITALIZATION_PERIOD_OPTIONS = [
  { value: 'daily', label: 'Ежедневно' },
  { value: 'monthly', label: 'Ежемесячно' },
] as const;

type CapitalizationPeriod = (typeof CAPITALIZATION_PERIOD_OPTIONS)[number]['value'];


function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function ApfSelect<T extends string>({
  value,
  options,
  onChange,
  disabled,
}: {
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (v: T) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const selected = options.find((o) => o.value === value);

  return (
    <div className="apf-csel" ref={ref}>
      <button
        type="button"
        className={`apf-csel__btn${open ? ' apf-csel__btn--open' : ''}`}
        onClick={() => !disabled && setOpen((v) => !v)}
        disabled={disabled}
      >
        <span className="apf-csel__label">{selected?.label}</span>
        <ChevronDown size={15} className="apf-csel__chev" strokeWidth={2.2} />
      </button>
      {open && (
        <div className="apf-csel__drop">
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              className={`apf-csel__item${o.value === value ? ' apf-csel__item--on' : ''}`}
              onMouseDown={(e) => { e.preventDefault(); onChange(o.value); setOpen(false); }}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}


export default function PortfolioPositionDialog({
  accounts,
  currencies,
  user,
  defaultAssetTypeCode,
  defaultAssetTypeLabel,
  onClose,
  onSuccess,
  bare = false,
}: Props) {
  useModalOpen();

  const [investmentAccountId, setInvestmentAccountId] = useState(accounts[0] ? String(accounts[0].account.id) : '');
  const [securityKind, setSecurityKind] = useState<(typeof SECURITY_KIND_OPTIONS)[number]['value']>('stock');
  const [title, setTitle] = useState('');
  const [ticker, setTicker] = useState('');
  const [tickerQuery, setTickerQuery] = useState('');
  const [moexMarket, setMoexMarket] = useState<MoexMarket>('shares');
  const [showTickerDropdown, setShowTickerDropdown] = useState(false);
  const tickerInputRef = useRef<HTMLInputElement>(null);
  const [quantity, setQuantity] = useState('');
  const [amount, setAmount] = useState('');
  const [currencyCode, setCurrencyCode] = useState(user.base_currency_code);
  const [openedAt, setOpenedAt] = useState(todayIso());
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Deposit-specific state
  const isDeposit = defaultAssetTypeCode === 'deposit';
  const isSecurity = defaultAssetTypeCode === 'security';
  const [depositKind, setDepositKind] = useState<DepositKind>('term_deposit');
  const [interestRate, setInterestRate] = useState('');
  const [endDate, setEndDate] = useState(todayIso());
  const [interestPayout, setInterestPayout] = useState<InterestPayout>('capitalize');
  const [capitalizationPeriod, setCapitalizationPeriod] = useState<CapitalizationPeriod>('monthly');

  const { results: tickerResults, loading: tickerLoading } = useMoexSearch(isSecurity ? tickerQuery : '');

  const handleSelectTicker = (item: MoexSecurityInfo) => {
    setTicker(item.ticker);
    setTickerQuery(item.ticker);
    setMoexMarket(item.market);
    setSecurityKind(groupToSecurityKind(item.group));
    if (!title.trim()) setTitle(item.shortName);
    setShowTickerDropdown(false);
    tickerInputRef.current?.blur();
  };

  const handleClearTicker = () => {
    setTicker('');
    setTickerQuery('');
    setShowTickerDropdown(false);
  };

  useEffect(() => {
    if (accounts[0] && !accounts.some(({ account }) => String(account.id) === investmentAccountId)) {
      setInvestmentAccountId(String(accounts[0].account.id));
    }
  }, [accounts, investmentAccountId]);

  useEffect(() => {
    if (defaultAssetTypeCode !== 'security') {
      setSecurityKind('stock');
    }
  }, [defaultAssetTypeCode]);

  useEffect(() => {
    if (!currencies.some((currency) => currency.code === currencyCode)) {
      setCurrencyCode(currencies[0]?.code ?? user.base_currency_code);
    }
  }, [currencies, currencyCode, user.base_currency_code]);

  const selectedAccountBalances = useMemo(
    () => accounts.find(({ account }) => String(account.id) === investmentAccountId)?.balances ?? [],
    [accounts, investmentAccountId],
  );

  const selectedCurrencyBalance = useMemo(
    () => selectedAccountBalances.find((balance) => balance.currency_code === currencyCode)?.amount ?? 0,
    [selectedAccountBalances, currencyCode],
  );

  const canSubmit = !submitting
    && !!investmentAccountId
    && !!title.trim()
    && parseFloat(amount) > 0
    && (!isDeposit || parseFloat(interestRate) >= 0)
    && (!(isDeposit && depositKind === 'term_deposit') || !!endDate);

  const handleSubmit = async () => {
    if (!canSubmit) {
      return;
    }

    if (parseFloat(amount) > selectedCurrencyBalance) {
      setError('Недостаточно денег на инвестиционном счете для открытия позиции.');
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      let metadata: Record<string, unknown> | undefined;
      if (isSecurity) {
        metadata = { security_kind: securityKind, ...(ticker ? { ticker, moex_market: moexMarket } : {}) };
      } else if (isDeposit) {
        const showCapPeriod = depositKind === 'savings_account' || interestPayout === 'capitalize';
        metadata = {
          deposit_kind: depositKind,
          interest_rate: Number(interestRate),
          last_accrual_date: openedAt || todayIso(),
          ...(depositKind === 'term_deposit'
            ? {
                end_date: endDate,
                interest_payout: interestPayout,
                ...(interestPayout === 'capitalize' ? { capitalization_period: capitalizationPeriod } : {}),
              }
            : {
                capitalization_period: showCapPeriod ? capitalizationPeriod : 'daily',
              }),
        };
      }

      await createPortfolioPosition({
        investment_account_id: Number(investmentAccountId),
        asset_type_code: defaultAssetTypeCode,
        title: title.trim(),
        quantity: (!isDeposit && quantity.trim()) ? Number(quantity) : undefined,
        amount_in_currency: Number(amount),
        currency_code: currencyCode,
        opened_at: openedAt || undefined,
        comment: comment.trim() || undefined,
        metadata,
      });
      onSuccess();
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSubmitting(false);
    }
  };

  const depositProjection = isDeposit && parseFloat(amount) > 0 && parseFloat(interestRate) > 0
    ? (() => {
        const proj = depositKind === 'term_deposit' && endDate
          ? calculateProjectedInterest({ depositKind, principal: Number(amount), annualRate: Number(interestRate), startDate: openedAt || todayIso(), endDate, interestPayout, capitalizationPeriod })
          : null;
        const total = proj !== null ? Number(amount) + proj : null;
        return proj !== null
          ? `+${formatAmount(proj, currencyCode)} за срок (итого ${formatAmount(total!, currencyCode)})`
          : depositKind === 'savings_account' ? 'Накопительный — бессрочный' : null;
      })()
    : null;

  const formBody = (
    <div className="apf-body">

      {/* Account */}
      <div className="apf-field">
        <label className="apf-label">Счёт</label>
        <ApfSelect
          value={investmentAccountId}
          options={accounts.map(({ account }) => ({
            value: String(account.id),
            label: `${account.name} · ${account.owner_type === 'family' ? 'семейный' : 'личный'}`,
          }))}
          onChange={setInvestmentAccountId}
          disabled={submitting}
        />
      </div>

      {/* Security kind segmented */}
      {isSecurity && (
        <div className="apf-field">
          <label className="apf-label">Тип бумаги</label>
          <div className="apf-segtog">
            {SECURITY_KIND_OPTIONS.map((o) => (
              <button key={o.value} type="button"
                className={`apf-segtog__opt${securityKind === o.value ? ' apf-segtog__opt--on' : ''}`}
                onClick={() => setSecurityKind(o.value)} disabled={submitting}>
                {o.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Deposit kind segmented */}
      {isDeposit && (
        <div className="apf-field">
          <label className="apf-label">Тип</label>
          <div className="apf-segtog">
            {DEPOSIT_KIND_OPTIONS.map((o) => (
              <button key={o.value} type="button"
                className={`apf-segtog__opt${depositKind === o.value ? ' apf-segtog__opt--on' : ''}`}
                onClick={() => setDepositKind(o.value as DepositKind)} disabled={submitting}>
                {o.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Ticker search */}
      {isSecurity && (
        <div className="apf-field">
          <label className="apf-label">Тикер MOEX</label>
          <div style={{ position: 'relative' }}>
            <input ref={tickerInputRef} className="apf-input" type="text"
              placeholder="SBER, GAZP, YNDX…" value={tickerQuery}
              onChange={(e) => { setTickerQuery(e.target.value); setTicker(''); setShowTickerDropdown(true); }}
              onFocus={() => setShowTickerDropdown(true)}
              onBlur={() => setTimeout(() => setShowTickerDropdown(false), 200)}
              disabled={submitting} autoComplete="off" />
            {ticker && (
              <div className="apf-ticker-chosen">
                <span>{ticker}</span>
                <button type="button" className="apf-ticker-clear" onClick={handleClearTicker}>✕</button>
              </div>
            )}
            {showTickerDropdown && (tickerLoading || tickerResults.length > 0) && (
              <div className="ticker-dropdown">
                {tickerLoading && <div className="ticker-dropdown__hint">Поиск…</div>}
                {!tickerLoading && tickerResults.map((item) => (
                  <button key={item.ticker} type="button" className="ticker-dropdown__item"
                    onMouseDown={(e) => { e.preventDefault(); handleSelectTicker(item); }}>
                    <span className="ticker-dropdown__ticker">{item.ticker}</span>
                    <span className="ticker-dropdown__name">{item.shortName}</span>
                    <span className="ticker-dropdown__badge">
                      {item.market === 'bonds' ? 'облиг' : item.group === 'stock_etf' ? 'фонд' : 'акция'}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Title */}
      <div className="apf-field">
        <label className="apf-label">Название</label>
        <input className="apf-input" type="text" autoFocus
          placeholder={isDeposit ? 'Название вклада' : defaultAssetTypeCode === 'other' ? 'Актив или направление' : 'Позиция'}
          value={title} onChange={(e) => setTitle(e.target.value)} disabled={submitting} />
      </div>

      {/* Amount + Currency */}
      <div className="apf-row">
        <div className="apf-field" style={{ flex: 2 }}>
          <label className="apf-label">{isDeposit ? 'Сумма' : 'Сумма входа'}</label>
          <input className="apf-input" type="text" inputMode="decimal"
            placeholder="0" value={amount}
            onChange={(e) => setAmount(sanitizeDecimalInput(e.target.value))} disabled={submitting} />
        </div>
        <div className="apf-field" style={{ flex: 1 }}>
          <label className="apf-label">Валюта</label>
          <ApfSelect
            value={currencyCode}
            options={currencies.map((c) => ({ value: c.code, label: c.code }))}
            onChange={setCurrencyCode}
            disabled={submitting}
          />
        </div>
      </div>

      {/* Quantity + Date (non-deposit) */}
      {!isDeposit && (
        <div className="apf-row">
          <div className="apf-field" style={{ flex: 1 }}>
            <label className="apf-label">Количество</label>
            <input className="apf-input" type="text" inputMode="decimal" placeholder="—"
              value={quantity} onChange={(e) => setQuantity(sanitizeDecimalInput(e.target.value))} disabled={submitting} />
          </div>
          <div className="apf-field" style={{ flex: 1 }}>
            <label className="apf-label">Дата входа</label>
            <input className="apf-input" type="date" value={openedAt}
              onChange={(e) => setOpenedAt(e.target.value)} disabled={submitting} />
          </div>
        </div>
      )}

      {/* Deposit-specific fields */}
      {isDeposit && (
        <>
          <div className="apf-field">
            <label className="apf-label">Ставка, % годовых</label>
            <input className="apf-input" type="text" inputMode="decimal" placeholder="0.0"
              value={interestRate} onChange={(e) => setInterestRate(sanitizeDecimalInput(e.target.value))} disabled={submitting} />
          </div>

          {depositKind === 'term_deposit' && (
            <div className="apf-field">
              <label className="apf-label">Выплата процентов</label>
              <ApfSelect
                value={interestPayout}
                options={INTEREST_PAYOUT_OPTIONS}
                onChange={(v) => setInterestPayout(v as InterestPayout)}
                disabled={submitting}
              />
            </div>
          )}

          {(depositKind === 'savings_account' || interestPayout === 'capitalize') && (
            <div className="apf-field">
              <label className="apf-label">Капитализация</label>
              <ApfSelect
                value={capitalizationPeriod}
                options={CAPITALIZATION_PERIOD_OPTIONS}
                onChange={(v) => setCapitalizationPeriod(v as CapitalizationPeriod)}
                disabled={submitting}
              />
            </div>
          )}

          <div className="apf-row">
            <div className="apf-field" style={{ flex: 1 }}>
              <label className="apf-label">Дата открытия</label>
              <input className="apf-input" type="date" value={openedAt}
                onChange={(e) => setOpenedAt(e.target.value)} disabled={submitting} />
            </div>
            {depositKind === 'term_deposit' && (
              <div className="apf-field" style={{ flex: 1 }}>
                <label className="apf-label">Дата закрытия</label>
                <input className="apf-input" type="date" value={endDate}
                  onChange={(e) => setEndDate(e.target.value)} disabled={submitting} />
              </div>
            )}
          </div>

          {depositProjection && (
            <div className="apf-projection">
              <span className="apf-projection__label">Прогноз дохода</span>
              <span className="apf-projection__value">{depositProjection}</span>
            </div>
          )}
        </>
      )}

      {/* Balance */}
      <div className="apf-balance">
        Доступно: {formatAmount(selectedCurrencyBalance, currencyCode)}
      </div>

      {/* Comment */}
      <div className="apf-field">
        <label className="apf-label">Комментарий</label>
        <input className="apf-input" type="text" placeholder="Необязательно"
          value={comment} onChange={(e) => setComment(e.target.value)} disabled={submitting} />
      </div>

      {error && <div className="apf-error">{error}</div>}
    </div>
  );

  const actions = (
    <div className="apf-actions">
      <button className="apf-cancel" type="button" onClick={onClose} disabled={submitting}>Отмена</button>
      <button className="apf-submit" type="button" onClick={handleSubmit} disabled={!canSubmit}>
        {submitting ? 'Сохраняем…' : isDeposit ? 'Открыть вклад' : 'Добавить позицию'}
      </button>
    </div>
  );

  if (bare) {
    return <>{formBody}{actions}</>;
  }

  return (
    <div className="modal-backdrop" onClick={() => !submitting && onClose()}>
      <div className="modal-card" onClick={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <div className="section__header">
            <div>
              <div className="section__eyebrow">Портфель</div>
              <h2 className="section__title">Новая позиция</h2>
            </div>
          </div>
        </div>
        {formBody}
        {actions}
      </div>
    </div>
  );
}
