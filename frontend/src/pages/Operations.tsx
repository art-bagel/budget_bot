import { useEffect, useState } from 'react';
import { createIncomeSource, fetchCurrencies, fetchIncomeSources, recordIncome } from '../api';
import type { UserContext, Currency, IncomeSource, RecordIncomeResponse } from '../types';

interface IncomeEntry {
  operation_id: number;
  income_source_name: string;
  amount: number;
  currency_code: string;
  budget_amount_in_base: number;
  base_currency_code: string;
  comment: string;
}

export default function Operations({ user }: { user: UserContext }) {
  const [currencies, setCurrencies] = useState<Currency[]>([]);
  const [incomeSources, setIncomeSources] = useState<IncomeSource[]>([]);
  const [loading, setLoading] = useState(true);

  const [amount, setAmount] = useState('');
  const [currencyCode, setCurrencyCode] = useState(user.base_currency_code);
  const [incomeSourceId, setIncomeSourceId] = useState('');
  const [newIncomeSourceName, setNewIncomeSourceName] = useState('');
  const [budgetAmountInBase, setBudgetAmountInBase] = useState('');
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [creatingIncomeSource, setCreatingIncomeSource] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [incomes, setIncomes] = useState<IncomeEntry[]>([]);

  useEffect(() => {
    Promise.all([fetchCurrencies(), fetchIncomeSources()])
      .then(([loadedCurrencies, loadedIncomeSources]) => {
        setCurrencies(loadedCurrencies);
        setIncomeSources(loadedIncomeSources);
        if (loadedIncomeSources.length > 0) {
          setIncomeSourceId(String(loadedIncomeSources[0].id));
        }
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const isNonBase = currencyCode !== user.base_currency_code;
  const selectedIncomeSource = incomeSources.find((item) => String(item.id) === incomeSourceId);

  const handleCreateIncomeSource = async () => {
    const normalizedName = newIncomeSourceName.trim();
    if (!normalizedName) return;

    setCreatingIncomeSource(true);
    setError(null);

    try {
      const result = await createIncomeSource(normalizedName);
      const createdSource: IncomeSource = {
        id: result.id,
        name: normalizedName,
        is_active: true,
        created_at: new Date().toISOString(),
      };

      setIncomeSources((prev) => [...prev, createdSource]);
      setIncomeSourceId(String(createdSource.id));
      setNewIncomeSourceName('');
    } catch (e: any) {
      setError(e.message);
    } finally {
      setCreatingIncomeSource(false);
    }
  };

  const handleSubmit = async () => {
    const parsedAmount = parseFloat(amount);
    if (!parsedAmount || parsedAmount <= 0) return;
    if (isNonBase && (!budgetAmountInBase || parseFloat(budgetAmountInBase) <= 0)) return;
    if (!selectedIncomeSource) return;

    setSubmitting(true);
    setError(null);

    try {
      const result: RecordIncomeResponse = await recordIncome({
        bank_account_id: user.bank_account_id,
        income_source_id: selectedIncomeSource.id,
        amount: parsedAmount,
        currency_code: currencyCode,
        budget_amount_in_base: isNonBase ? parseFloat(budgetAmountInBase) : undefined,
        comment: comment.trim() || undefined,
      });

      setIncomes((prev) => [
        {
          operation_id: result.operation_id,
          income_source_name: selectedIncomeSource.name,
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
    !!selectedIncomeSource &&
    parseFloat(amount) > 0 &&
    (!isNonBase || parseFloat(budgetAmountInBase) > 0);

  if (loading) {
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
          <div className="operations-note">
            Доход записывается как: источник дохода {'->'} банк {'->'} нераспределенный бюджет.
          </div>

          <div className="form-row">
            <select
              className="input"
              value={incomeSourceId}
              onChange={(e) => setIncomeSourceId(e.target.value)}
              disabled={incomeSources.length === 0}
            >
              {incomeSources.length === 0 ? (
                <option value="">Сначала создайте источник дохода</option>
              ) : (
                incomeSources.map((source) => (
                  <option key={source.id} value={source.id}>
                    {source.name}
                  </option>
                ))
              )}
            </select>
            <div className="input input--read-only">
              Счет: Main #{user.bank_account_id}
            </div>
          </div>

          <div className="form-row">
            <input
              className="input"
              type="text"
              placeholder="Новый источник дохода"
              value={newIncomeSourceName}
              onChange={(e) => setNewIncomeSourceName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleCreateIncomeSource()}
            />
            <button
              className="btn btn--secondary"
              type="button"
              disabled={creatingIncomeSource || newIncomeSourceName.trim().length === 0}
              onClick={handleCreateIncomeSource}
            >
              {creatingIncomeSource ? '...' : 'Добавить источник'}
            </button>
          </div>

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
                type="text"
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

          {incomeSources.length === 0 && !error && (
            <p className="operations-hint">
              Без источника дохода форма записи не активируется.
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
                      {inc.comment || `Операция #${inc.operation_id}`} · {inc.income_source_name}
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
