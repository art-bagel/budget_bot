import { useEffect, useState } from 'react';

import {
  createIncomeSource,
  fetchCurrencies,
  fetchIncomeSources,
  recordIncome,
} from '../api';
import { useModalOpen } from '../hooks/useModalOpen';
import type { Currency, IncomeSource, RecordIncomeRequest, UserContext } from '../types';
import { sanitizeDecimalInput } from '../utils/validation';


interface Props {
  user: UserContext;
  onClose: () => void;
  onSuccess: () => void;
}


export default function IncomeDialog({ user, onClose, onSuccess }: Props) {
  useModalOpen();
  const [currencies, setCurrencies] = useState<Currency[]>([]);
  const [incomeSources, setIncomeSources] = useState<IncomeSource[]>([]);
  const [loading, setLoading] = useState(true);

  const [incomeAmount, setIncomeAmount] = useState('');
  const [incomeCurrencyCode, setIncomeCurrencyCode] = useState(user.base_currency_code);
  const [incomeSourceId, setIncomeSourceId] = useState('');
  const [newIncomeSourceName, setNewIncomeSourceName] = useState('');
  const [incomeBudgetAmountInBase, setIncomeBudgetAmountInBase] = useState('');
  const [incomeComment, setIncomeComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [creatingSource, setCreatingSource] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([fetchCurrencies(), fetchIncomeSources()])
      .then(([loadedCurrencies, loadedSources]) => {
        setCurrencies(loadedCurrencies);
        setIncomeSources(loadedSources);
        if (loadedSources.length > 0) {
          setIncomeSourceId(String(loadedSources[0].id));
        }
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const isNonBase = incomeCurrencyCode !== user.base_currency_code;
  const selectedSource = incomeSources.find((s) => String(s.id) === incomeSourceId);

  const canSubmit =
    !submitting &&
    !!selectedSource &&
    parseFloat(incomeAmount) > 0 &&
    (!isNonBase || parseFloat(incomeBudgetAmountInBase) > 0);

  const handleCreateSource = async () => {
    const name = newIncomeSourceName.trim();
    if (!name) return;

    setCreatingSource(true);
    setError(null);

    try {
      const result = await createIncomeSource(name);
      const created: IncomeSource = {
        id: result.id,
        name,
        is_active: true,
        created_at: new Date().toISOString(),
      };
      setIncomeSources((prev) => [...prev, created]);
      setIncomeSourceId(String(created.id));
      setNewIncomeSourceName('');
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreatingSource(false);
    }
  };

  const handleSubmit = async () => {
    if (!canSubmit || !selectedSource) return;

    setSubmitting(true);
    setError(null);

    try {
      await recordIncome({
        bank_account_id: user.bank_account_id,
        income_source_id: selectedSource.id,
        amount: parseFloat(incomeAmount),
        currency_code: incomeCurrencyCode,
        budget_amount_in_base: isNonBase ? parseFloat(incomeBudgetAmountInBase) : undefined,
        comment: incomeComment.trim() || undefined,
      } as RecordIncomeRequest);

      onSuccess();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={() => !submitting && onClose()}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="section__header">
          <div>
            <div className="section__eyebrow">Банк</div>
            <h2 className="section__title">Записать доход</h2>
          </div>
        </div>

        {loading ? (
          <p className="list-row__sub">Загрузка...</p>
        ) : (
          <>
            <div className="operations-note">
              Источник дохода → банк → нераспределённый бюджет.
            </div>

            <div className="form-row">
              <select
                className="input"
                value={incomeSourceId}
                onChange={(e) => setIncomeSourceId(e.target.value)}
                disabled={incomeSources.length === 0}
              >
                {incomeSources.length === 0 ? (
                  <option value="">Сначала создайте источник</option>
                ) : (
                  incomeSources.map((source) => (
                    <option key={source.id} value={source.id}>
                      {source.name}
                    </option>
                  ))
                )}
              </select>
            </div>

            <div className="form-row">
              <input
                className="input"
                type="text"
                placeholder="Новый источник дохода"
                value={newIncomeSourceName}
                onChange={(e) => setNewIncomeSourceName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleCreateSource()}
              />
              <button
                className="btn"
                type="button"
                disabled={creatingSource || newIncomeSourceName.trim().length === 0}
                onClick={handleCreateSource}
              >
                {creatingSource ? '...' : 'Добавить'}
              </button>
            </div>

            <div className="form-row">
              <input
                className="input"
                type="text"
                inputMode="decimal"
                placeholder="Сумма"
                value={incomeAmount}
                onChange={(e) => setIncomeAmount(sanitizeDecimalInput(e.target.value))}
              />
              <select
                className="input"
                value={incomeCurrencyCode}
                onChange={(e) => setIncomeCurrencyCode(e.target.value)}
              >
                {currencies.map((currency) => (
                  <option key={currency.code} value={currency.code}>
                    {currency.code}
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
                  value={incomeBudgetAmountInBase}
                  onChange={(e) => setIncomeBudgetAmountInBase(sanitizeDecimalInput(e.target.value))}
                  style={{ flex: 1 }}
                />
              </div>
            )}

            <div className="form-row">
              <input
                className="input"
                type="text"
                placeholder="Комментарий (необязательно)"
                value={incomeComment}
                onChange={(e) => setIncomeComment(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && canSubmit && handleSubmit()}
                style={{ flex: 1 }}
              />
            </div>

            {error && (
              <p style={{ color: 'var(--tag-out-fg)', fontSize: '0.85rem', marginTop: 4 }}>
                {error}
              </p>
            )}
          </>
        )}

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
            {submitting ? '...' : 'Записать'}
          </button>
        </div>
      </div>
    </div>
  );
}
