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
import ExpenseDialog from '../components/ExpenseDialog';
import IncomeDialog from '../components/IncomeDialog';


export default function Dashboard({ user }: { user: UserContext }) {
  const [overview, setOverview] = useState<DashboardOverviewType | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showBankDetail, setShowBankDetail] = useState(false);
  const [showIncomeDialog, setShowIncomeDialog] = useState(false);

  useEffect(() => {
    if (showBankDetail) {
      document.body.classList.add('modal-open');
      return () => document.body.classList.remove('modal-open');
    }
  }, [showBankDetail]);
  const [draggedCategoryId, setDraggedCategoryId] = useState<number | null>(null);
  const [dropTargetCategoryId, setDropTargetCategoryId] = useState<number | null>(null);
  const [swipeSourceId, setSwipeSourceId] = useState<number | null>(null);
  const [expenseCategory, setExpenseCategory] = useState<DashboardBudgetCategory | null>(null);
  const [transferSource, setTransferSource] = useState<TransferSource | null>(null);
  const [transferTarget, setTransferTarget] = useState<TransferTarget | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<DashboardBudgetCategory | null>(null);
  const suppressClickUntilRef = useRef(0);
  const [groupMembersByGroupId, setGroupMembersByGroupId] = useState<Record<number, GroupMember[]>>({});
  const [createDialogKind, setCreateDialogKind] = useState<'regular' | 'group' | null>(null);

  const activeSourceId = draggedCategoryId ?? swipeSourceId;

  /* ── swipe tracking ─────────────────────────────── */

  const swipeRef = useRef<{
    startX: number;
    startY: number;
    sourceId: number;
    kind: 'regular' | 'free_budget';
    category: DashboardBudgetCategory | null;
    decided: boolean;
    isHorizontal: boolean;
    element: HTMLElement | null;
  } | null>(null);

  const handleSwipeStart = (
    sourceId: number,
    kind: 'regular' | 'free_budget',
    category: DashboardBudgetCategory | null,
    e: React.TouchEvent,
  ) => {
    swipeRef.current = {
      startX: e.touches[0].clientX,
      startY: e.touches[0].clientY,
      sourceId,
      kind,
      category,
      decided: false,
      isHorizontal: false,
      element: e.currentTarget as HTMLElement,
    };
  };

  const handleSwipeMove = (e: React.TouchEvent) => {
    const s = swipeRef.current;
    if (!s || !s.element) return;

    const touch = e.touches[0];
    const dx = touch.clientX - s.startX;
    const dy = touch.clientY - s.startY;

    if (!s.decided && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) {
      s.decided = true;
      s.isHorizontal = Math.abs(dx) > Math.abs(dy);
    }

    if (s.isHorizontal) {
      // free_budget: only left swipe; regular: both directions
      const minOffset = -80;
      const maxOffset = s.kind === 'regular' ? 80 : 0;
      const offset = Math.min(maxOffset, Math.max(minOffset, dx));
      s.element.style.transform = `translateX(${offset}px)`;
      s.element.style.transition = 'none';
    }
  };

  const handleSwipeEnd = (e: React.TouchEvent) => {
    const s = swipeRef.current;
    swipeRef.current = null;
    if (!s) return;

    if (s.element) {
      s.element.style.transition = 'transform 0.2s ease';
      s.element.style.transform = '';
      const el = s.element;
      setTimeout(() => { el.style.transition = ''; }, 200);
    }

    if (s.decided && s.isHorizontal) {
      suppressClickUntilRef.current = Date.now() + 300;
      const dx = e.changedTouches[0].clientX - s.startX;
      if (dx < -50) {
        // Left swipe → transfer source
        setSwipeSourceId(s.sourceId);
        navigator.vibrate?.(20);
      } else if (dx > 50 && s.kind === 'regular' && s.category) {
        // Right swipe → expense
        setExpenseCategory(s.category);
        navigator.vibrate?.(20);
      }
    }
  };

  /* ── data loading ───────────────────────────────── */

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

  /* ── desktop DnD handlers ──────────────────────── */

  const handleDragStart = (source: TransferSource, event: React.DragEvent) => {
    event.dataTransfer.setData('text/plain', '');
    event.dataTransfer.effectAllowed = 'move';
    suppressClickUntilRef.current = Date.now() + 250;
    setDraggedCategoryId(source.category_id);
  };

  const handleDragEnd = () => {
    setDraggedCategoryId(null);
    setDropTargetCategoryId(null);
  };

  /* ── shared transfer logic ─────────────────────── */

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
      setSwipeSourceId(null);
      return;
    }

    setTransferSource(source);
    setTransferTarget(target);
    setDraggedCategoryId(null);
    setDropTargetCategoryId(null);
    setSwipeSourceId(null);
  };

  const handleDropOnCategory = (target: TransferTarget) => {
    if (!draggedCategoryId) {
      handleDragEnd();
      return;
    }
    completeTransfer(draggedCategoryId, target);
  };

  const openCategoryDialog = (category: DashboardBudgetCategory) => {
    if (Date.now() < suppressClickUntilRef.current) return;
    setSelectedCategory(category);
  };

  const handleDialogSuccess = async () => {
    setTransferSource(null);
    setTransferTarget(null);
    setSelectedCategory(null);
    setCreateDialogKind(null);
    setSwipeSourceId(null);
    setExpenseCategory(null);
    await loadOverview();
  };

  /* ── render ─────────────────────────────────────── */

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
  const fxResultSummary = overview.fx_result_in_base === 0
    ? null
    : `Включая курсовую разницу ${formatAmount(overview.fx_result_in_base, overview.base_currency_code)}`;
  const regularCategoryBalanceById = regularBudgetCategories.reduce<Record<number, number>>((acc, category) => {
    acc[category.category_id] = category.balance;
    return acc;
  }, {});

  const swipeSourceName = swipeSourceId !== null
    ? (swipeSourceId === user.unallocated_category_id
        ? 'Свободный остаток'
        : overview.budget_categories.find((c) => c.category_id === swipeSourceId)?.name || '')
    : '';

  return (
    <>
      <h1 className="page-title">Обзор</h1>

      <section className="metrics">
        <article
          className="metric-card metric-card--accent metric-card--clickable"
          role="button"
          tabIndex={0}
          onClick={() => setShowBankDetail(true)}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setShowBankDetail(true); }}
        >
          <span className="metric-card__label">Банк по себестоимости</span>
          <strong className="metric-card__value">
            {formatAmount(overview.total_bank_historical_in_base, overview.base_currency_code)}
          </strong>
        </article>
        <article className="metric-card">
          <span className="metric-card__label">Бюджет по категориям</span>
          <strong className="metric-card__value">
            {formatAmount(overview.total_budget_in_base, overview.base_currency_code)}
          </strong>
        </article>
      </section>

      <section className="section">
        <div className="section__header">
          <div>
            <div className="section__eyebrow">Бюджет</div>
            <h2 className="section__title">Как распределены деньги по категориям</h2>
          </div>
        </div>
        <div className="panel">
          <div className={`transfer-banner${swipeSourceId !== null ? ' transfer-banner--active' : ''}`}>
            {swipeSourceId !== null ? (
              <>
                <span>
                  Из <strong>{swipeSourceName}</strong> — нажми куда перевести
                </span>
                <button
                  className="btn btn--small"
                  type="button"
                  onClick={() => setSwipeSourceId(null)}
                >
                  Отмена
                </button>
              </>
            ) : (
              <span>Свайп влево — перевод бюджета. Свайп вправо по категории — расход.</span>
            )}
          </div>
          <div className="dashboard-transfer-source">
            <div
              className={[
                'balance-card',
                'balance-card--draggable',
                'swipeable',
                activeSourceId !== null && activeSourceId !== freeBudgetSource.category_id
                  ? 'balance-card--valid-target'
                  : '',
                activeSourceId === freeBudgetSource.category_id ? 'balance-card--active-source' : '',
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
              onTouchStart={(e) => handleSwipeStart(freeBudgetSource.category_id, 'free_budget', null, e)}
              onTouchMove={handleSwipeMove}
              onTouchEnd={handleSwipeEnd}
              onClick={() => {
                if (Date.now() < suppressClickUntilRef.current) return;
                if (swipeSourceId === freeBudgetSource.category_id) {
                  setSwipeSourceId(null);
                } else if (activeSourceId !== null) {
                  completeTransfer(activeSourceId, freeBudgetTarget);
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
                {fxResultSummary || 'Свайпни влево для перевода. Сюда тоже можно вернуть из категории.'}
              </div>
              {fxResultSummary ? (
                <div className="balance-card__hint">
                  Свайпни влево для перевода. Сюда тоже можно вернуть из категории.
                </div>
              ) : null}
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
                          'swipeable',
                          draggedCategoryId === category.category_id ? 'list-row--dragging' : '',
                          isActiveSource ? 'list-row--active-source' : '',
                          isDropTarget ? 'list-row--drop-target' : '',
                          isValidTarget ? 'list-row--valid-target' : '',
                        ].join(' ').trim()}
                        key={category.category_id}
                        draggable
                        role="button"
                        tabIndex={0}
                        onDragStart={(e) => handleDragStart(category, e)}
                        onDragEnd={handleDragEnd}
                        onTouchStart={(e) => handleSwipeStart(category.category_id, 'regular', category, e)}
                        onTouchMove={handleSwipeMove}
                        onTouchEnd={handleSwipeEnd}
                        onClick={() => {
                          if (Date.now() < suppressClickUntilRef.current) return;
                          if (swipeSourceId === category.category_id) {
                            setSwipeSourceId(null);
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
                              ? 'Нажми, чтобы перевести сюда'
                              : '← перевод · → расход · нажми для редактирования'}
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
                              ? 'Нажми, чтобы перевести сюда'
                              : 'Группа распределения · нажми для редактирования'}
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
        />
      )}

      {expenseCategory && (
        <ExpenseDialog
          category={expenseCategory}
          user={user}
          onClose={() => setExpenseCategory(null)}
          onSuccess={() => void handleDialogSuccess()}
        />
      )}

      {createDialogKind && (
        <CreateCategoryDialog
          kind={createDialogKind}
          onClose={() => setCreateDialogKind(null)}
          onSuccess={() => void handleDialogSuccess()}
        />
      )}

      {showIncomeDialog && (
        <IncomeDialog
          user={user}
          onClose={() => setShowIncomeDialog(false)}
          onSuccess={() => { setShowIncomeDialog(false); void loadOverview(); }}
        />
      )}

      {showBankDetail && (
        <div className="modal-backdrop" onClick={() => setShowBankDetail(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="section__header">
                <div>
                  <div className="section__eyebrow">Банк</div>
                  <h2 className="section__title">Сколько денег лежит по валютам</h2>
                </div>
              </div>
            </div>
            <div className="modal-body">
              <ul className="bank-detail-list">
                {overview.bank_balances.map((balance) => (
                  <li className="bank-detail-row" key={balance.currency_code}>
                    <div className="bank-detail-row__main">
                      <span className="pill">{balance.currency_code}</span>
                      <strong className="bank-detail-row__amount">
                        {formatAmount(balance.amount, balance.currency_code)}
                      </strong>
                    </div>
                    <div className="bank-detail-row__sub">
                      Себестоимость: {formatAmount(balance.historical_cost_in_base, overview.base_currency_code)}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
            <div className="modal-actions modal-actions--split">
              <button className="btn" type="button" onClick={() => setShowBankDetail(false)}>
                Закрыть
              </button>
              <button
                className="btn btn--primary"
                type="button"
                onClick={() => { setShowBankDetail(false); setShowIncomeDialog(true); }}
              >
                Пополнить
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
