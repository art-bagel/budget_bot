import { useEffect, useMemo, useRef, useState } from 'react';

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


export default function PortfolioPositionDialog({
  accounts,
  currencies,
  user,
  defaultAssetTypeCode,
  defaultAssetTypeLabel,
  onClose,
  onSuccess,
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
  const [depositKind, setDepositKind] = useState<DepositKind>('term_deposit');
  const [interestRate, setInterestRate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [interestPayout, setInterestPayout] = useState<InterestPayout>('capitalize');
  const [capitalizationPeriod, setCapitalizationPeriod] = useState<CapitalizationPeriod>('monthly');

  const { results: tickerResults, loading: tickerLoading } = useMoexSearch(
    defaultAssetTypeCode === 'security' ? tickerQuery : '',
  );

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
      if (defaultAssetTypeCode === 'security') {
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

        <div className="modal-body">
          <div className="operations-note">
            Новая позиция будет добавлена в раздел <strong>{defaultAssetTypeLabel}</strong>.
          </div>

          <div className="form-row">
            <select
              className="input"
              value={investmentAccountId}
              onChange={(event) => setInvestmentAccountId(event.target.value)}
              disabled={submitting}
            >
              {accounts.map(({ account }) => (
                <option key={account.id} value={account.id}>
                  {account.name} · {account.owner_type === 'family' ? 'семейный' : 'личный'}
                </option>
              ))}
            </select>
            <div className="input input--read-only">{defaultAssetTypeLabel}</div>
          </div>

          {defaultAssetTypeCode === 'security' && (
            <>
              <div className="form-row">
                <select
                  className="input"
                  value={securityKind}
                  onChange={(event) => setSecurityKind(event.target.value as (typeof SECURITY_KIND_OPTIONS)[number]['value'])}
                  disabled={submitting}
                >
                  {SECURITY_KIND_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-row" style={{ position: 'relative' }}>
                <div style={{ position: 'relative', flex: '1 1 200px' }}>
                  <input
                    ref={tickerInputRef}
                    className="input"
                    type="text"
                    placeholder="Тикер MOEX (SBER, GAZP…)"
                    value={tickerQuery}
                    onChange={(e) => {
                      setTickerQuery(e.target.value);
                      setTicker('');
                      setShowTickerDropdown(true);
                    }}
                    onFocus={() => setShowTickerDropdown(true)}
                    onBlur={() => setTimeout(() => setShowTickerDropdown(false), 200)}
                    disabled={submitting}
                    autoComplete="off"
                  />
                  {showTickerDropdown && (tickerLoading || tickerResults.length > 0) && (
                    <div className="ticker-dropdown">
                      {tickerLoading && (
                        <div className="ticker-dropdown__hint">Поиск...</div>
                      )}
                      {!tickerLoading && tickerResults.map((item) => (
                        <button
                          key={item.ticker}
                          type="button"
                          className="ticker-dropdown__item"
                          onMouseDown={(e) => { e.preventDefault(); handleSelectTicker(item); }}
                        >
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
                {ticker && (
                  <span className="tag tag--in" style={{ alignSelf: 'center' }}>
                    {ticker}
                  </span>
                )}
                {ticker && (
                  <button
                    type="button"
                    className="btn"
                    onClick={handleClearTicker}
                    disabled={submitting}
                    style={{ alignSelf: 'center' }}
                  >
                    ✕
                  </button>
                )}
              </div>
            </>
          )}

          {isDeposit && (
            <>
              <div className="form-row">
                <select
                  className="input"
                  value={depositKind}
                  onChange={(event) => setDepositKind(event.target.value as DepositKind)}
                  disabled={submitting}
                >
                  {DEPOSIT_KIND_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
            </>
          )}

          <div className="form-row">
            <input
              className="input"
              type="text"
              placeholder={isDeposit ? 'Название вклада' : 'Название позиции'}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              disabled={submitting}
              autoFocus
              style={{ flex: '1 1 280px' }}
            />
            {!isDeposit && (
              <input
                className="input"
                type="text"
                inputMode="decimal"
                placeholder="Количество, если есть"
                value={quantity}
                onChange={(event) => setQuantity(sanitizeDecimalInput(event.target.value))}
                disabled={submitting}
                style={{ width: 180 }}
              />
            )}
          </div>

          {isDeposit && (
            <>
              <div className="form-row">
                <input
                  className="input"
                  type="text"
                  inputMode="decimal"
                  placeholder="Процентная ставка, % годовых"
                  value={interestRate}
                  onChange={(event) => setInterestRate(sanitizeDecimalInput(event.target.value))}
                  disabled={submitting}
                  style={{ flex: '1 1 200px' }}
                />
              </div>

              {depositKind === 'term_deposit' && (
                <div className="form-row">
                  <select
                    className="input"
                    value={interestPayout}
                    onChange={(event) => setInterestPayout(event.target.value as InterestPayout)}
                    disabled={submitting}
                  >
                    {INTEREST_PAYOUT_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {(depositKind === 'savings_account' || interestPayout === 'capitalize') && (
                <div className="form-row">
                  <select
                    className="input"
                    value={capitalizationPeriod}
                    onChange={(event) => setCapitalizationPeriod(event.target.value as CapitalizationPeriod)}
                    disabled={submitting}
                  >
                    {CAPITALIZATION_PERIOD_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        Капитализация: {option.label.toLowerCase()}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </>
          )}

          <div className="form-row">
            <input
              className="input"
              type="text"
              inputMode="decimal"
              placeholder={isDeposit ? 'Сумма вклада' : 'Сумма входа'}
              value={amount}
              onChange={(event) => setAmount(sanitizeDecimalInput(event.target.value))}
              disabled={submitting}
              style={{ width: 180 }}
            />
            <select
              className="input"
              value={currencyCode}
              onChange={(event) => setCurrencyCode(event.target.value)}
              disabled={submitting}
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
              title={isDeposit ? 'Дата открытия' : 'Дата входа'}
              value={openedAt}
              onChange={(event) => setOpenedAt(event.target.value)}
              disabled={submitting}
            />
          </div>

          {isDeposit && depositKind === 'term_deposit' && (
            <div className="form-row">
              <input
                className="input"
                type="date"
                title="Дата окончания вклада"
                placeholder="Дата окончания"
                value={endDate}
                onChange={(event) => setEndDate(event.target.value)}
                disabled={submitting}
                style={{ flex: '1 1 200px' }}
              />
              <div className="input input--read-only" style={{ flex: '0 0 auto' }}>
                Дата окончания
              </div>
            </div>
          )}

          <div className="form-row">
            <div className="input input--read-only" style={{ flex: '1 1 280px' }}>
              Доступно: {formatAmount(selectedCurrencyBalance, currencyCode)}
            </div>
          </div>

          {isDeposit && parseFloat(amount) > 0 && parseFloat(interestRate) > 0 && (
            (() => {
              const projectedEnd = depositKind === 'term_deposit' && endDate
                ? calculateProjectedInterest({
                    depositKind,
                    principal: Number(amount),
                    annualRate: Number(interestRate),
                    startDate: openedAt || todayIso(),
                    endDate,
                    interestPayout,
                    capitalizationPeriod,
                  })
                : null;
              const totalAtEnd = projectedEnd !== null ? Number(amount) + projectedEnd : null;
              return (
                <div className="form-row">
                  <div className="input input--read-only" style={{ flex: '1 1 280px', color: 'var(--tag-in-fg)' }}>
                    {projectedEnd !== null
                      ? `Доход за весь срок: +${formatAmount(projectedEnd, currencyCode)} (итого ${formatAmount(totalAtEnd!, currencyCode)})`
                      : depositKind === 'savings_account'
                        ? 'Накопительный счёт — бессрочный'
                        : 'Укажите дату окончания для расчёта'}
                  </div>
                </div>
              );
            })()
          )}

          <div className="form-row">
            <input
              className="input"
              type="text"
              placeholder="Комментарий"
              value={comment}
              onChange={(event) => setComment(event.target.value)}
              disabled={submitting}
              style={{ flex: '1 1 320px' }}
            />
          </div>

          {error && (
            <p style={{ color: 'var(--tag-out-fg)', fontSize: '0.85rem', marginTop: 4 }}>
              {error}
            </p>
          )}
        </div>

        <div className="modal-actions">
          <div className="action-pill">
            <button className="action-pill__cancel" type="button" onClick={onClose} disabled={submitting}>
              Отмена
            </button>
            <button className="action-pill__confirm" type="button" onClick={handleSubmit} disabled={!canSubmit}>
              {submitting ? 'Сохраняем...' : isDeposit ? 'Открыть вклад' : 'Добавить позицию'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
