import { useEffect, useState } from 'react';

import {
  createIncomeSource,
  fetchCurrencies,
  fetchIncomeSources,
  fetchOperationsHistory,
  recordIncome,
  reverseOperation,
} from '../api';
import type {
  Currency,
  IncomeSource,
  OperationHistoryItem,
  RecordIncomeRequest,
  UserContext,
} from '../types';
import { sanitizeDecimalInput } from '../utils/validation';


const HISTORY_PAGE_SIZE = 20;
const HISTORY_TYPE_OPTIONS = [
  { value: '', label: 'Все типы' },
  { value: 'income', label: 'Доход' },
  { value: 'expense', label: 'Расход' },
  { value: 'allocate', label: 'Распределение по категории' },
  { value: 'group_allocate', label: 'Распределение по группе' },
  { value: 'exchange', label: 'Обмен валют' },
  { value: 'reversal', label: 'Отмена операции' },
];


function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat('ru-RU', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(value));
}


function formatSignedAmount(amount: number, currencyCode: string): string {
  const absAmount = Math.abs(amount);
  const prefix = amount > 0 ? '+' : amount < 0 ? '-' : '';
  return prefix + new Intl.NumberFormat('ru-RU', {
    maximumFractionDigits: 2,
  }).format(absAmount) + ' ' + currencyCode;
}


function getOperationTitle(item: OperationHistoryItem): string {
  if (item.type === 'income') {
    return item.income_source_name ? 'Доход · ' + item.income_source_name : 'Доход';
  }
  if (item.type === 'expense') {
    return 'Расход';
  }
  if (item.type === 'allocate') {
    return 'Распределение по категории';
  }
  if (item.type === 'group_allocate') {
    return 'Распределение по группе';
  }
  if (item.type === 'exchange') {
    return 'Обмен валют';
  }
  if (item.type === 'reversal') {
    return 'Отмена операции';
  }
  return item.type;
}


function getOperationLines(item: OperationHistoryItem): string[] {
  const lines: string[] = [];

  item.bank_entries.forEach((entry) => {
    lines.push(formatSignedAmount(entry.amount, entry.currency_code));
  });

  item.budget_entries.forEach((entry) => {
    lines.push(entry.category_name + ': ' + formatSignedAmount(entry.amount, entry.currency_code));
  });

  if (item.reversal_of_operation_id) {
    lines.push('Отмена операции #' + item.reversal_of_operation_id);
  }

  return lines;
}


