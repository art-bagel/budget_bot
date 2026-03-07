import { useEffect, useState } from 'react';
import {
  createIncomeSource,
  fetchCategories,
  fetchCurrencies,
  fetchIncomeSources,
  recordExpense,
  recordIncome,
} from '../api';
import type {
  Category,
  UserContext,
  Currency,
  IncomeSource,
  RecordExpenseResponse,
  RecordIncomeResponse,
} from '../types';

interface IncomeEntry {
  operation_id: number;
  income_source_name: string;
  amount: number;
  currency_code: string;
  budget_amount_in_base: number;
  base_currency_code: string;
  comment: string;
}

interface ExpenseEntry {
  operation_id: number;
  category_name: string;
  amount: number;
  currency_code: string;
  expense_cost_in_base: number;
  base_currency_code: string;
  comment: string;
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
  const [incomes, setIncomes] = useState<IncomeEntry[]>([]);

  const [expenseAmount, setExpenseAmount] = useState('');
  const [expenseCurrencyCode, setExpenseCurrencyCode] = useState(user.base_currency_code);
  const [expenseCategoryId, setExpenseCategoryId] = useState('');
  const [expenseComment, setExpenseComment] = useState('');
  const [submittingExpense, setSubmittingExpense] = useState(false);
  const [expenseError, setExpenseError] = useState<string | null>(null);
  const [expenses, setExpenses] = useState<ExpenseEntry[]>([]);

  useEffect(() => {
    Promise.all([fetchCurrencies(), fetchIncomeSources(), fetchCategories()])
      .then(([loadedCurrencies, loadedIncomeSources, loadedCategories]) => {
        setCurrencies(loadedCurrencies);
        setIncomeSources(loadedIncomeSources);
        const regularCategories = loadedCategories.filter((item) => item.kind === 'regular');
        setCategories(regularCategories);
        if (loadedIncomeSources.length > 0) {
          setIncomeSourceId(String(loadedIncomeSources[0].id));
        }
        if (regularCategories.length > 0) {
          setExpenseCategoryId(String(regularCategories[0].id));
        }
      })
      .catch((e: Error) => {
        setIncomeError(e.message);
        setExpenseError(e.message);
      })
      .finally(() => setLoading(false));
  }, []);

  const isIncomeNonBase = incomeCurrencyCode !== user.base_currency_code;
  const selectedIncomeSource = incomeSources.find((item) => String(item.id) === incomeSourceId);
  const selectedExpenseCategory = categories.find((item) => String(item.id) === expenseCategoryId);

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
    if (!parsedAmount || parsedAmount <= 0) return;
    if (isIncomeNonBase && (!incomeBudgetAmountInBase || parseFloat(incomeBudgetAmountInBase) <= 0)) return;
    if (!selectedIncomeSource) return;

    setSubmittingIncome(true);
    setIncomeError(null);

    try {
      const result: RecordIncomeResponse = await recordIncome({
        bank_account_id: user.bank_account_id,
        income_source_id: selectedIncomeSource.id,
        amount: parsedAmount,
        currency_code: incomeCurrencyCode,
        budget_amount_in_base: isIncomeNonBase ? parseFloat(incomeBudgetAmountInBase) : undefined,
        comment: incomeComment.trim() || undefined,
      });

      setIncomes((prev) => [
        {
          operation_id: result.operation_id,
          income_source_name: selectedIncomeSource.name,
          amount: parsedAmount,
          currency_code: incomeCurrencyCode,
          budget_amount_in_base: result.budget_amount_in_base,
          base_currency_code: result.base_currency_code,
          comment: incomeComment.trim(),
        },
        ...prev,
      ]);

      setIncomeAmount('');
      setIncomeBudgetAmountInBase('');
      setIncomeComment('');
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
      const result: RecordExpenseResponse = await recordExpense({
        bank_account_id: user.bank_account_id,
        category_id: selectedExpenseCategory.id,
        amount: parsedAmount,
        currency_code: expenseCurrencyCode,
        comment: expenseComment.trim() || undefined,
      });

      setExpenses((prev) => [
        {
          operation_id: result.operation_id,
          category_name: selectedExpenseCategory.name,
          amount: parsedAmount,
          currency_code: expenseCurrencyCode,
          expense_cost_in_base: result.expense_cost_in_base,
          base_currency_code: result.base_currency_code,
          comment: expenseComment.trim(),
        },
        ...prev,
      ]);

      setExpenseAmount('');
      setExpenseComment('');
    } catch (e: any) {
      setExpenseError(e.message);
    } finally {
      setSubmittingExpense(false);
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
              min="0"
              step="0.01"
            />
            <select
              className="input"
              value={incomeCurrencyCode}
              onChange={(e) => setIncomeCurrencyCode(e.target.value)}
            >
              {currencies.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.code}
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

          {incomeSources.length === 0 && !incomeError && (
            <p className="operations-hint">
              Без источника дохода форма записи не активируется.
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
              disabled={categories.length === 0}
            >
              {categories.length === 0 ? (
                <option value="">Сначала создайте обычную категорию</option>
              ) : (
                categories.map((category) => (
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
              min="0"
              step="0.01"
            />
            <select
              className="input"
              value={expenseCurrencyCode}
              onChange={(e) => setExpenseCurrencyCode(e.target.value)}
            >
              {currencies.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.code}
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

          {categories.length === 0 && !expenseError && (
            <p className="operations-hint">
              Для расхода нужна хотя бы одна категория типа regular.
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

      {expenses.length > 0 && (
        <section className="section">
          <div className="section__header">
            <h2 className="section__title">Записанные расходы</h2>
          </div>
          <div className="panel">
            <ul>
              {expenses.map((exp) => (
                <li className="list-row" key={exp.operation_id}>
                  <div>
                    <div className="list-row__title">
                      -{exp.amount} {exp.currency_code}
                    </div>
                    <div className="list-row__sub">
                      {exp.comment || `Операция #${exp.operation_id}`} · {exp.category_name}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <span className="tag tag--out">
                      {exp.expense_cost_in_base} {exp.base_currency_code}
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
