import { useEffect, useRef, useState } from 'react';

import {
  fetchDashboardOverview,
  fetchGroupMembers,
} from '../api';
import type {
  DashboardBudgetCategory,
  DashboardOverview as DashboardOverviewType,
  GroupMember,
  UserContext,
} from '../types';
import { formatAmount } from '../utils/format';
import TransferDialog from '../components/TransferDialog';
import type { TransferSource, TransferTarget } from '../components/TransferDialog';
import CategoryDialog from '../components/CategoryDialog';
import CreateCategoryDialog from '../components/CreateCategoryDialog';


export default function Dashboard({ user }: { user: UserContext }) {
  const [overview, setOverview] = useState<DashboardOverviewType | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [draggedCategoryId, setDraggedCategoryId] = useState<number | null>(null);
  const [dropTargetCategoryId, setDropTargetCategoryId] = useState<number | null>(null);
  const [tapSourceId, setTapSourceId] = useState<number | null>(null);
  const [transferSource, setTransferSource] = useState<TransferSource | null>(null);
  const [transferTarget, setTransferTarget] = useState<TransferTarget | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<DashboardBudgetCategory | null>(null);
  const suppressCategoryClickUntilRef = useRef(0);
  const [groupMembersByGroupId, setGroupMembersByGroupId] = useState<Record<number, GroupMember[]>>({});
  const [createDialogKind, setCreateDialogKind] = useState<'regular' | 'group' | null>(null);

  const activeSourceId = draggedCategoryId ?? tapSourceId;

  const loadOverview = async () => {
    setLoading(true);
    setError(null);

    try {
      const result = await fetchDashboardOverview(user.bank_account_id);
      setOverview(result);
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadOverview();
  }, [user.bank_account_id]);

  useEffect(() => {
    if (!overview) {
      setGroupMembersByGroupId({});
      return;
    }

    const groupCategories = overview.budget_categories.filter((category) => category.kind === 'group');

    if (groupCategories.length === 0) {
      setGroupMembersByGroupId({});
      return;
    }

    let cancelled = false;

    void Promise.all(
      groupCategories.map(async (group) => ({
        groupId: group.category_id,
        members: await fetchGroupMembers(group.category_id),
      })),
    )
      .then((results) => {
        if (cancelled) return;

        setGroupMembersByGroupId(
          results.reduce<Record<number, GroupMember[]>>((acc, result) => {
            acc[result.groupId] = result.members;
            return acc;
          }, {}),
        );
      })
      .catch(() => {
        if (!cancelled) {
          setGroupMembersByGroupId({});
        }
      });

    return () => {
      cancelled = true;
    };
  }, [overview]);

  const handleDragStart = (source: TransferSource, event: React.DragEvent) => {
    event.dataTransfer.setData('text/plain', '');
    event.dataTransfer.effectAllowed = 'move';
    suppressCategoryClickUntilRef.current = Date.now() + 250;
    setDraggedCategoryId(source.category_id);
  };

  const handleDragEnd = () => {
    setDraggedCategoryId(null);
    setDropTargetCategoryId(null);
  };

  const completeTransfer = (sourceId: number, target: TransferTarget) => {
    if (!overview) return;

    const source: TransferSource | null = sourceId === user.unallocated_category_id
      ? {
          category_id: user.unallocated_category_id,
          name: 'Свободный остаток',
          kind: 'free_budget',
          balance: overview.free_budget_in_base,
          currency_code: overview.base_currency_code,
        }
      : overview.budget_categories.find(
          (category) => category.category_id === sourceId && category.kind === 'regular',
        ) || null;

    if (!source || target.kind === 'system' || sourceId === target.category_id) {
      setDraggedCategoryId(null);
      setDropTargetCategoryId(null);
      setTapSourceId(null);
      return;
    }

    setTransferSource(source);
    setTransferTarget(target);
    setDraggedCategoryId(null);
    setDropTargetCategoryId(null);
    setTapSourceId(null);
  };

  const handleDropOnCategory = (target: TransferTarget) => {
    if (!draggedCategoryId) {
      handleDragEnd();
      return;
    }
    completeTransfer(draggedCategoryId, target);
  };

  const openCategoryDialog = (category: DashboardBudgetCategory) => {
    if (Date.now() < suppressCategoryClickUntilRef.current) return;
    setSelectedCategory(category);
  };

  const handleCategoryTransfer = (category: DashboardBudgetCategory) => {
    setSelectedCategory(null);
    setTapSourceId(category.category_id);
  };

  const handleDialogSuccess = async () => {
    setTransferSource(null);
    setTransferTarget(null);
    setSelectedCategory(null);
    setCreateDialogKind(null);
    setTapSourceId(null);
    await loadOverview();
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
  const regularBudgetCategories = overview.budget_categories.filter((category) => category.kind === 'regular');
  const groupBudgetCategories = overview.budget_categories.filter((category) => category.kind === 'group');
  const regularCategoryBalanceById = regularBudgetCategories.reduce<Record<number, number>>((acc, category) => {
    acc[category.category_id] = category.balance;
    return acc;
  }, {});

  const tapSourceName = tapSourceId !== null
    ? (tapSourceId === user.unallocated_category_id
        ? 'Свободный остаток'
        : overview.budget_categories.find((c) => c.category_id === tapSourceId)?.name || '')
    : '';

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
          {tapSourceId !== null ? (
            <div className="transfer-banner">
              <span>
                Выбрано: <strong>{tapSourceName}</strong>. Нажми на категорию или группу для перевода.
              </span>
              <button
                className="btn btn--small"
                type="button"
                onClick={() => setTapSourceId(null)}
              >
                Отмена
              </button>
            </div>
          ) : (
            <div className="operations-note">
              Нажми на свободный остаток, чтобы выбрать источник перевода. На компьютере также можно перетаскивать.
            </div>
          )}
          <div className="dashboard-transfer-source">
            <div
              className={[
                'balance-card',
                'balance-card--draggable',
                activeSourceId !== null && activeSourceId !== freeBudgetSource.category_id
                  ? 'balance-card--droppable'
                  : '',
                activeSourceId === freeBudgetSource.category_id ? 'balance-card--tap-selected' : '',
                draggedCategoryId === freeBudgetSource.category_id ? 'balance-card--dragging' : '',
                dropTargetCategoryId === freeBudgetTarget.category_id ? 'balance-card--drop-target' : '',
              ].join(' ').trim()}
              draggable={overview.free_budget_in_base > 0}
              onDragStart={(e) => {
                if (overview.free_budget_in_base > 0) handleDragStart(freeBudgetSource, e);
              }}
              onDragEnd={handleDragEnd}
              onDragOver={(event) => {
                if (activeSourceId === null || activeSourceId === freeBudgetTarget.category_id) return;
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
              onClick={() => {
                if (activeSourceId === freeBudgetSource.category_id) {
                  setTapSourceId(null);
                } else if (activeSourceId !== null) {
                  completeTransfer(activeSourceId, freeBudgetTarget);
                } else if (overview.free_budget_in_base > 0) {
                  setTapSourceId(freeBudgetSource.category_id);
                }
              }}
            >
              <div className="balance-card__head">
                <span className="pill">Свободный остаток</span>
              </div>
              <strong className="balance-card__amount">
                {formatAmount(overview.free_budget_in_base, overview.base_currency_code)}
              </strong>
              <div className="balance-card__sub">
                Нажми, чтобы выбрать как источник перевода. Сюда тоже можно вернуть деньги из категории.
              </div>
            </div>
          </div>
          <div className="dashboard-budget-sections">
            <div className="dashboard-budget-section">
              <div className="dashboard-budget-section__header">
                <div className="section__eyebrow">Категории</div>
                <button
                  className="btn btn--icon"
                  type="button"
                  onClick={() => setCreateDialogKind('regular')}
                  aria-label="Добавить категорию"
                  title="Добавить категорию"
                >
                  +
                </button>
              </div>
              {regularBudgetCategories.length === 0 ? (
                <p className="list-row__sub">Обычных категорий пока нет.</p>
              ) : (
                <ul>
                  {regularBudgetCategories.map((category) => {
                    const isDropTarget = dropTargetCategoryId === category.category_id;
                    const isActiveSource = activeSourceId === category.category_id;
                    const isValidTarget = activeSourceId !== null && activeSourceId !== category.category_id;

                    return (
                      <li
                        className={[
                          'dashboard-budget-row',
                          'list-row',
                          'list-row--interactive',
                          'list-row--draggable',
                          draggedCategoryId === category.category_id ? 'list-row--dragging' : '',
                          isActiveSource ? 'list-row--tap-selected' : '',
                          isDropTarget ? 'list-row--drop-target' : '',
                          isValidTarget ? 'list-row--valid-target' : '',
                        ].join(' ').trim()}
                        key={category.category_id}
                        draggable
                        role="button"
                        tabIndex={0}
                        onDragStart={(e) => handleDragStart(category, e)}
                        onDragEnd={handleDragEnd}
                        onClick={() => {
                          if (Date.now() < suppressCategoryClickUntilRef.current) return;
                          if (isActiveSource) {
                            setTapSourceId(null);
                          } else if (activeSourceId !== null) {
                            completeTransfer(activeSourceId, {
                              category_id: category.category_id,
                              name: category.name,
                              kind: category.kind,
                              currency_code: category.currency_code,
                            });
                          } else {
                            openCategoryDialog(category);
                          }
                        }}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            openCategoryDialog(category);
                          }
                        }}
                        onDragOver={(event) => {
                          if (activeSourceId === null || activeSourceId === category.category_id) return;
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
                        <div className="dashboard-budget-row__main">
                          <div className="list-row__title">{category.name}</div>
                          <div className="list-row__sub">
                            {isValidTarget
                              ? 'Нажми сюда, чтобы перевести'
                              : 'Нажми, чтобы редактировать'}
                          </div>
                        </div>
                        <div className="dashboard-budget-row__side">
                          <div className="list-row__value">
                            {formatAmount(category.balance, category.currency_code)}
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            <div className="dashboard-budget-section dashboard-budget-section--groups">
              <div className="dashboard-budget-section__header">
                <div className="section__eyebrow">Группы</div>
                <button
                  className="btn btn--icon"
                  type="button"
                  onClick={() => setCreateDialogKind('group')}
                  aria-label="Добавить группу"
                  title="Добавить группу"
                >
                  +
                </button>
              </div>
              {groupBudgetCategories.length === 0 ? (
                <p className="list-row__sub">Групп пока нет.</p>
              ) : (
                <ul>
                  {groupBudgetCategories.map((category) => {
                    const isDropTarget = dropTargetCategoryId === category.category_id;
                    const isValidTarget = activeSourceId !== null && activeSourceId !== category.category_id;
                    const groupMembers = groupMembersByGroupId[category.category_id] || [];
                    const groupComposition = groupMembers.length > 0
                      ? groupMembers
                          .map((member) => `${member.child_category_name} ${Number((member.share * 100).toFixed(2))}%`)
                          .join(' · ')
                      : 'Состав группы пока не настроен';
                    const groupBalance = groupMembers.length > 0
                      ? groupMembers.reduce(
                          (sum, member) => sum + (regularCategoryBalanceById[member.child_category_id] || 0),
                          0,
                        )
                      : 0;

                    return (
                      <li
                        className={[
                          'dashboard-budget-row',
                          'list-row',
                          'list-row--interactive',
                          'list-row--group',
                          isDropTarget ? 'list-row--drop-target' : '',
                          isValidTarget ? 'list-row--valid-target' : '',
                        ].join(' ').trim()}
                        key={category.category_id}
                        role="button"
                        tabIndex={0}
                        onDragEnd={handleDragEnd}
                        onClick={() => {
                          if (activeSourceId !== null) {
                            completeTransfer(activeSourceId, {
                              category_id: category.category_id,
                              name: category.name,
                              kind: category.kind,
                              currency_code: category.currency_code,
                            });
                          } else {
                            openCategoryDialog(category);
                          }
                        }}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            openCategoryDialog(category);
                          }
                        }}
                        onDragOver={(event) => {
                          if (activeSourceId === null || activeSourceId === category.category_id) return;
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
                        <div className="dashboard-budget-row__main">
                          <div className="list-row__title">{category.name}</div>
                          <div className="list-row__sub">
                            {isValidTarget
                              ? 'Нажми сюда, чтобы перевести'
                              : 'Группа распределения · нажми, чтобы редактировать состав'}
                          </div>
                          <div className="list-row__meta">{groupComposition}</div>
                        </div>
                        <div className="dashboard-budget-row__side">
                          <div className="list-row__value">
                            {formatAmount(groupBalance, category.currency_code)}
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        </div>
      </section>

      {transferSource && transferTarget && (
        <TransferDialog
          source={transferSource}
          target={transferTarget}
          baseCurrencyCode={overview.base_currency_code}
          onClose={() => { setTransferSource(null); setTransferTarget(null); }}
          onSuccess={() => void handleDialogSuccess()}
        />
      )}

      {selectedCategory && (
        <CategoryDialog
          category={selectedCategory}
          onClose={() => setSelectedCategory(null)}
          onSuccess={() => void handleDialogSuccess()}
          onTransfer={
            selectedCategory.kind === 'regular'
              ? () => handleCategoryTransfer(selectedCategory)
              : undefined
          }
        />
      )}

      {createDialogKind && (
        <CreateCategoryDialog
          kind={createDialogKind}
          onClose={() => setCreateDialogKind(null)}
          onSuccess={() => void handleDialogSuccess()}
        />
      )}
    </>
  );
}
