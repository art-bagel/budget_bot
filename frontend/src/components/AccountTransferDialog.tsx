import { useState } from 'react';

import { useModalOpen } from '../hooks/useModalOpen';
import { transferBetweenAccounts } from '../api';
import type { DashboardBankBalance } from '../types';
import { formatAmount } from '../utils/format';
import { sanitizeDecimalInput } from '../utils/validation';


interface Props {
  personalAccountId: number;
  familyAccountId: number;
  personalBalances: DashboardBankBalance[];
  familyBalances: DashboardBankBalance[];
  baseCurrencyCode: string;
  onClose: () => void;
  onSuccess: () => void;
}


export default function AccountTransferDialog({
  personalAccountId,
  familyAccountId,
  personalBalances,
  familyBalances,
  baseCurrencyCode,
  onClose,
  onSuccess,
}: Props) {
  useModalOpen();

  // direction: 'personal_to_family' | 'family_to_personal'
  const [direction, setDirection] = useState<'personal_to_family' | 'family_to_personal'>('personal_to_family');
  const [currencyCode, setCurrencyCode] = useState('');
  const [amount, setAmount] = useState('');
  const [comment, setComment] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const fromBalances = direction === 'personal_to_family' ? personalBalances : familyBalances;
  const fromAccountId = direction === 'personal_to_family' ? personalAccountId : familyAccountId;
  const toAccountId = direction === 'personal_to_family' ? familyAccountId : personalAccountId;

  const availableCurrencies = fromBalances.filter((b) => b.amount > 0);
  const selectedBalance = fromBalances.find((b) => b.currency_code === currencyCode);
  const amountValue = parseFloat(amount) || 0;
  const exceedsBalance = !!selectedBalance && amountValue > selectedBalance.amount;

  const validationMessage = !currencyCode
    ? null
    : availableCurrencies.length === 0
      ? 'На исходном счёте нет средств для перевода.'
      : !selectedBalance || selectedBalance.amount <= 0
        ? 'На исходном счёте нет средств в выбранной валюте.'
        : exceedsBalance
          ? `Недостаточно средств: ${formatAmount(selectedBalance.amount, currencyCode)}`
          : null;

  const canSubmit = !submitting && !!currencyCode && amountValue > 0 && !validationMessage;

  const handleDirectionChange = (newDirection: 'personal_to_family' | 'family_to_personal') => {
    setDirection(newDirection);
    setCurrencyCode('');
    setAmount('');
  };

  const handleSubmit = async () => {
    if (!canSubmit) return;

    if (validationMessage) {
      setError(validationMessage);
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      await transferBetweenAccounts({
        from_account_id: fromAccountId,
        to_account_id: toAccountId,
        currency_code: currencyCode,
        amount: amountValue,
        comment: comment.trim() || undefined,
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
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="section__header">
            <div>
              <div className="section__eyebrow">Перевод банка</div>
              <h2 className="section__title">Перевод между счетами</h2>
            </div>
          </div>
        </div>

        <div className="modal-body">
          <div className="operations-note">
            Выбери направление, валюту и сумму.
          </div>

          <div className="form-row">
            <button
              className={`btn${direction === 'personal_to_family' ? ' btn--primary' : ''}`}
              type="button"
              onClick={() => handleDirectionChange('personal_to_family')}
              disabled={submitting}
            >
              Личный → Семейный
            </button>
            <button
              className={`btn${direction === 'family_to_personal' ? ' btn--primary' : ''}`}
              type="button"
              onClick={() => handleDirectionChange('family_to_personal')}
              disabled={submitting}
            >
              Семейный → Личный
            </button>
          </div>

          <div className="form-row">
            <select
              className="input"
              value={currencyCode}
              onChange={(e) => { setCurrencyCode(e.target.value); setAmount(''); }}
              disabled={submitting}
            >
              <option value="">Выбери валюту</option>
              {fromBalances.map((b) => (
                <option key={b.currency_code} value={b.currency_code}>
                  {b.currency_code} · {formatAmount(b.amount, b.currency_code)}
                </option>
              ))}
            </select>
          </div>

          {validationMessage && (
            <p style={{ color: 'var(--tag-out-fg)', fontSize: '0.85rem', marginBottom: 14 }}>
              {validationMessage}
            </p>
          )}

          <div className="form-row">
            <input
              className="input"
              type="text"
              inputMode="decimal"
              placeholder={`Сумма${currencyCode ? ` в ${currencyCode}` : ''}`}
              value={amount}
              onChange={(e) => setAmount(sanitizeDecimalInput(e.target.value))}
              disabled={!currencyCode || submitting}
            />
            {selectedBalance && (
              <button
                className="btn"
                type="button"
                disabled={submitting}
                onClick={() => setAmount(String(selectedBalance.amount))}
              >
                Всё
              </button>
            )}
          </div>

          <div className="form-row">
            <input
              className="input"
              type="text"
              placeholder="Комментарий (необязательно)"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !submitting && handleSubmit()}
              style={{ flex: 1 }}
            />
          </div>

          {error && (
            <p style={{ color: 'var(--tag-out-fg)', fontSize: '0.85rem', marginTop: 4 }}>
              {error}
            </p>
          )}
        </div>

        <div className="modal-actions">
          <button className="btn" type="button" onClick={onClose} disabled={submitting}>
            Отмена
          </button>
          <button
            className="btn btn--primary"
            type="button"
            disabled={!canSubmit}
            onClick={handleSubmit}
          >
            {submitting ? '...' : 'Перевести'}
          </button>
        </div>
      </div>
    </div>
  );
}
