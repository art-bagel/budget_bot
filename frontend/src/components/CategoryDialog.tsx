import React, { useEffect, useRef, useState } from 'react';
import EmojiPicker from './EmojiPicker';
import { parseCategoryIcon, buildCategoryName } from '../utils/categoryIcon';

import {
  archiveCategory,
  fetchCategoryParentGroups,
  fetchCategories,
  fetchGroupMembers,
  replaceGroupMembers,
  updateCategory,
  fetchCategoryAccountCurrencies,
  fetchScheduledExpenses,
  createScheduledExpense,
  deleteScheduledExpense,
} from '../api';
import { useModalOpen } from '../hooks/useModalOpen';
import type {
  AccountCurrency,
  Category,
  DashboardBudgetCategory,
  ParentGroup,
  ScheduledExpense,
} from '../types';

const DAY_NAMES = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

interface MonthDayPickerProps {
  selected: number;
  onChange: (day: number) => void;
  disabled: boolean;
}

function MonthDayPicker({ selected, onChange, disabled }: MonthDayPickerProps) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2, marginTop: 4 }}>
      {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
        <button
          key={d}
          type="button"
          onClick={() => onChange(d)}
          disabled={disabled}
          style={{
            padding: '5px 0',
            fontSize: '0.85rem',
            minWidth: 0,
            background: selected === d ? 'var(--bg-accent)' : 'transparent',
            color: selected === d ? 'var(--text-on-accent, #fff)' : 'var(--text-primary)',
            border: 'none',
            borderRadius: 8,
            cursor: disabled ? 'default' : 'pointer',
            outline: 'none',
          }}
        >
          {d}
        </button>
      ))}
    </div>
  );
}

