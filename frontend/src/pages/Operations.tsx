import { useEffect, useState } from 'react';

import {
  fetchOperationsHistory,
  reverseOperation,
} from '../api';
import type {
  OperationHistoryItem,
  UserContext,
} from '../types';


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
  if (item.type === 'expense') return 'Расход';
  if (item.type === 'allocate') return 'Распределение по категории';
  if (item.type === 'group_allocate') return 'Распределение по группе';
  if (item.type === 'exchange') return 'Обмен валют';
  if (item.type === 'reversal') return 'Отмена операции';
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


export default function Operations({ user: _user }: { user: UserContext }) {
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
    void loadHistory(0, true);
  }, [historyTypeFilter]);

  const canLoadMoreHistory = !loadingHistory && historyItems.length < historyTotalCount;

  const handleReverseOperation = async (operationId: number) => {
    setReversingOperationId(operationId);
    setHistoryError(null);

    try {
      await reverseOperation({ operation_id: operationId });
      await loadHistory(0, true);
    } catch (e: unknown) {
      setHistoryError(e instanceof Error ? e.message : String(e));
    } finally {
      setReversingOperationId(null);
    }
  };

  return (
    <>
      <h1 className="page-title">Операции</h1>

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
