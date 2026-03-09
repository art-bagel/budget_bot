import { useEffect, useState } from 'react';

import { fetchCurrencies, recordExpense } from '../api';
import { useModalOpen } from '../hooks/useModalOpen';
import type { Currency, DashboardBudgetCategory, UserContext } from '../types';
import { formatAmount } from '../utils/format';
import { sanitizeDecimalInput } from '../utils/validation';


interface Props {
  category: DashboardBudgetCategory;
  user: UserContext;
  onClose: () => void;
  onSuccess: () => void;
}


export default function ExpenseDialog({ category, user, onClose, onSuccess }: Props) {
  useModalOpen();
  const [currencies, setCurrencies] = useState<Currency[]>([]);
  const [amount, setAmount] = useState('');
  const [currencyCode, setCurrencyCode] = useState(user.base_currency_code);
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchCurrencies().then(setCurrencies).catch(() => {});
  }, []);

  const canSubmit = !submitting && parseFloat(amount) > 0;

  const handleSubmit = async () => {
    if (!canSubmit) return;

    setSubmitting(true);
    setError(null);

    try {
      await recordExpense({
        bank_account_id: user.bank_account_id,
        category_id: category.category_id,
        amount: parseFloat(amount),
        currency_code: currencyCode,
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
              <div className="section__eyebrow">Расход</div>
              <h2 className="section__title">Записать расход</h2>
            </div>
          </div>
        </div>

        <div className="modal-body">
          <div className="operations-note">
            Списать из <strong>{category.name}</strong> ({formatAmount(category.balance, category.currency_code)}).
          </div>

          <div className="form-row">
            <div className="input input--read-only">Категория: {category.name}</div>
          </div>

          <div className="form-row">
            <input
              className="input"
              type="text"
              inputMode="decimal"
              placeholder="Сумма"
              value={amount}
              onChange={(e) => setAmount(sanitizeDecimalInput(e.target.value))}
              autoFocus
            />
            <select
              className="input"
              value={currencyCode}
              onChange={(e) => setCurrencyCode(e.target.value)}
            >
              {currencies.map((c) => (
                <option key={c.code} value={c.code}>{c.code}</option>
              ))}
            </select>
          </div>

          <div className="form-row">
            <input
              className="input"
              type="text"
              placeholder="Комментарий (необязательно)"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
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
            {submitting ? '...' : 'Списать'}
          </button>
        </div>
      </div>
    </div>
  );
}
