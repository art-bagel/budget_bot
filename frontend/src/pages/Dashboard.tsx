import { useEffect, useRef, useState } from 'react';

import {
  allocateBudget,
  allocateGroupBudget,
  archiveCategory,
  createCategory,
  fetchCategories,
  fetchDashboardOverview,
  fetchGroupMembers,
  replaceGroupMembers,
  updateCategory,
} from '../api';
import type {
  AllocateBudgetRequest,
  AllocateGroupBudgetRequest,
  Category,
  DashboardBudgetCategory,
  DashboardOverview as DashboardOverviewType,
  GroupMember,
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

interface GroupDraftRow {
  key: string;
  child_category_id: string;
  share_percent: string;
}


function createDraftRow(index: number): GroupDraftRow {
  return {
    key: 'draft-' + index,
    child_category_id: '',
    share_percent: '',
  };
}


function serializeGroupRows(rows: GroupDraftRow[]): string {
  return JSON.stringify(
    rows
      .filter((row) => row.child_category_id && row.share_percent && Number(row.share_percent) > 0)
      .map((row) => ({
        child_category_id: Number(row.child_category_id),
        share_percent: Number(Number(row.share_percent).toFixed(2)),
      }))
      .sort((left, right) => left.child_category_id - right.child_category_id),
  );
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
  const [selectedCategory, setSelectedCategory] = useState<DashboardBudgetCategory | null>(null);
  const [categoryNameDraft, setCategoryNameDraft] = useState('');
  const [categoryDialogError, setCategoryDialogError] = useState<string | null>(null);
  const [savingCategory, setSavingCategory] = useState(false);
  const [archivingCategory, setArchivingCategory] = useState(false);
  const suppressCategoryClickUntilRef = useRef(0);
  const groupSettingsRequestIdRef = useRef(0);
  const [groupRows, setGroupRows] = useState<GroupDraftRow[]>([createDraftRow(1)]);
  const [initialGroupRowsSnapshot, setInitialGroupRowsSnapshot] = useState('[]');
  const [groupRegularCategories, setGroupRegularCategories] = useState<Category[]>([]);
  const [loadingGroupSettings, setLoadingGroupSettings] = useState(false);
  const [groupMembersByGroupId, setGroupMembersByGroupId] = useState<Record<number, GroupMember[]>>({});
  const [createDialogKind, setCreateDialogKind] = useState<'regular' | 'group' | null>(null);
  const [createCategoryName, setCreateCategoryName] = useState('');
  const [createCategoryError, setCreateCategoryError] = useState<string | null>(null);
  const [creatingCategory, setCreatingCategory] = useState(false);

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
        if (cancelled) {
          return;
        }

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

  useEffect(() => {
    if (!selectedCategory || selectedCategory.kind !== 'group') {
      groupSettingsRequestIdRef.current += 1;
      setGroupRows([createDraftRow(1)]);
      setInitialGroupRowsSnapshot('[]');
      setGroupRegularCategories([]);
      setLoadingGroupSettings(false);
      return;
    }

    const requestId = groupSettingsRequestIdRef.current + 1;
    groupSettingsRequestIdRef.current = requestId;
    setLoadingGroupSettings(true);
    setCategoryDialogError(null);

    void Promise.all([
      fetchCategories(),
      fetchGroupMembers(selectedCategory.category_id),
    ])
      .then(([loadedCategories, members]) => {
        if (groupSettingsRequestIdRef.current !== requestId) {
          return;
        }

        const nextRows = members.length > 0
          ? members.map((member, index) => ({
              key: 'member-' + index + '-' + member.child_category_id,
              child_category_id: String(member.child_category_id),
              share_percent: String(Number((member.share * 100).toFixed(2))),
            }))
          : [createDraftRow(1)];

        setGroupRegularCategories(
          loadedCategories.filter((item) => item.kind === 'regular' && item.is_active),
        );
        setGroupRows(nextRows);
        setInitialGroupRowsSnapshot(serializeGroupRows(nextRows));
      })
      .catch((reason: any) => {
        if (groupSettingsRequestIdRef.current !== requestId) {
          return;
        }
        setCategoryDialogError(reason.message);
      })
      .finally(() => {
        if (groupSettingsRequestIdRef.current === requestId) {
          setLoadingGroupSettings(false);
        }
      });
  }, [selectedCategory]);

  const handleDragStart = (source: TransferSource) => {
    suppressCategoryClickUntilRef.current = Date.now() + 250;
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

  const openCategoryDialog = (category: DashboardBudgetCategory) => {
    if (Date.now() < suppressCategoryClickUntilRef.current) {
      return;
    }

    setSelectedCategory(category);
    setCategoryNameDraft(category.name);
    setCategoryDialogError(null);
  };

  const closeCategoryDialog = (force = false) => {
    if ((savingCategory || archivingCategory) && !force) {
      return;
    }

    setSelectedCategory(null);
    setCategoryNameDraft('');
    setCategoryDialogError(null);
  };

  const openCreateDialog = (kind: 'regular' | 'group') => {
    setCreateDialogKind(kind);
    setCreateCategoryName('');
    setCreateCategoryError(null);
  };

  const closeCreateDialog = (force = false) => {
    if (creatingCategory && !force) {
      return;
    }

    setCreateDialogKind(null);
    setCreateCategoryName('');
    setCreateCategoryError(null);
  };

  const handleCreateCategory = async () => {
    if (!createDialogKind || !createCategoryName.trim()) {
      return;
    }

    setCreatingCategory(true);
    setCreateCategoryError(null);

    try {
      await createCategory(createCategoryName.trim(), createDialogKind);
      closeCreateDialog(true);
      await loadOverview();
    } catch (reason: any) {
      setCreateCategoryError(reason.message);
    } finally {
      setCreatingCategory(false);
    }
  };

  const handleGroupRowChange = (
    rowKey: string,
    field: 'child_category_id' | 'share_percent',
    value: string,
  ) => {
    setGroupRows((prev) =>
      prev.map((row) => (row.key === rowKey ? { ...row, [field]: value } : row)),
    );
  };

  const addGroupRow = () => {
    setGroupRows((prev) => [...prev, createDraftRow(prev.length + 1)]);
  };

  const removeGroupRow = (rowKey: string) => {
    setGroupRows((prev) => {
      const nextRows = prev.filter((row) => row.key !== rowKey);
      return nextRows.length > 0 ? nextRows : [createDraftRow(1)];
    });
  };

  const validGroupRows = groupRows.filter(
    (row) => row.child_category_id && row.share_percent && Number(row.share_percent) > 0,
  );
  const totalSharePercent = validGroupRows.reduce(
    (acc, row) => acc + Number(row.share_percent || 0),
    0,
  );
  const groupRowsChanged = selectedCategory?.kind === 'group' &&
    serializeGroupRows(groupRows) !== initialGroupRowsSnapshot;
  const hasNameChanged = !!selectedCategory && categoryNameDraft.trim() !== selectedCategory.name;
  const canSaveGroupSettings = selectedCategory?.kind === 'group' &&
    !loadingGroupSettings &&
    validGroupRows.length > 0 &&
    Math.abs(totalSharePercent - 100) < 0.001;
  const canSubmitCategoryChanges =
    !savingCategory &&
    !archivingCategory &&
    !!selectedCategory &&
    !!categoryNameDraft.trim() &&
    (hasNameChanged || groupRowsChanged) &&
    (selectedCategory.kind !== 'group' || !groupRowsChanged || canSaveGroupSettings);

  const handleCategorySubmit = async () => {
    if (!selectedCategory || !categoryNameDraft.trim()) {
      return;
    }

    if (selectedCategory.kind === 'group' && groupRowsChanged && !canSaveGroupSettings) {
      setCategoryDialogError('Для группы нужна хотя бы одна категория, а сумма долей должна быть ровно 100%.');
      return;
    }

    setSavingCategory(true);
    setCategoryDialogError(null);

    try {
      if (hasNameChanged) {
        await updateCategory(selectedCategory.category_id, categoryNameDraft.trim());
      }

      if (selectedCategory.kind === 'group' && groupRowsChanged) {
        await replaceGroupMembers(
          selectedCategory.category_id,
          validGroupRows.map((row) => Number(row.child_category_id)),
          validGroupRows.map((row) => Number(row.share_percent) / 100),
        );
      }

      closeCategoryDialog(true);
      await loadOverview();
    } catch (reason: any) {
      setCategoryDialogError(reason.message);
    } finally {
      setSavingCategory(false);
    }
  };

  const handleCategoryArchive = async () => {
    if (!selectedCategory) {
      return;
    }

    setArchivingCategory(true);
    setCategoryDialogError(null);

    try {
      await archiveCategory(selectedCategory.category_id);
      closeCategoryDialog(true);
      await loadOverview();
    } catch (reason: any) {
      setCategoryDialogError(reason.message);
    } finally {
      setArchivingCategory(false);
    }
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
  const regularBudgetCategories = overview.budget_categories.filter((category) => category.kind === 'regular');
  const groupBudgetCategories = overview.budget_categories.filter((category) => category.kind === 'group');
  const regularCategoryBalanceById = regularBudgetCategories.reduce<Record<number, number>>((acc, category) => {
    acc[category.category_id] = category.balance;
    return acc;
  }, {});

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
          <div className="dashboard-budget-sections">
            <div className="dashboard-budget-section">
              <div className="dashboard-budget-section__header">
                <div className="section__eyebrow">Категории</div>
                <button
                  className="btn btn--icon"
                  type="button"
                  onClick={() => openCreateDialog('regular')}
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
                    const isRegular = true;
                    const isDropTarget = dropTargetCategoryId === category.category_id;

                    return (
                      <li
                        className={[
                          'list-row',
                          'list-row--interactive',
                          'list-row--draggable',
                          draggedCategoryId === category.category_id ? 'list-row--dragging' : '',
                          isDropTarget ? 'list-row--drop-target' : '',
                        ].join(' ').trim()}
                        key={category.category_id}
                        draggable
                        role="button"
                        tabIndex={0}
                        onDragStart={() => handleDragStart(category)}
                        onDragEnd={handleDragEnd}
                        onClick={() => openCategoryDialog(category)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            openCategoryDialog(category);
                          }
                        }}
                        onDragOver={(event) => {
                          if (draggedCategoryId === null || draggedCategoryId === category.category_id) {
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
                            Обычная категория · можно перетаскивать · нажми, чтобы редактировать
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
              )}
            </div>

            <div className="dashboard-budget-section dashboard-budget-section--groups">
              <div className="dashboard-budget-section__header">
                <div className="section__eyebrow">Группы</div>
                <button
                  className="btn btn--icon"
                  type="button"
                  onClick={() => openCreateDialog('group')}
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
                          'list-row',
                          'list-row--interactive',
                          'list-row--group',
                          isDropTarget ? 'list-row--drop-target' : '',
                        ].join(' ').trim()}
                        key={category.category_id}
                        role="button"
                        tabIndex={0}
                        onDragEnd={handleDragEnd}
                        onClick={() => openCategoryDialog(category)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            openCategoryDialog(category);
                          }
                        }}
                        onDragOver={(event) => {
                          if (draggedCategoryId === null || draggedCategoryId === category.category_id) {
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
                            Группа распределения · можно бросить сюда · нажми, чтобы редактировать состав
                          </div>
                          <div className="list-row__meta">{groupComposition}</div>
                        </div>
                        <div style={{ textAlign: 'right' }}>
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

      {selectedCategory && (
        <div className="modal-backdrop" onClick={() => closeCategoryDialog()}>
          <div className="modal-card" onClick={(event) => event.stopPropagation()}>
            <div className="section__header">
              <div>
                <div className="section__eyebrow">Категория</div>
                <h2 className="section__title">Редактирование категории</h2>
              </div>
              <span className="pill">{selectedCategory.kind}</span>
            </div>

            <div className="operations-note">
              Тут можно переименовать категорию или убрать её в архив.
            </div>

            <div className="form-row">
              <input
                className="input"
                type="text"
                placeholder="Название категории"
                value={categoryNameDraft}
                onChange={(event) => setCategoryNameDraft(event.target.value)}
                onKeyDown={(event) => event.key === 'Enter' && !savingCategory && handleCategorySubmit()}
                style={{ flex: 1 }}
              />
            </div>

            {selectedCategory.kind === 'group' && (
              <>
                <div className="operations-note">
                  Для группы можно менять состав и доли распределения. Сумма долей должна быть ровно 100%.
                </div>

                <div className="form-row">
                  <span className="tag tag--neutral">
                    Сумма долей: {totalSharePercent.toFixed(2)}%
                  </span>
                  {loadingGroupSettings && <span className="tag tag--neutral">Загружаем состав группы...</span>}
                </div>

                {!loadingGroupSettings && groupRows.map((row) => (
                  <div className="form-row form-row--group-editor" key={row.key}>
                    <select
                      className="input"
                      value={row.child_category_id}
                      onChange={(event) => handleGroupRowChange(row.key, 'child_category_id', event.target.value)}
                      disabled={savingCategory}
                    >
                      <option value="">Выберите категорию</option>
                      {groupRegularCategories.map((category) => (
                        <option key={category.id} value={category.id}>
                          {category.name}
                        </option>
                      ))}
                    </select>
                    <input
                      className="input"
                      type="text"
                      inputMode="decimal"
                      placeholder="Доля, %"
                      value={row.share_percent}
                      onChange={(event) => handleGroupRowChange(row.key, 'share_percent', event.target.value)}
                      disabled={savingCategory}
                    />
                    <button
                      className="btn"
                      type="button"
                      onClick={() => removeGroupRow(row.key)}
                      disabled={savingCategory}
                    >
                      Убрать
                    </button>
                  </div>
                ))}

                {!loadingGroupSettings && (
                  <div className="form-row">
                    <button
                      className="btn"
                      type="button"
                      onClick={addGroupRow}
                      disabled={savingCategory}
                    >
                      Добавить категорию
                    </button>
                  </div>
                )}
              </>
            )}

            {categoryDialogError && (
              <p style={{ color: 'var(--tag-out-fg)', fontSize: '0.85rem', marginTop: 4 }}>
                {categoryDialogError}
              </p>
            )}

            <div className="modal-actions modal-actions--split">
              <button
                className="btn btn--danger"
                type="button"
                onClick={handleCategoryArchive}
                disabled={savingCategory || archivingCategory}
              >
                {archivingCategory ? '...' : 'В архив'}
              </button>
              <div className="modal-actions-group">
                <button
                  className="btn"
                  type="button"
                  onClick={() => closeCategoryDialog()}
                  disabled={savingCategory || archivingCategory}
                >
                  Отмена
                </button>
                <button
                  className="btn btn--primary"
                  type="button"
                  onClick={handleCategorySubmit}
                  disabled={!canSubmitCategoryChanges}
                >
                  {savingCategory ? '...' : 'Сохранить'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {createDialogKind && (
        <div className="modal-backdrop" onClick={() => closeCreateDialog()}>
          <div className="modal-card modal-card--compact" onClick={(event) => event.stopPropagation()}>
            <div className="section__header">
              <div>
                <div className="section__eyebrow">Создание</div>
                <h2 className="section__title">
                  {createDialogKind === 'group' ? 'Новая группа' : 'Новая категория'}
                </h2>
              </div>
            </div>

            <div className="operations-note">
              {createDialogKind === 'group'
                ? 'Создай группу, затем нажми на неё, чтобы настроить состав и доли.'
                : 'Добавь новую категорию, чтобы потом распределять по ней бюджет.'}
            </div>

            <div className="form-row">
              <input
                className="input"
                type="text"
                placeholder={createDialogKind === 'group' ? 'Название группы' : 'Название категории'}
                value={createCategoryName}
                onChange={(event) => setCreateCategoryName(event.target.value)}
                onKeyDown={(event) => event.key === 'Enter' && !creatingCategory && handleCreateCategory()}
                style={{ flex: 1 }}
              />
            </div>

            {createCategoryError && (
              <p style={{ color: 'var(--tag-out-fg)', fontSize: '0.85rem', marginTop: 4 }}>
                {createCategoryError}
              </p>
            )}

            <div className="modal-actions">
              <button
                className="btn"
                type="button"
                onClick={() => closeCreateDialog()}
                disabled={creatingCategory}
              >
                Отмена
              </button>
              <button
                className="btn btn--primary"
                type="button"
                onClick={handleCreateCategory}
                disabled={creatingCategory || !createCategoryName.trim()}
              >
                {creatingCategory ? '...' : 'Создать'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
