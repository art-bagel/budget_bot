import { useEffect, useMemo, useState } from 'react';

import { createPortfolioPosition } from '../api';
import { useModalOpen } from '../hooks/useModalOpen';
import type { BankAccount, Currency, DashboardBankBalance, UserContext } from '../types';
import { formatAmount } from '../utils/format';
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
  const [quantity, setQuantity] = useState('');
  const [amount, setAmount] = useState('');
  const [currencyCode, setCurrencyCode] = useState(user.base_currency_code);
  const [openedAt, setOpenedAt] = useState(todayIso());
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    && parseFloat(amount) > 0;

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
      await createPortfolioPosition({
        investment_account_id: Number(investmentAccountId),
        asset_type_code: defaultAssetTypeCode,
        title: title.trim(),
        quantity: quantity.trim() ? Number(quantity) : undefined,
        amount_in_currency: Number(amount),
        currency_code: currencyCode,
        opened_at: openedAt || undefined,
        comment: comment.trim() || undefined,
        metadata: defaultAssetTypeCode === 'security' ? { security_kind: securityKind } : undefined,
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
          )}

          <div className="form-row">
            <input
              className="input"
              type="text"
              placeholder="Название позиции"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              disabled={submitting}
              autoFocus
              style={{ flex: '1 1 280px' }}
            />
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
          </div>

          <div className="form-row">
            <input
              className="input"
              type="text"
              inputMode="decimal"
              placeholder="Сумма входа"
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
              value={openedAt}
              onChange={(event) => setOpenedAt(event.target.value)}
              disabled={submitting}
            />
          </div>

          <div className="form-row">
            <div className="input input--read-only" style={{ flex: '1 1 280px' }}>
              Доступно: {formatAmount(selectedCurrencyBalance, currencyCode)}
            </div>
          </div>

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
              {submitting ? 'Сохраняем...' : 'Добавить позицию'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
