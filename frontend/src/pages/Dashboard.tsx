import { useEffect, useMemo, useState } from 'react';

import { allocateBudget, allocateGroupBudget, fetchDashboardOverview } from '../api';
import type {
  AllocateBudgetRequest,
  AllocateGroupBudgetRequest,
  DashboardBudgetCategory,
  DashboardOverview as DashboardOverviewType,
  UserContext,
} from '../types';


function formatAmount(amount: number, currencyCode: string): string {
  return new Intl.NumberFormat('ru-RU', {
    maximumFractionDigits: 2,
  }).format(amount) + ' ' + currencyCode;
}


interface TransferSource {
  category_id: number;
  name: string;
  kind: string;
  balance: number;
  currency_code: string;
}


interface TransferTarget {
  category_id: number;
  name: string;
  kind: string;
  currency_code: string;
}


export default function Dashboard({ user }: { user: UserContext }) {
  const [overview, setOverview] = useState<DashboardOverviewType | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [draggedCategoryId, setDraggedCategoryId] = useState<number | null>(null);
  const [dropTargetCategoryId, setDropTargetCategoryId] = useState<number | null>(null);
  const [transferSource, setTransferSource] = useState<TransferSource | null>(null);
  const [transferTarget, setTransferTarget] = useState<TransferTarget | null>(null);
  const [transferAmount, setTransferAmount] = useState('');
  const [transferComment, setTransferComment] = useState('');
  const [transferError, setTransferError] = useState<string | null>(null);
  const [submittingTransfer, setSubmittingTransfer] = useState(false);

  const loadOverview = async () => {
    setLoading(true);
    setError(null);

    try {
      const result = await fetchDashboardOverview(user.bank_account_id);
      setOverview(result);
    } catch (reason: any) {
      setError(reason.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadOverview();
  }, [user.bank_account_id]);

  const regularBudgetCategories = useMemo(
    () => overview?.budget_categories.filter((category) => category.kind === 'regular') || [],
    [overview],
  );
  const handleDragStart = (source: TransferSource) => {
    setDraggedCategoryId(source.category_id);
    setTransferError(null);
  };

  const handleDragEnd = () => {
    setDraggedCategoryId(null);
    setDropTargetCategoryId(null);
  };

  const handleDropOnCategory = (targetCategory: TransferTarget) => {
    if (!overview || !draggedCategoryId) {
      setDraggedCategoryId(null);
      setDropTargetCategoryId(null);
      return;
    }

    const sourceCategory = draggedCategoryId === user.unallocated_category_id
      ? {
          category_id: user.unallocated_category_id,
          name: 'Свободный остаток',
          kind: 'free_budget',
          balance: overview.free_budget_in_base,
          currency_code: overview.base_currency_code,
        }
      : overview.budget_categories.find(
          (category) => category.category_id === draggedCategoryId && category.kind === 'regular',
        ) || null;

    if (!sourceCategory || targetCategory.kind === 'system' || draggedCategoryId === targetCategory.category_id) {
      setDraggedCategoryId(null);
      setDropTargetCategoryId(null);
      return;
    }

    setTransferSource(sourceCategory);
    setTransferTarget(targetCategory);
    setTransferAmount('');
    setTransferComment('');
    setTransferError(null);
    setDraggedCategoryId(null);
    setDropTargetCategoryId(null);
  };

  const closeTransferDialog = (force = false) => {
    if (submittingTransfer && !force) {
      return;
    }

    setTransferSource(null);
    setTransferTarget(null);
    setTransferAmount('');
    setTransferComment('');
    setTransferError(null);
    setDraggedCategoryId(null);
    setDropTargetCategoryId(null);
  };

  const handleTransferSubmit = async () => {
    if (!transferSource || !transferTarget || parseFloat(transferAmount) <= 0) {
      return;
    }

    setSubmittingTransfer(true);
    setTransferError(null);

    try {
      if (transferTarget.kind === 'group') {
        await allocateGroupBudget({
          from_category_id: transferSource.category_id,
          group_id: transferTarget.category_id,
          amount_in_base: parseFloat(transferAmount),
          comment: transferComment.trim() || undefined,
        } as AllocateGroupBudgetRequest);
      } else {
        await allocateBudget({
          from_category_id: transferSource.category_id,
          to_category_id: transferTarget.category_id,
          amount_in_base: parseFloat(transferAmount),
          comment: transferComment.trim() || undefined,
        } as AllocateBudgetRequest);
      }

      closeTransferDialog(true);
      await loadOverview();
    } catch (reason: any) {
      setTransferError(reason.message);
    } finally {
      setSubmittingTransfer(false);
    }
  };

  if (loading) {
    return (
      <div className="status-screen">
        <h1>Загрузка...</h1>
        <p>Собираем реальные остатки банка и бюджетов.</p>
      </div>
    );
  }

  if (error || !overview) {
    return (
      <div className="status-screen">
        <h1>Не удалось загрузить обзор</h1>
        <p>{error || 'Нет данных для отображения.'}</p>
      </div>
    );
  }

  const freeBudgetSource: TransferSource = {
    category_id: user.unallocated_category_id,
    name: 'Свободный остаток',
    kind: 'free_budget',
    balance: overview.free_budget_in_base,
    currency_code: overview.base_currency_code,
  };
  const freeBudgetTarget: TransferTarget = {
    category_id: user.unallocated_category_id,
    name: 'Свободный остаток',
    kind: 'free_budget',
    currency_code: overview.base_currency_code,
  };

  return (
    <>
      <h1 className="page-title">Обзор</h1>

      <section className="metrics">
        <article className="metric-card">
          <span className="metric-card__label">Банк по себестоимости</span>
          <strong className="metric-card__value">
            {formatAmount(overview.total_bank_historical_in_base, overview.base_currency_code)}
          </strong>
        </article>
        <article className="metric-card metric-card--accent">
          <span className="metric-card__label">Бюджет по категориям</span>
          <strong className="metric-card__value">
            {formatAmount(overview.total_budget_in_base, overview.base_currency_code)}
          </strong>
        </article>
      </section>

      <section className="section">
        <div className="section__header">
          <div>
            <div className="section__eyebrow">Банк</div>
            <h2 className="section__title">Сколько денег лежит по валютам</h2>
          </div>
        </div>
        <div className="balance-scroll">
          {overview.bank_balances.map((balance) => (
            <article className="balance-card" key={balance.currency_code}>
              <div className="balance-card__head">
                <span className="pill">{balance.currency_code}</span>
              </div>
              <strong className="balance-card__amount">
                {formatAmount(balance.amount, balance.currency_code)}
              </strong>
              <div className="balance-card__sub">
                Себестоимость: {formatAmount(balance.historical_cost_in_base, overview.base_currency_code)}
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="section">
        <div className="section__header">
          <div>
            <div className="section__eyebrow">Бюджет</div>
            <h2 className="section__title">Как распределены деньги по категориям</h2>
          </div>
        </div>
        <div className="panel">
          <div className="operations-note">
            Перетаскивай свободный остаток или обычную категорию на категорию или группу, чтобы открыть перевод бюджета.
          </div>
          <div className="dashboard-transfer-source">
            <div
              className={[
                'balance-card',
                'balance-card--draggable',
                draggedCategoryId !== null && draggedCategoryId !== freeBudgetSource.category_id
                  ? 'balance-card--droppable'
                  : '',
                draggedCategoryId === freeBudgetSource.category_id ? 'balance-card--dragging' : '',
                dropTargetCategoryId === freeBudgetTarget.category_id ? 'balance-card--drop-target' : '',
              ].join(' ').trim()}
              draggable={overview.free_budget_in_base > 0}
              onDragStart={() => overview.free_budget_in_base > 0 && handleDragStart(freeBudgetSource)}
              onDragEnd={handleDragEnd}
              onDragOver={(event) => {
                if (draggedCategoryId === null || draggedCategoryId === freeBudgetTarget.category_id) {
                  return;
                }
                event.preventDefault();
                setDropTargetCategoryId(freeBudgetTarget.category_id);
              }}
              onDragLeave={() => {
                if (dropTargetCategoryId === freeBudgetTarget.category_id) {
                  setDropTargetCategoryId(null);
                }
              }}
              onDrop={(event) => {
                event.preventDefault();
                handleDropOnCategory(freeBudgetTarget);
              }}
            >
              <div className="balance-card__head">
                <span className="pill">Свободный остаток</span>
              </div>
              <strong className="balance-card__amount">
                {formatAmount(overview.free_budget_in_base, overview.base_currency_code)}
              </strong>
              <div className="balance-card__sub">
                Перетащи на категорию или группу для распределения. Сюда тоже можно вернуть деньги из категории.
              </div>
            </div>
          </div>
          <ul>
            {overview.budget_categories.map((category) => {
              const isRegular = category.kind === 'regular';
              const isDroppable = category.kind === 'regular' || category.kind === 'group';
              const isDragging = draggedCategoryId === category.category_id && isRegular;
              const isDropTarget = dropTargetCategoryId === category.category_id;

              return (
                <li
                  className={[
                    'list-row',
                    isRegular ? 'list-row--draggable' : '',
                    isDragging ? 'list-row--dragging' : '',
                    isDropTarget ? 'list-row--drop-target' : '',
                  ].join(' ').trim()}
                  key={category.category_id}
                  draggable={isRegular}
                  onDragStart={() => isRegular && handleDragStart(category)}
                  onDragEnd={handleDragEnd}
                  onDragOver={(event) => {
                    if (!isDroppable || draggedCategoryId === null || draggedCategoryId === category.category_id) {
                      return;
                    }
                    event.preventDefault();
                    setDropTargetCategoryId(category.category_id);
                  }}
                  onDragLeave={() => {
                    if (dropTargetCategoryId === category.category_id) {
                      setDropTargetCategoryId(null);
                    }
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    handleDropOnCategory({
                      category_id: category.category_id,
                      name: category.name,
                      kind: category.kind,
                      currency_code: category.currency_code,
                    });
                  }}
                >
                  <div>
                    <div className="list-row__title">{category.name}</div>
                    <div className="list-row__sub">
                      Тип: {category.kind}
                      {isRegular ? ' · можно перетаскивать' : ''}
                      {category.kind === 'group' ? ' · можно бросить сюда' : ''}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div className="list-row__value">
                      {formatAmount(category.balance, category.currency_code)}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      </section>

      {transferSource && transferTarget && (
        <div className="modal-backdrop" onClick={() => closeTransferDialog()}>
          <div className="modal-card" onClick={(event) => event.stopPropagation()}>
            <div className="section__header">
              <div>
                <div className="section__eyebrow">Перевод бюджета</div>
                <h2 className="section__title">Перенос между категориями</h2>
              </div>
            </div>

            <div className="operations-note">
              Из <strong>{transferSource.name}</strong> в <strong>{transferTarget.name}</strong>.
            </div>

            <div className="form-row">
              <div className="input input--read-only">
                Из: {transferSource.name}
              </div>
              <div className="input input--read-only">
                В: {transferTarget.name}
              </div>
            </div>

            <div className="form-row">
              <input
                className="input"
                type="text"
                inputMode="decimal"
                placeholder={`Сумма в ${overview.base_currency_code}`}
                value={transferAmount}
                onChange={(event) => setTransferAmount(event.target.value)}
              />
            </div>

            <div className="form-row">
              <input
                className="input"
                type="text"
                placeholder="Комментарий (необязательно)"
                value={transferComment}
                onChange={(event) => setTransferComment(event.target.value)}
                onKeyDown={(event) => event.key === 'Enter' && !submittingTransfer && handleTransferSubmit()}
                style={{ flex: 1 }}
              />
            </div>

            {transferError && (
              <p style={{ color: 'var(--tag-out-fg)', fontSize: '0.85rem', marginTop: 4 }}>
                {transferError}
              </p>
            )}

            <div className="modal-actions">
              <button className="btn" type="button" onClick={() => closeTransferDialog()} disabled={submittingTransfer}>
                Отмена
              </button>
              <button
                className="btn btn--primary"
                type="button"
                disabled={submittingTransfer || parseFloat(transferAmount) <= 0}
                onClick={handleTransferSubmit}
              >
                {submittingTransfer ? '...' : 'Перевести'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