function formatScheduleLabel(s: ScheduledExpense): string {
  if (s.frequency === 'weekly' && s.day_of_week != null) {
    return `Каждую неделю · ${DAY_NAMES[s.day_of_week - 1]}`;
  }
  if (s.frequency === 'monthly' && s.day_of_month != null) {
    return `Каждый месяц · ${s.day_of_month}-го`;
  }
  return s.frequency;
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


interface Props {
  category: DashboardBudgetCategory;
  onClose: () => void;
  onSuccess: () => void;
}


export default function CategoryDialog({ category, onClose, onSuccess }: Props) {
  useModalOpen();
  const { icon: initialIcon, displayName: initialDisplayName } = parseCategoryIcon(category.name);
  const [nameDraft, setNameDraft] = useState(initialDisplayName);
  const [iconDraft, setIconDraft] = useState<string | null>(initialIcon);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);

  const [groupRows, setGroupRows] = useState<GroupDraftRow[]>([createDraftRow(1)]);
  const [initialGroupRowsSnapshot, setInitialGroupRowsSnapshot] = useState('[]');
  const [groupSelectableCategories, setGroupSelectableCategories] = useState<Category[]>([]);
  const [parentGroups, setParentGroups] = useState<ParentGroup[]>([]);
  const [loadingGroupSettings, setLoadingGroupSettings] = useState(false);
  const groupRequestIdRef = useRef(0);
  const parentGroupsRequestIdRef = useRef(0);

  // --- Scheduled expenses ---
  const [schedules, setSchedules] = useState<ScheduledExpense[]>([]);
  const [accountCurrencies, setAccountCurrencies] = useState<AccountCurrency[]>([]);
  const [loadingSchedules, setLoadingSchedules] = useState(false);
  const [showScheduleForm, setShowScheduleForm] = useState(false);
  const [scheduleError, setScheduleError] = useState<string | null>(null);
  const [savingSchedule, setSavingSchedule] = useState(false);
  const [deletingScheduleId, setDeletingScheduleId] = useState<number | null>(null);

  const [sfCurrencyCode, setSfCurrencyCode] = useState(category.currency_code);
  const [sfAmount, setSfAmount] = useState('');
  const [sfFrequency, setSfFrequency] = useState<'weekly' | 'monthly'>('monthly');
  const [sfDayOfWeek, setSfDayOfWeek] = useState(1);
  const [sfDayOfMonth, setSfDayOfMonth] = useState(1);
  const [sfComment, setSfComment] = useState('');

  // Load schedules and available account currencies for regular categories
  useEffect(() => {
    if (category.kind !== 'regular') return;

    setLoadingSchedules(true);
    void Promise.all([
      fetchScheduledExpenses(category.category_id),
      fetchCategoryAccountCurrencies(category.category_id),
    ])
      .then(([loadedSchedules, loadedCurrencies]) => {
        setSchedules(loadedSchedules);
        setAccountCurrencies(loadedCurrencies);
        // Default to the first available currency (sorted by balance desc), fallback to category base
        if (loadedCurrencies.length > 0) {
          setSfCurrencyCode(loadedCurrencies[0].code);
        }
      })
      .catch(() => {/* non-critical */})
      .finally(() => setLoadingSchedules(false));
  }, [category.category_id, category.kind]);

  const handleAddSchedule = async () => {
    if (!sfAmount || Number(sfAmount) <= 0) {
      setScheduleError('Укажите сумму больше нуля.');
      return;
    }
    setSavingSchedule(true);
    setScheduleError(null);
    try {
      await createScheduledExpense({
        category_id: category.category_id,
        amount: Number(sfAmount),
        currency_code: sfCurrencyCode,
        frequency: sfFrequency,
        day_of_week: sfFrequency === 'weekly' ? sfDayOfWeek : undefined,
        day_of_month: sfFrequency === 'monthly' ? sfDayOfMonth : undefined,
        comment: sfComment.trim() || undefined,
      });
      const updated = await fetchScheduledExpenses(category.category_id);
      setSchedules(updated);
      setShowScheduleForm(false);
      setSfAmount('');
      setSfComment('');
      setSfCurrencyCode(category.currency_code);
    } catch (reason: unknown) {
      setScheduleError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSavingSchedule(false);
    }
  };

  const handleDeleteSchedule = async (scheduleId: number) => {
    setDeletingScheduleId(scheduleId);
    try {
      await deleteScheduledExpense(scheduleId);
      setSchedules((prev) => prev.filter((s) => s.id !== scheduleId));
    } catch (reason: unknown) {
      setScheduleError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setDeletingScheduleId(null);
    }
  };

  useEffect(() => {
    const requestId = parentGroupsRequestIdRef.current + 1;
    parentGroupsRequestIdRef.current = requestId;

    void fetchCategoryParentGroups(category.category_id)
      .then((groups) => {
        if (parentGroupsRequestIdRef.current !== requestId) return;
        setParentGroups(groups);
      })
      .catch(() => {
        if (parentGroupsRequestIdRef.current !== requestId) return;
        setParentGroups([]);
      });
  }, [category.category_id]);

  useEffect(() => {
    if (category.kind !== 'group') return;

    const requestId = groupRequestIdRef.current + 1;
    groupRequestIdRef.current = requestId;
    setLoadingGroupSettings(true);
    setError(null);

    void Promise.all([
      fetchCategories(),
      fetchGroupMembers(category.category_id),
    ])
      .then(([loadedCategories, members]) => {
        if (groupRequestIdRef.current !== requestId) return;

        const nextRows = members.length > 0
          ? members.map((member, index) => ({
              key: 'member-' + index + '-' + member.child_category_id,
              child_category_id: String(member.child_category_id),
              share_percent: String(Number((member.share * 100).toFixed(2))),
            }))
          : [createDraftRow(1)];

        setGroupSelectableCategories(
          loadedCategories.filter(
            (item) => item.is_active && item.kind !== 'system' && item.id !== category.category_id,
          ),
        );
        setGroupRows(nextRows);
        setInitialGroupRowsSnapshot(serializeGroupRows(nextRows));
      })
      .catch((reason: unknown) => {
        if (groupRequestIdRef.current !== requestId) return;
        setError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => {
        if (groupRequestIdRef.current === requestId) {
          setLoadingGroupSettings(false);
        }
      });
  }, [category.category_id, category.kind]);

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
  const groupRowsChanged = category.kind === 'group' &&
    serializeGroupRows(groupRows) !== initialGroupRowsSnapshot;
  const hasNameChanged = buildCategoryName(iconDraft, nameDraft) !== category.name;
  const canSaveGroupSettings = category.kind === 'group' &&
    !loadingGroupSettings &&
    validGroupRows.length > 0 &&
    Math.abs(totalSharePercent - 100) < 0.001;
  const canSubmit =
    !saving &&
    !archiving &&
    !!nameDraft.trim() &&
    (category.kind !== 'group' || !groupRowsChanged || canSaveGroupSettings);

  const handleSubmit = async () => {
    if (!nameDraft.trim()) return;
    const fullName = buildCategoryName(iconDraft, nameDraft);

    if (category.kind === 'group' && groupRowsChanged && !canSaveGroupSettings) {
      setError('Для группы нужна хотя бы одна категория, а сумма долей должна быть ровно 100%.');
      return;
    }

    setSaving(true);
    setError(null);

    try {
      if (hasNameChanged) {
        await updateCategory(category.category_id, fullName);
      }

      if (category.kind === 'group' && groupRowsChanged) {
        await replaceGroupMembers(
          category.category_id,
          validGroupRows.map((row) => Number(row.child_category_id)),
          validGroupRows.map((row) => Number(row.share_percent) / 100),
        );
      }

      onSuccess();
      onClose();
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSaving(false);
    }
  };

  const handleArchive = async () => {
    if (parentGroups.length > 0) {
      setError(`Нельзя архивировать, пока элемент входит в группы: ${parentGroups.map((group) => group.group_name).join(', ')}.`);
      setConfirmArchive(false);
      return;
    }

    if (!confirmArchive) {
      setError(null);
      setConfirmArchive(true);
      return;
    }

    setArchiving(true);
    setError(null);

    try {
      await archiveCategory(category.category_id);
      onSuccess();
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setArchiving(false);
    }
  };

  const isBusy = saving || archiving;

  return (
    <div className="modal-backdrop" onClick={() => !isBusy && onClose()}>
      <div className="modal-card" onClick={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <div className="section__header">
            <div>
              <div className="section__eyebrow">Категория</div>
              <h2 className="section__title">Редактирование категории</h2>
            </div>
            <span className="pill">{category.kind}</span>
          </div>
        </div>

        <div className="modal-body">
          <div className="operations-note">
            Тут можно переименовать категорию или убрать её в архив.
          </div>

          <div className="form-row">
            <button
              type="button"
              className="category-icon-btn"
              onClick={() => setShowEmojiPicker((v) => !v)}
              aria-label="Выбрать иконку"
              title="Выбрать иконку"
            >
              {iconDraft ?? '＋'}
            </button>
            <input
              className="input"
              type="text"
              placeholder="Название категории"
              value={nameDraft}
              onChange={(event) => setNameDraft(event.target.value)}
              onKeyDown={(event) => event.key === 'Enter' && !saving && handleSubmit()}
              style={{ flex: 1 }}
            />
          </div>

          {showEmojiPicker && (
            <div className="form-row" style={{ display: 'block', paddingTop: 0 }}>
              <EmojiPicker selected={iconDraft} onSelect={(e) => { setIconDraft(e); if (e) setShowEmojiPicker(false); }} />
            </div>
          )}

          {category.kind === 'group' && (
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
                    disabled={saving}
                  >
                    <option value="">Выберите категорию</option>
                    {groupSelectableCategories.map((cat) => (
                      <option key={cat.id} value={cat.id}>
                        {cat.kind === 'group' ? `${cat.name} · группа` : cat.name}
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
                    disabled={saving}
                  />
                  <button
                    className="btn"
                    type="button"
                    onClick={() => removeGroupRow(row.key)}
                    disabled={saving}
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
                    disabled={saving}
                  >
                    Добавить категорию
                  </button>
                </div>
              )}
            </>
          )}

          {category.kind === 'regular' && (
            <>
              <div className="operations-note" style={{ marginTop: 12 }}>
                <strong>Расписание списаний</strong>
              </div>

              {loadingSchedules && (
                <div className="form-row">
                  <span className="tag tag--neutral">Загружаем...</span>
                </div>
              )}

              {!loadingSchedules && schedules.map((s) => (
                <div
                  key={s.id}
                  className="form-row"
                  style={{ justifyContent: 'space-between', alignItems: 'center', gap: 8 }}
                >
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1 }}>
                    <span style={{ fontWeight: 500, fontSize: '0.9rem' }}>
                      {s.amount} {s.currency_code}
                    </span>
                    <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary, #888)' }}>
                      {formatScheduleLabel(s)}
                      {s.comment ? ` · ${s.comment}` : ''}
                    </span>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary, #888)' }}>
                      Следующее: {s.next_run_at}
                    </span>
                    {s.last_error && (
                      <span style={{ fontSize: '0.75rem', color: 'var(--tag-out-fg)' }}>
                        Ошибка: {s.last_error}
                      </span>
                    )}
                  </div>
                  <button
                    className="btn btn--danger"
                    type="button"
                    style={{ flexShrink: 0 }}
                    onClick={() => handleDeleteSchedule(s.id)}
                    disabled={deletingScheduleId === s.id}
                  >
                    {deletingScheduleId === s.id ? '...' : 'Удалить'}
                  </button>
                </div>
              ))}

              {!loadingSchedules && !showScheduleForm && (
                <div className="form-row">
                  <button
                    className="btn"
                    type="button"
                    onClick={() => { setShowScheduleForm(true); setScheduleError(null); }}
                  >
                    + Добавить расписание
                  </button>
                </div>
              )}

              {showScheduleForm && (
                <>
                  <div className="form-row">
                    <input
                      className="input"
                      type="text"
                      inputMode="decimal"
                      placeholder="Сумма"
                      value={sfAmount}
                      onChange={(e) => setSfAmount(e.target.value)}
                      disabled={savingSchedule}
                      style={{ flex: 1 }}
                    />
                    <select
                      className="input"
                      value={sfCurrencyCode}
                      onChange={(e) => setSfCurrencyCode(e.target.value)}
                      disabled={savingSchedule || accountCurrencies.length === 0}
                      style={{ width: 90 }}
                    >
                      {accountCurrencies.length === 0
                        ? <option value={category.currency_code}>{category.currency_code}</option>
                        : accountCurrencies.map((c) => (
                            <option key={c.code} value={c.code}>{c.code}</option>
                          ))
                      }
                    </select>
                  </div>

                  <div className="form-row">
                    {(['monthly', 'weekly'] as const).map((freq) => (
                      <button
                        key={freq}
                        type="button"
                        onClick={() => setSfFrequency(freq)}
                        disabled={savingSchedule}
                        style={{
                          flex: 1,
                          padding: '8px 12px',
                          fontSize: '0.9rem',
                          background: sfFrequency === freq ? 'var(--bg-accent)' : 'transparent',
                          color: sfFrequency === freq ? 'var(--text-on-accent, #fff)' : 'var(--text-primary)',
                          border: 'none',
                          borderRadius: 8,
                          cursor: savingSchedule ? 'default' : 'pointer',
                          outline: 'none',
                        }}
                      >
                        {freq === 'monthly' ? 'Ежемесячно' : 'Еженедельно'}
                      </button>
                    ))}
                  </div>

                  {sfFrequency === 'monthly' && (
                    <MonthDayPicker
                      selected={sfDayOfMonth}
                      onChange={setSfDayOfMonth}
                      disabled={savingSchedule}
                    />
                  )}

                  {sfFrequency === 'weekly' && (
                    <div className="form-row" style={{ gap: 4 }}>
                      {DAY_NAMES.map((name, i) => (
                        <button
                          key={i}
                          type="button"
                          onClick={() => setSfDayOfWeek(i + 1)}
                          disabled={savingSchedule}
                          style={{
                            flex: 1,
                            minWidth: 0,
                            padding: '6px 0',
                            fontSize: '0.85rem',
                            background: sfDayOfWeek === i + 1 ? 'var(--bg-accent)' : 'transparent',
                            color: sfDayOfWeek === i + 1 ? 'var(--text-on-accent, #fff)' : 'var(--text-primary)',
                            border: 'none',
                            borderRadius: 8,
                            cursor: savingSchedule ? 'default' : 'pointer',
                            outline: 'none',
                          }}
                        >
                          {name}
                        </button>
                      ))}
                    </div>
                  )}

                  <div className="form-row" style={{ marginTop: 4 }}>
                    <input
                      className="input"
                      type="text"
                      placeholder="Комментарий (необязательно)"
                      value={sfComment}
                      onChange={(e) => setSfComment(e.target.value)}
                      disabled={savingSchedule}
                      style={{ flex: 1 }}
                    />
                  </div>

                  {scheduleError && (
                    <p style={{ color: 'var(--tag-out-fg)', fontSize: '0.85rem', marginTop: 4 }}>
                      {scheduleError}
                    </p>
                  )}

                  <div className="form-row">
                    <div className="action-pill">
                      <button
                        className="action-pill__cancel"
                        type="button"
                        onClick={() => { setShowScheduleForm(false); setScheduleError(null); }}
                        disabled={savingSchedule}
                      >
                        Отмена
                      </button>
                      <button
                        className="action-pill__confirm"
                        type="button"
                        onClick={handleAddSchedule}
                        disabled={savingSchedule || !sfAmount}
                    >
                      {savingSchedule ? '...' : 'Добавить'}
                      </button>
                    </div>
                  </div>
                </>
              )}
            </>
          )}

          {error && (
            <p style={{ color: 'var(--tag-out-fg)', fontSize: '0.85rem', marginTop: 4 }}>
              {error}
            </p>
          )}
        </div>

        <div className="modal-actions modal-actions--split">
          <button
            className="btn btn--danger"
            type="button"
            onClick={handleArchive}
            disabled={isBusy}
          >
            {archiving ? '...' : confirmArchive ? 'Точно в архив?' : 'В архив'}
          </button>
          <div className="modal-actions-group">
            <div className="action-pill">
              <button className="action-pill__cancel" type="button" onClick={onClose} disabled={isBusy}>
                Отмена
              </button>
              <button className="action-pill__confirm" type="button" onClick={handleSubmit} disabled={!canSubmit}>
                {saving ? '...' : 'Сохранить'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