export default function Operations({ user }: { user: UserContext }) {
  const [currencies, setCurrencies] = useState<Currency[]>([]);
  const [incomeSources, setIncomeSources] = useState<IncomeSource[]>([]);
  const [loading, setLoading] = useState(true);

  const [incomeAmount, setIncomeAmount] = useState('');
  const [incomeCurrencyCode, setIncomeCurrencyCode] = useState(user.base_currency_code);
  const [incomeSourceId, setIncomeSourceId] = useState('');
  const [newIncomeSourceName, setNewIncomeSourceName] = useState('');
  const [incomeBudgetAmountInBase, setIncomeBudgetAmountInBase] = useState('');
  const [incomeComment, setIncomeComment] = useState('');
  const [submittingIncome, setSubmittingIncome] = useState(false);
  const [creatingIncomeSource, setCreatingIncomeSource] = useState(false);
  const [incomeError, setIncomeError] = useState<string | null>(null);

  const [historyItems, setHistoryItems] = useState<OperationHistoryItem[]>([]);
  const [historyTotalCount, setHistoryTotalCount] = useState(0);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historyTypeFilter, setHistoryTypeFilter] = useState('');
  const [reversingOperationId, setReversingOperationId] = useState<number | null>(null);

  const loadHistory = async (
    offset: number,
    replace = false,
    operationType = historyTypeFilter,
  ) => {
    setLoadingHistory(true);
    setHistoryError(null);

    try {
      const result = await fetchOperationsHistory(
        HISTORY_PAGE_SIZE,
        offset,
        operationType || undefined,
      );
      setHistoryItems((prev) => (replace ? result.items : [...prev, ...result.items]));
      setHistoryTotalCount(result.total_count);
    } catch (e: unknown) {
      setHistoryError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingHistory(false);
    }
  };

  useEffect(() => {
    Promise.all([fetchCurrencies(), fetchIncomeSources()])
      .then(([loadedCurrencies, loadedIncomeSources]) => {
        setCurrencies(loadedCurrencies);
        setIncomeSources(loadedIncomeSources);

        if (loadedIncomeSources.length > 0) {
          setIncomeSourceId(String(loadedIncomeSources[0].id));
        }
      })
      .catch((e: Error) => {
        setIncomeError(e.message);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    void loadHistory(0, true);
  }, [historyTypeFilter]);

  const isIncomeNonBase = incomeCurrencyCode !== user.base_currency_code;
  const selectedIncomeSource = incomeSources.find((item) => String(item.id) === incomeSourceId);

  const handleCreateIncomeSource = async () => {
    const normalizedName = newIncomeSourceName.trim();

    if (!normalizedName) return;

    setCreatingIncomeSource(true);
    setIncomeError(null);

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
    } catch (e: unknown) {
      setIncomeError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreatingIncomeSource(false);
    }
  };

  const handleIncomeSubmit = async () => {
    const parsedAmount = parseFloat(incomeAmount);

    if (!parsedAmount || parsedAmount <= 0 || !selectedIncomeSource) return;
    if (isIncomeNonBase && (!incomeBudgetAmountInBase || parseFloat(incomeBudgetAmountInBase) <= 0)) return;

    setSubmittingIncome(true);
    setIncomeError(null);

    try {
      await recordIncome({
        bank_account_id: user.bank_account_id,
        income_source_id: selectedIncomeSource.id,
        amount: parsedAmount,
        currency_code: incomeCurrencyCode,
        budget_amount_in_base: isIncomeNonBase ? parseFloat(incomeBudgetAmountInBase) : undefined,
        comment: incomeComment.trim() || undefined,
      } as RecordIncomeRequest);

      setIncomeAmount('');
      setIncomeBudgetAmountInBase('');
      setIncomeComment('');
      await loadHistory(0, true);
    } catch (e: unknown) {
      setIncomeError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmittingIncome(false);
    }
  };

  const canSubmitIncome =
    !submittingIncome &&
    !!selectedIncomeSource &&
    parseFloat(incomeAmount) > 0 &&
    (!isIncomeNonBase || parseFloat(incomeBudgetAmountInBase) > 0);

  const canLoadMoreHistory = !loadingHistory && historyItems.length < historyTotalCount;

  const handleReverseOperation = async (operationId: number) => {
    setReversingOperationId(operationId);
    setHistoryError(null);

    try {
      await reverseOperation({
        operation_id: operationId,
      });
      await loadHistory(0, true);
    } catch (e: unknown) {
      setHistoryError(e instanceof Error ? e.message : String(e));
    } finally {
      setReversingOperationId(null);
    }
  };

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

          {isIncomeNonBase && (
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
              onKeyDown={(e) => e.key === 'Enter' && canSubmitIncome && handleIncomeSubmit()}
              style={{ flex: 1 }}
            />
            <button
              className="btn btn--primary"
              type="button"
              disabled={!canSubmitIncome}
              onClick={handleIncomeSubmit}
            >
              {submittingIncome ? '...' : 'Записать'}
            </button>
          </div>

          {incomeError && (
            <p style={{ color: 'var(--tag-out-fg)', fontSize: '0.85rem', marginTop: 8 }}>
              {incomeError}
            </p>
          )}
        </div>
      </section>

      <section className="section">
        <div className="section__header">
          <h2 className="section__title">История операций</h2>
          <div className="section__header-actions">
            <select
              className="input input--compact"
              value={historyTypeFilter}
              onChange={(e) => setHistoryTypeFilter(e.target.value)}
            >
              {HISTORY_TYPE_OPTIONS.map((option) => (
                <option key={option.value || 'all'} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <span className="tag tag--neutral">{historyTotalCount} всего</span>
          </div>
        </div>
        <div className="panel">
          {historyError && (
            <p style={{ color: 'var(--tag-out-fg)', fontSize: '0.85rem', marginBottom: 12 }}>
              {historyError}
            </p>
          )}

          {historyItems.length === 0 && !loadingHistory ? (
            <p className="list-row__sub">Операций пока нет</p>
          ) : (
            <div className="history-list">
              <ul>
                {historyItems.map((item) => (
                  <li className="list-row list-row--history" key={'history-' + item.operation_id}>
                    <div>
                      <div className="list-row__title">{getOperationTitle(item)}</div>
                      <div className="list-row__sub">
                        {item.comment || formatDateTime(item.created_at)}
                      </div>
                      <div className="history-lines">
                        {getOperationLines(item).map((line, index) => (
                          <div className="history-line" key={item.operation_id + '-line-' + index}>
                            {line}
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="history-side">
                      <span className="tag tag--neutral">{formatDateTime(item.created_at)}</span>
                      {item.type !== 'reversal' && !item.has_reversal && (
                        <button
                          className="btn"
                          type="button"
                          disabled={reversingOperationId === item.operation_id}
                          onClick={() => handleReverseOperation(item.operation_id)}
                        >
                          {reversingOperationId === item.operation_id ? '...' : 'Отменить'}
                        </button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {canLoadMoreHistory && (
            <div className="form-row">
              <button
                className="btn"
                type="button"
                disabled={loadingHistory}
                onClick={() => loadHistory(historyItems.length)}
              >
                {loadingHistory ? '...' : 'Показать еще'}
              </button>
            </div>
          )}
        </div>
      </section>
    </>
  );
}
