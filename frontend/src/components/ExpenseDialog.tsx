import { useEffect, useState } from 'react';

import { fetchBankAccounts, fetchCurrencies, recordExpense } from '../api';
import { useModalOpen } from '../hooks/useModalOpen';
import type { BankAccount, Currency, DashboardBudgetCategory, UserContext } from '../types';
import { formatAmount } from '../utils/format';
import { categoryDisplayName } from '../utils/categoryIcon';
import { sanitizeDecimalInput } from '../utils/validation';


interface Props {
  category: DashboardBudgetCategory;
  user: UserContext;
  familyBankAccountId?: number | null;
  onClose: () => void;
  onSuccess: () => void;
}


export default function ExpenseDialog({ category, user, familyBankAccountId = null, onClose, onSuccess }: Props) {
  useModalOpen();
  const [currencies, setCurrencies] = useState<Currency[]>([]);
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [amount, setAmount] = useState('');
  const [currencyCode, setCurrencyCode] = useState(user.base_currency_code);
  const [comment, setComment] = useState('');
  const [selectedAccountId, setSelectedAccountId] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const defaultCashAccountId = category.owner_type === 'family'
    ? familyBankAccountId
    : user.bank_account_id;

  useEffect(() => {
    setSelectedAccountId(defaultCashAccountId);
  }, [defaultCashAccountId]);

  useEffect(() => {
    Promise.all([
      fetchCurrencies(),
      fetchBankAccounts('cash'),
      fetchBankAccounts('credit'),
    ]).then(([loadedCurrencies, cashAccounts, creditAccounts]) => {
      setCurrencies(loadedCurrencies);
      const creditCardAccounts = creditAccounts.filter((a) => a.credit_kind === 'credit_card');
      const ownerAccounts = [...cashAccounts, ...creditCardAccounts].filter((a) =>
        category.owner_type === 'family'
          ? a.owner_type === 'family'
          : a.owner_type === 'user',
      );
      setBankAccounts(ownerAccounts);
    }).catch(() => {});
  }, [category.owner_type]);

  const canSubmit = !submitting && parseFloat(amount) > 0 && selectedAccountId !== null;

  const handleSubmit = async () => {
    if (!canSubmit) return;

    setSubmitting(true);
    setError(null);

    try {
      await recordExpense({
        bank_account_id: selectedAccountId,
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
            Списать из <strong>{categoryDisplayName(category.name)}</strong> ({formatAmount(category.balance, category.currency_code)}).
          </div>

          <div className="form-row">
            <div className="input input--read-only">Категория: {categoryDisplayName(category.name)}</div>
          </div>

          <div className="form-row">
            <select
              className="input"
              value={selectedAccountId ?? ''}
              onChange={(e) => setSelectedAccountId(Number(e.target.value))}
              disabled={submitting}
              style={{ flex: 1 }}
            >
              {bankAccounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}{a.account_kind === 'credit' ? ' · Кредитная карта' : ''}
                </option>
              ))}
              {bankAccounts.length === 0 && (
                <option value="">Счёт не найден</option>
              )}
            </select>
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

          {selectedAccountId === null && (
            <p style={{ color: 'var(--tag-out-fg)', fontSize: '0.85rem', marginTop: 4 }}>
              Для этой категории не найден подходящий счет.
            </p>
          )}
        </div>

        <div className="modal-actions">
          <div className="action-pill">
            <button className="action-pill__cancel" type="button" onClick={onClose} disabled={submitting}>
              Отмена
            </button>
            <button className="action-pill__confirm" type="button" disabled={!canSubmit} onClick={handleSubmit}>
              {submitting ? '...' : 'Списать'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
