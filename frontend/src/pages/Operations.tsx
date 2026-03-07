import { useEffect, useState } from 'react';
import { fetchCurrencies, recordIncome } from '../api';
import type { UserContext, Currency, RecordIncomeResponse } from '../types';

interface IncomeEntry {
  operation_id: number;
  amount: number;
  currency_code: string;
  budget_amount_in_base: number;
  base_currency_code: string;
  comment: string;
}

export default function Operations({ user }: { user: UserContext }) {
  const [currencies, setCurrencies] = useState<Currency[]>([]);
  const [loadingCurrencies, setLoadingCurrencies] = useState(true);

  const [amount, setAmount] = useState('');
  const [currencyCode, setCurrencyCode] = useState(user.base_currency_code);
  const [budgetAmountInBase, setBudgetAmountInBase] = useState('');
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [incomes, setIncomes] = useState<IncomeEntry[]>([]);

  useEffect(() => {
    fetchCurrencies()
      .then(setCurrencies)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoadingCurrencies(false));
  }, []);

  const isNonBase = currencyCode !== user.base_currency_code;

  const handleSubmit = async () => {
    const parsedAmount = parseFloat(amount);
    if (!parsedAmount || parsedAmount <= 0) return;
    if (isNonBase && (!budgetAmountInBase || parseFloat(budgetAmountInBase) <= 0)) return;

    setSubmitting(true);
    setError(null);

    try {
      const result: RecordIncomeResponse = await recordIncome({
        bank_account_id: user.bank_account_id,
        amount: parsedAmount,
        currency_code: currencyCode,
        budget_amount_in_base: isNonBase ? parseFloat(budgetAmountInBase) : undefined,
        comment: comment.trim() || undefined,
      });

      setIncomes((prev) => [
        {
          operation_id: result.operation_id,
          amount: parsedAmount,
          currency_code: currencyCode,
          budget_amount_in_base: result.budget_amount_in_base,
          base_currency_code: result.base_currency_code,
          comment: comment.trim(),
        },
        ...prev,
      ]);

      setAmount('');
      setBudgetAmountInBase('');
      setComment('');
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSubmitting(false);
    }
  };

  const canSubmit =
    !submitting &&
    parseFloat(amount) > 0 &&
    (!isNonBase || parseFloat(budgetAmountInBase) > 0);

  if (loadingCurrencies) {
    return (
      <div className="status-screen">
        <h1>Загрузка...</h1>
      </div>
    );
  }

  return (
    <>
      <h1 className="page-title">Операции</h1>

      <section className="section">
        <div className="section__header">
          <h2 className="section__title">Записать доход</h2>
        </div>
        <div className="panel">
          <div className="form-row">
            <input
              className="input"
              type="text"
              inputMode="decimal"
              placeholder="Сумма"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              min="0"
              step="0.01"
            />
            <select
              className="input"
              value={currencyCode}
              onChange={(e) => setCurrencyCode(e.target.value)}
            >
              {currencies.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.code}
                </option>
              ))}
            </select>
          </div>

          {isNonBase && (
            <div className="form-row">
              <input
                className="input"
                type="number"
                inputMode="decimal"
                placeholder={`Стоимость в ${user.base_currency_code}`}
                value={budgetAmountInBase}
                onChange={(e) => setBudgetAmountInBase(e.target.value)}
                min="0"
                step="0.01"
                style={{ flex: 1 }}
              />
            </div>
          )}

          <div className="form-row">
            <input
              className="input"
              type="text"
              placeholder="Комментарий (необязательно)"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && canSubmit && handleSubmit()}
              style={{ flex: 1 }}
            />
            <button
              className="btn btn--primary"
              type="button"
              disabled={!canSubmit}
              onClick={handleSubmit}
            >
              {submitting ? '...' : 'Записать'}
            </button>
          </div>

          {error && (
            <p style={{ color: 'var(--tag-out-fg)', fontSize: '0.85rem', marginTop: 8 }}>
              {error}
            </p>
          )}
        </div>
      </section>

      {incomes.length > 0 && (
        <section className="section">
          <div className="section__header">
            <h2 className="section__title">Записанные доходы</h2>
          </div>
          <div className="panel">
            <ul>
              {incomes.map((inc) => (
                <li className="list-row" key={inc.operation_id}>
                  <div>
                    <div className="list-row__title">
                      +{inc.amount} {inc.currency_code}
                    </div>
                    <div className="list-row__sub">
                      {inc.comment || `Операция #${inc.operation_id}`}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <span className="tag tag--in">
                      {inc.budget_amount_in_base} {inc.base_currency_code}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}
    </>
  );
}
