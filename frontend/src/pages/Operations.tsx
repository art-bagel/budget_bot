import { useEffect, useState } from 'react';

import {
  allocateBudget,
  allocateGroupBudget,
  createIncomeSource,
  fetchCategories,
  fetchCurrencies,
  fetchIncomeSources,
  fetchOperationsHistory,
  recordExpense,
  recordIncome,
} from '../api';
import type {
  Category,
  Currency,
  IncomeSource,
  OperationHistoryItem,
  RecordExpenseRequest,
  RecordIncomeRequest,
  AllocateBudgetRequest,
  AllocateGroupBudgetRequest,
  UserContext,
} from '../types';


interface AllocationSourceOption {
  id: number;
  name: string;
}


const HISTORY_PAGE_SIZE = 20;


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
  const [categories, setCategories] = useState<Category[]>([]);
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

  const [expenseAmount, setExpenseAmount] = useState('');
  const [expenseCurrencyCode, setExpenseCurrencyCode] = useState(user.base_currency_code);
  const [expenseCategoryId, setExpenseCategoryId] = useState('');
  const [expenseComment, setExpenseComment] = useState('');
  const [submittingExpense, setSubmittingExpense] = useState(false);
  const [expenseError, setExpenseError] = useState<string | null>(null);

  const [allocationSourceId, setAllocationSourceId] = useState('');
  const [allocationTargetId, setAllocationTargetId] = useState('');
  const [allocationAmount, setAllocationAmount] = useState('');
  const [allocationComment, setAllocationComment] = useState('');
  const [submittingAllocation, setSubmittingAllocation] = useState(false);
  const [allocationError, setAllocationError] = useState<string | null>(null);

  const [historyItems, setHistoryItems] = useState<OperationHistoryItem[]>([]);
  const [historyTotalCount, setHistoryTotalCount] = useState(0);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);

  const loadHistory = async (offset: number, replace = false) => {
    setLoadingHistory(true);
    setHistoryError(null);

    try {
      const result = await fetchOperationsHistory(HISTORY_PAGE_SIZE, offset);
      setHistoryItems((prev) => (replace ? result.items : [...prev, ...result.items]));
      setHistoryTotalCount(result.total_count);
    } catch (e: any) {
      setHistoryError(e.message);
    } finally {
      setLoadingHistory(false);
    }
  };

  useEffect(() => {
    Promise.all([fetchCurrencies(), fetchIncomeSources(), fetchCategories(), loadHistory(0, true)])
      .then(([loadedCurrencies, loadedIncomeSources, loadedCategories]) => {
        const visibleCategories = loadedCategories.filter((item) => item.kind !== 'system');
        const regularCategories = visibleCategories.filter((item) => item.kind === 'regular');

        setCurrencies(loadedCurrencies);
        setIncomeSources(loadedIncomeSources);
        setCategories(visibleCategories);

        if (loadedIncomeSources.length > 0) {
          setIncomeSourceId(String(loadedIncomeSources[0].id));
        }

        if (regularCategories.length > 0) {
          setExpenseCategoryId(String(regularCategories[0].id));
        }

        if (visibleCategories.length > 0) {
          setAllocationTargetId(String(visibleCategories[0].id));
        }

        setAllocationSourceId(String(user.unallocated_category_id));
      })
      .catch((e: Error) => {
        setIncomeError(e.message);
        setExpenseError(e.message);
        setAllocationError(e.message);
      })
      .finally(() => setLoading(false));
  }, [user.unallocated_category_id]);

  const regularCategories = categories.filter((item) => item.kind === 'regular');
  const sourceOptions: AllocationSourceOption[] = [
    { id: user.unallocated_category_id, name: 'Свободный остаток' },
    ...regularCategories.map((item) => ({ id: item.id, name: item.name })),
  ];

  const isIncomeNonBase = incomeCurrencyCode !== user.base_currency_code;
  const selectedIncomeSource = incomeSources.find((item) => String(item.id) === incomeSourceId);
  const selectedExpenseCategory = categories.find((item) => String(item.id) === expenseCategoryId);
  const selectedAllocationSource = sourceOptions.find((item) => String(item.id) === allocationSourceId);
  const selectedAllocationTarget = categories.find((item) => String(item.id) === allocationTargetId);

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
    } catch (e: any) {
      setIncomeError(e.message);
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
    } catch (e: any) {
      setIncomeError(e.message);
    } finally {
      setSubmittingIncome(false);
    }
  };

  const handleExpenseSubmit = async () => {
    const parsedAmount = parseFloat(expenseAmount);

    if (!parsedAmount || parsedAmount <= 0 || !selectedExpenseCategory) return;

    setSubmittingExpense(true);
    setExpenseError(null);

    try {
      await recordExpense({
        bank_account_id: user.bank_account_id,
        category_id: selectedExpenseCategory.id,
        amount: parsedAmount,
        currency_code: expenseCurrencyCode,
        comment: expenseComment.trim() || undefined,
      } as RecordExpenseRequest);

      setExpenseAmount('');
      setExpenseComment('');
      await loadHistory(0, true);
    } catch (e: any) {
      setExpenseError(e.message);
    } finally {
      setSubmittingExpense(false);
    }
  };

  const handleAllocationSubmit = async () => {
    const parsedAmount = parseFloat(allocationAmount);

    if (!parsedAmount || parsedAmount <= 0 || !selectedAllocationSource || !selectedAllocationTarget) return;

    setSubmittingAllocation(true);
    setAllocationError(null);

    try {
      if (selectedAllocationTarget.kind === 'group') {
        await allocateGroupBudget({
          from_category_id: selectedAllocationSource.id,
          group_id: selectedAllocationTarget.id,
          amount_in_base: parsedAmount,
          comment: allocationComment.trim() || undefined,
        } as AllocateGroupBudgetRequest);
      } else {
        await allocateBudget({
          from_category_id: selectedAllocationSource.id,
          to_category_id: selectedAllocationTarget.id,
          amount_in_base: parsedAmount,
          comment: allocationComment.trim() || undefined,
        } as AllocateBudgetRequest);
      }

      setAllocationAmount('');
      setAllocationComment('');
      await loadHistory(0, true);
    } catch (e: any) {
      setAllocationError(e.message);
    } finally {
      setSubmittingAllocation(false);
    }
  };

  const canSubmitIncome =
    !submittingIncome &&
    !!selectedIncomeSource &&
    parseFloat(incomeAmount) > 0 &&
    (!isIncomeNonBase || parseFloat(incomeBudgetAmountInBase) > 0);

  const canSubmitExpense =
    !submittingExpense &&
    !!selectedExpenseCategory &&
    parseFloat(expenseAmount) > 0;

  const canSubmitAllocation =
    !submittingAllocation &&
    !!selectedAllocationSource &&
    !!selectedAllocationTarget &&
    parseFloat(allocationAmount) > 0;

  const canLoadMoreHistory = !loadingHistory && historyItems.length < historyTotalCount;

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
              onChange={(e) => setIncomeAmount(e.target.value)}
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
                onChange={(e) => setIncomeBudgetAmountInBase(e.target.value)}
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
          <h2 className="section__title">Записать расход</h2>
        </div>
        <div className="panel">
          <div className="operations-note">
            Расход списывает валюту из банка и бюджетную стоимость из выбранной категории.
          </div>

          <div className="form-row">
            <select
              className="input"
              value={expenseCategoryId}
              onChange={(e) => setExpenseCategoryId(e.target.value)}
              disabled={regularCategories.length === 0}
            >
              {regularCategories.length === 0 ? (
                <option value="">Сначала создайте обычную категорию</option>
              ) : (
                regularCategories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
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
              inputMode="decimal"
              placeholder="Сумма"
              value={expenseAmount}
              onChange={(e) => setExpenseAmount(e.target.value)}
            />
            <select
              className="input"
              value={expenseCurrencyCode}
              onChange={(e) => setExpenseCurrencyCode(e.target.value)}
            >
              {currencies.map((currency) => (
                <option key={currency.code} value={currency.code}>
                  {currency.code}
                </option>
              ))}
            </select>
          </div>

          <div className="form-row">
            <input
              className="input"
              type="text"
              placeholder="Комментарий (необязательно)"
              value={expenseComment}
              onChange={(e) => setExpenseComment(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && canSubmitExpense && handleExpenseSubmit()}
              style={{ flex: 1 }}
            />
            <button
              className="btn btn--primary"
              type="button"
              disabled={!canSubmitExpense}
              onClick={handleExpenseSubmit}
            >
              {submittingExpense ? '...' : 'Списать'}
            </button>
          </div>

          {expenseError && (
            <p style={{ color: 'var(--tag-out-fg)', fontSize: '0.85rem', marginTop: 8 }}>
              {expenseError}
            </p>
          )}
        </div>
      </section>

      <section className="section">
        <div className="section__header">
          <h2 className="section__title">Распределить бюджет</h2>
        </div>
        <div className="panel">
          <div className="operations-note">
            Выбери назначение. Если это группа, сумма автоматически разойдется по ее правилам.
          </div>

          <div className="form-row">
            <select className="input" value={allocationSourceId} onChange={(e) => setAllocationSourceId(e.target.value)}>
              {sourceOptions.map((source) => (
                <option key={source.id} value={source.id}>
                  Из: {source.name}
                </option>
              ))}
            </select>
            <select className="input" value={allocationTargetId} onChange={(e) => setAllocationTargetId(e.target.value)}>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  В: {category.name} ({category.kind === 'group' ? 'группа' : 'категория'})
                </option>
              ))}
            </select>
          </div>

          <div className="form-row">
            <input
              className="input"
              type="text"
              inputMode="decimal"
              placeholder={`Сумма в ${user.base_currency_code}`}
              value={allocationAmount}
              onChange={(e) => setAllocationAmount(e.target.value)}
            />
            <input
              className="input"
              type="text"
              placeholder="Комментарий (необязательно)"
              value={allocationComment}
              onChange={(e) => setAllocationComment(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && canSubmitAllocation && handleAllocationSubmit()}
              style={{ flex: 1 }}
            />
            <button
              className="btn btn--primary"
              type="button"
              disabled={!canSubmitAllocation}
              onClick={handleAllocationSubmit}
            >
              {submittingAllocation ? '...' : 'Распределить'}
            </button>
          </div>

          {allocationError && (
            <p style={{ color: 'var(--tag-out-fg)', fontSize: '0.85rem', marginTop: 8 }}>
              {allocationError}
            </p>
          )}
        </div>
      </section>

      <section className="section">
        <div className="section__header">
          <h2 className="section__title">История операций</h2>
          <span className="tag tag--neutral">{historyTotalCount} всего</span>
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
                    <div style={{ textAlign: 'right' }}>
                      <span className="tag tag--neutral">{formatDateTime(item.created_at)}</span>
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
