import React, { useEffect, useRef, useState } from 'react';
import BottomSheet from './BottomSheet';
import CurrencyPicker from './CurrencyPicker';
import EmojiPicker from './EmojiPicker';
import { parseCategoryIcon, buildCategoryName, categoryDisplayName } from '../utils/categoryIcon';
import { CategorySvgIcon } from './CategorySvgIcon';
import { formatAmount } from '../utils/format';
import { sanitizeDecimalInput } from '../utils/validation';
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
  fetchBankAccounts,
  fetchCurrencies,
  recordExpense,
  allocateBudget,
  allocateGroupBudget,
} from '../api';
import type {
  AccountCurrency,
  Category,
  DashboardBudgetCategory,
  GroupMember,
  ParentGroup,
  ScheduledExpense,
  BankAccount,
  Currency,
  UserContext,
  AllocateBudgetRequest,
  AllocateGroupBudgetRequest,
} from '../types';
import type { TransferSource, TransferTarget } from './TransferDialog';

type Tab = 'expense' | 'transfer' | 'settings';

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
            background: selected === d ? 'var(--yellow)' : 'transparent',
            color: selected === d ? '#111' : 'var(--text)',
            border: 'none',
            borderRadius: 8,
            cursor: disabled ? 'default' : 'pointer',
            outline: 'none',
            WebkitTapHighlightColor: 'transparent',
            fontWeight: selected === d ? 700 : 400,
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
  return { key: 'draft-' + index, child_category_id: '', share_percent: '' };
}

function serializeGroupRows(rows: GroupDraftRow[]): string {
  return JSON.stringify(
    rows
      .filter((r) => r.child_category_id && r.share_percent && Number(r.share_percent) > 0)
      .map((r) => ({
        child_category_id: Number(r.child_category_id),
        share_percent: Number(Number(r.share_percent).toFixed(2)),
      }))
      .sort((a, b) => a.child_category_id - b.child_category_id),
  );
}

function groupOptionLabel(cat: Pick<Category, 'kind' | 'name'>): string {
  if (cat.kind === 'system' && cat.name === 'Unallocated') return 'В свободный остаток';
  return cat.kind === 'group' ? `${cat.name} · группа` : cat.name;
}

export interface CategoryActionSheetProps {
  category: DashboardBudgetCategory;
  user: UserContext;
  transferSources: TransferSource[];
  extraTransferTargets?: TransferTarget[];
  transferInitialSourceId?: number | null;
  baseCurrencyCode: string;
  familyBankAccountId?: number | null;
  initialTab?: Tab;
  onClose: () => void;
  onSuccess: () => void;
}

export default function CategoryActionSheet({
  category,
  user,
  transferSources,
  extraTransferTargets,
  transferInitialSourceId,
  baseCurrencyCode,
  familyBankAccountId = null,
  initialTab,
  onClose,
  onSuccess,
}: CategoryActionSheetProps) {
  const canExpense = category.kind === 'regular';
  const defaultTab: Tab = initialTab ?? (canExpense ? 'expense' : 'transfer');
  const [activeTab, setActiveTab] = useState<Tab>(defaultTab);

  // ── Expense state ──────────────────────────────────────────
  const [currencies, setCurrencies] = useState<Currency[]>([]);
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [expAmount, setExpAmount] = useState('');
  const [expCurrencyCode, setExpCurrencyCode] = useState(user.base_currency_code);
  const [expComment, setExpComment] = useState('');
  const [expDate, setExpDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [expAccountId, setExpAccountId] = useState<number | null>(null);
  const [expSubmitting, setExpSubmitting] = useState(false);
  const [expError, setExpError] = useState<string | null>(null);

  const defaultCashAccountId = category.owner_type === 'family' ? familyBankAccountId : user.bank_account_id;

  useEffect(() => {
    setExpAccountId(defaultCashAccountId);
  }, [defaultCashAccountId]);

  useEffect(() => {
    void Promise.all([
      fetchCurrencies(),
      fetchBankAccounts('cash'),
      fetchBankAccounts('credit'),
    ]).then(([loadedCurrencies, cashAccounts, creditAccounts]) => {
      setCurrencies(loadedCurrencies);
      const creditCards = creditAccounts.filter((a) => a.credit_kind === 'credit_card');
      const ownerAccounts = [...cashAccounts, ...creditCards].filter((a) =>
        category.owner_type === 'family' ? a.owner_type === 'family' : a.owner_type === 'user',
      );
      setBankAccounts(ownerAccounts);
    }).catch(() => {});
  }, [category.owner_type]);

  const canSubmitExpense = !expSubmitting && parseFloat(expAmount) > 0 && expAccountId !== null;

  const handleSubmitExpense = async () => {
    if (!canSubmitExpense || expAccountId === null) return;
    setExpSubmitting(true);
    setExpError(null);
    try {
      await recordExpense({
        bank_account_id: expAccountId,
        category_id: category.category_id,
        amount: parseFloat(expAmount),
        currency_code: expCurrencyCode,
        comment: expComment.trim() || undefined,
        operated_at: expDate || undefined,
      });
      onSuccess();
    } catch (reason: unknown) {
      setExpError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setExpSubmitting(false);
    }
  };

  // ── Transfer state ─────────────────────────────────────────
  const transferTarget: TransferTarget = {
    category_id: category.category_id,
    name: category.name,
    kind: category.kind,
    currency_code: category.currency_code,
    owner_type: category.owner_type,
  };
  const allTransferTargets = extraTransferTargets && extraTransferTargets.length > 0
    ? [transferTarget, ...extraTransferTargets]
    : null;
  const [selectedTargetId, setSelectedTargetId] = useState(transferTarget.category_id);
  const activeTarget = allTransferTargets?.find((t) => t.category_id === selectedTargetId) ?? transferTarget;
  const visibleSources = activeTarget.owner_type
    ? transferSources.filter((s) => !s.owner_type || s.owner_type === activeTarget.owner_type)
    : transferSources;
  const defaultXferSourceId = (() => {
    if (transferInitialSourceId != null) return String(transferInitialSourceId);
    const freeBudget = transferSources.find(
      (s) => s.kind === 'free_budget' && (!s.owner_type || s.owner_type === category.owner_type),
    );
    return freeBudget ? String(freeBudget.category_id) : '';
  })();
  const [xferSourceId, setXferSourceId] = useState(defaultXferSourceId);
  const [xferAmount, setXferAmount] = useState('');
  const [xferComment, setXferComment] = useState('');
  const [xferError, setXferError] = useState<string | null>(null);
  const [xferSubmitting, setXferSubmitting] = useState(false);
  const [showSourcePicker, setShowSourcePicker] = useState(false);

  const handleTargetChange = (targetId: number) => {
    setSelectedTargetId(targetId);
    const newTarget = allTransferTargets?.find((t) => t.category_id === targetId);
    if (newTarget?.owner_type && xferSourceId) {
      const stillValid = transferSources.some(
        (s) => String(s.category_id) === xferSourceId && (!s.owner_type || s.owner_type === newTarget.owner_type),
      );
      if (!stillValid) setXferSourceId('');
    }
  };

  const selectedSource = visibleSources.find((s) => String(s.category_id) === xferSourceId) || null;
  const xferAmountValue = parseFloat(xferAmount);
  const hasPositiveBalance = (selectedSource?.balance || 0) > 0;
  const exceedsBalance = !!selectedSource && xferAmountValue > selectedSource.balance;
  const xferValidationMsg = !selectedSource
    ? null
    : !hasPositiveBalance
      ? 'В выбранной категории нет денег для перевода.'
      : exceedsBalance
        ? `Нельзя перевести больше: ${formatAmount(selectedSource.balance, selectedSource.currency_code)}.`
        : null;
  const canSubmitTransfer = !xferSubmitting && !!selectedSource && xferAmountValue > 0 && !xferValidationMsg;

  const handleSubmitTransfer = async () => {
    if (!selectedSource || xferAmountValue <= 0 || xferValidationMsg) return;
    setXferSubmitting(true);
    setXferError(null);
    try {
      if (activeTarget.kind === 'group') {
        await allocateGroupBudget({
          from_category_id: selectedSource.category_id,
          group_id: activeTarget.category_id,
          amount_in_base: xferAmountValue,
          comment: xferComment.trim() || undefined,
        } as AllocateGroupBudgetRequest);
      } else {
        await allocateBudget({
          from_category_id: selectedSource.category_id,
          to_category_id: activeTarget.category_id,
          amount_in_base: xferAmountValue,
          comment: xferComment.trim() || undefined,
        } as AllocateBudgetRequest);
      }
      onSuccess();
    } catch (reason: unknown) {
      setXferError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setXferSubmitting(false);
    }
  };

  // ── Settings state ─────────────────────────────────────────
  const { icon: initialIcon, displayName: initialDisplayName } = parseCategoryIcon(category.name);
  const [nameDraft, setNameDraft] = useState(initialDisplayName);
  const [iconDraft, setIconDraft] = useState<string | null>(initialIcon);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);

  const [groupRows, setGroupRows] = useState<GroupDraftRow[]>([createDraftRow(1)]);
  const [initialGroupRowsSnapshot, setInitialGroupRowsSnapshot] = useState('[]');
  const [groupSelectableCategories, setGroupSelectableCategories] = useState<Category[]>([]);
  const [groupMembers, setGroupMembers] = useState<GroupMember[]>([]);
  const [parentGroups, setParentGroups] = useState<ParentGroup[]>([]);
  const [loadingGroupSettings, setLoadingGroupSettings] = useState(false);
  const groupRequestIdRef = useRef(0);
  const parentGroupsRequestIdRef = useRef(0);

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

  useEffect(() => {
    if (category.kind !== 'regular') return;
    setLoadingSchedules(true);
    void Promise.all([
      fetchScheduledExpenses(category.category_id),
      fetchCategoryAccountCurrencies(category.category_id),
    ]).then(([loadedSchedules, loadedCurrencies]) => {
      setSchedules(loadedSchedules);
      setAccountCurrencies(loadedCurrencies);
      if (loadedCurrencies.length > 0) setSfCurrencyCode(loadedCurrencies[0].code);
    }).catch(() => {}).finally(() => setLoadingSchedules(false));
  }, [category.category_id, category.kind]);

  const handleAddSchedule = async () => {
    if (!sfAmount || Number(sfAmount) <= 0) { setScheduleError('Укажите сумму больше нуля.'); return; }
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
    const reqId = ++parentGroupsRequestIdRef.current;
    void fetchCategoryParentGroups(category.category_id)
      .then((groups) => { if (parentGroupsRequestIdRef.current === reqId) setParentGroups(groups); })
      .catch(() => { if (parentGroupsRequestIdRef.current === reqId) setParentGroups([]); });
  }, [category.category_id]);

  useEffect(() => {
    if (category.kind !== 'group') return;
    const reqId = ++groupRequestIdRef.current;
    setLoadingGroupSettings(true);
    void Promise.all([fetchCategories(), fetchGroupMembers(category.category_id)])
      .then(([loadedCats, members]) => {
        if (groupRequestIdRef.current !== reqId) return;
        const nextRows = members.length > 0
          ? members.map((m, i) => ({
              key: `member-${i}-${m.child_category_id}`,
              child_category_id: String(m.child_category_id),
              share_percent: String(Number((m.share * 100).toFixed(2))),
            }))
          : [createDraftRow(1)];
        setGroupSelectableCategories(
          loadedCats.filter((c) =>
            c.is_active &&
            c.owner_type === category.owner_type &&
            c.id !== category.category_id &&
            (c.kind !== 'system' || c.name === 'Unallocated'),
          ),
        );
        setGroupRows(nextRows);
        setGroupMembers(members);
        setInitialGroupRowsSnapshot(serializeGroupRows(nextRows));
      })
      .catch((reason: unknown) => { if (groupRequestIdRef.current === reqId) setSettingsError(reason instanceof Error ? reason.message : String(reason)); })
      .finally(() => { if (groupRequestIdRef.current === reqId) setLoadingGroupSettings(false); });
  }, [category.category_id, category.kind]);

  const handleGroupRowChange = (key: string, field: 'child_category_id' | 'share_percent', value: string) => {
    setGroupRows((prev) => prev.map((r) => (r.key === key ? { ...r, [field]: value } : r)));
  };
  const addGroupRow = () => setGroupRows((prev) => [...prev, createDraftRow(prev.length + 1)]);
  const removeGroupRow = (key: string) => {
    setGroupRows((prev) => {
      const next = prev.filter((r) => r.key !== key);
      return next.length > 0 ? next : [createDraftRow(1)];
    });
  };

  const validGroupRows = groupRows.filter((r) => r.child_category_id && r.share_percent && Number(r.share_percent) > 0);
  const totalSharePercent = validGroupRows.reduce((acc, r) => acc + Number(r.share_percent || 0), 0);
  const groupRowsChanged = category.kind === 'group' && serializeGroupRows(groupRows) !== initialGroupRowsSnapshot;
  const hasNameChanged = buildCategoryName(iconDraft, nameDraft) !== category.name;
  const canSaveGroupSettings = !loadingGroupSettings && validGroupRows.length > 0 && Math.abs(totalSharePercent - 100) < 0.001;
  const canSubmitSettings =
    !saving && !archiving && !!nameDraft.trim() &&
    (category.kind !== 'group' || !groupRowsChanged || canSaveGroupSettings);

  const handleSubmitSettings = async () => {
    if (!nameDraft.trim()) return;
    if (category.kind === 'group' && groupRowsChanged && !canSaveGroupSettings) {
      setSettingsError('Для группы нужна хотя бы одна категория, а сумма долей должна быть ровно 100%.');
      return;
    }
    setSaving(true);
    setSettingsError(null);
    try {
      if (hasNameChanged) await updateCategory(category.category_id, buildCategoryName(iconDraft, nameDraft));
      if (category.kind === 'group' && groupRowsChanged) {
        await replaceGroupMembers(
          category.category_id,
          validGroupRows.map((r) => Number(r.child_category_id)),
          validGroupRows.map((r) => Number(r.share_percent) / 100),
        );
      }
      onSuccess();
      onClose();
    } catch (reason: unknown) {
      setSettingsError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSaving(false);
    }
  };

  const handleArchive = async () => {
    if (parentGroups.length > 0) {
      setSettingsError(`Нельзя архивировать, пока элемент входит в группы: ${parentGroups.map((g) => g.group_name).join(', ')}.`);
      setConfirmArchive(false);
      return;
    }
    if (!confirmArchive) { setSettingsError(null); setConfirmArchive(true); return; }
    setArchiving(true);
    setSettingsError(null);
    try {
      await archiveCategory(category.category_id);
      onSuccess();
    } catch (reason: unknown) {
      setSettingsError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setArchiving(false);
    }
  };

  const isBusy = saving || archiving || expSubmitting || xferSubmitting || savingSchedule;

  const parsed = parseCategoryIcon(category.name);
  const colorClasses = ['--g', '--o', '--b', '--p', '--r', '--v'] as const;
  const colorClass = colorClasses[category.category_id % 6];
  const iconColorSuffix = colorClass.slice(2); // 'g' | 'o' | 'b' | 'p' | 'r' | 'v'
  const isGroup = category.kind === 'group';
  const sheetTag = isGroup ? (category.owner_type === 'family' ? 'Семейная группа' : 'Группа') : 'Категория';

  const categoryIconNode = parsed.kind === 'svg' && parsed.icon
    ? <CategorySvgIcon code={parsed.icon} />
    : parsed.kind === 'emoji' && parsed.icon
      ? <span style={{ fontSize: 20, lineHeight: 1 }}>{parsed.icon}</span>
      : null;

  // ── Tab action buttons ─────────────────────────────────────
  const tabActions = (
    <div style={{ display: 'flex', gap: 8, width: '100%' }}>
      {activeTab === 'expense' && (
        <>
          <button className="sh-btn sh-btn--ghost" type="button" onClick={onClose} disabled={expSubmitting}>Отмена</button>
          <button className="sh-btn sh-btn--primary" type="button" disabled={!canSubmitExpense} onClick={handleSubmitExpense} style={{ flex: 1 }}>
            {expSubmitting ? '...' : 'Списать'}
          </button>
        </>
      )}
      {activeTab === 'transfer' && (
        <>
          <button className="sh-btn sh-btn--ghost" type="button" onClick={onClose} disabled={xferSubmitting}>Отмена</button>
          <button className="sh-btn sh-btn--primary" type="button" disabled={!canSubmitTransfer} onClick={handleSubmitTransfer} style={{ flex: 1 }}>
            {xferSubmitting ? '...' : isGroup ? 'Распределить' : 'Перевести'}
          </button>
        </>
      )}
      {activeTab === 'settings' && (
        <>
          <button className="sh-btn" type="button" onClick={handleArchive} disabled={isBusy} style={{ flexShrink: 0, background: 'var(--neg-bg)', color: 'var(--neg)' }}>
            {archiving ? '...' : confirmArchive ? 'Точно?' : 'В архив'}
          </button>
          <button className="sh-btn sh-btn--ghost" type="button" onClick={onClose} disabled={isBusy}>Отмена</button>
          <button className="sh-btn sh-btn--primary" type="button" onClick={handleSubmitSettings} disabled={!canSubmitSettings} style={{ flex: 1 }}>
            {saving ? '...' : 'Сохранить'}
          </button>
        </>
      )}
    </div>
  );

  return (
    <BottomSheet
      open
      tag={sheetTag}
      title={categoryDisplayName(category.name)}
      icon={categoryIconNode}
      iconColor={iconColorSuffix}
      onClose={() => !isBusy && onClose()}
      actions={tabActions}
    >
      {/* Category stat — hidden for groups (they don't have a balance, only rules) */}
      {!isGroup && (
        <div className="sheet-stat">
          <span className="sheet-stat__tag">Остаток в категории</span>
          <div className="sheet-stat__num">
            <span className="sheet-stat__val">
              {new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(category.balance)}
            </span>
            <span className="sheet-stat__sym">{category.currency_code}</span>
          </div>
        </div>
      )}

      {/* Tab switcher */}
      <div className="cat-actions" role="group" aria-label="Действие с категорией">
        {canExpense && (
          <button
            className={`cat-act${activeTab === 'expense' ? ' cat-act--primary' : ''}`}
            type="button"
            onClick={() => setActiveTab('expense')}
          >
            <span className="cat-act__ico">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" width="16" height="16">
                <path d="M12 5v14M6 13l6 6 6-6"/>
              </svg>
            </span>
            <span className="cat-act__label">Потратить</span>
          </button>
        )}
        <button
          className={`cat-act${activeTab === 'transfer' ? ' cat-act--primary' : ''}`}
          type="button"
          onClick={() => setActiveTab('transfer')}
        >
          <span className="cat-act__ico">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" width="16" height="16">
              <path d="M8 3 4 7l4 4M4 7h16M16 21l4-4-4-4M20 17H4"/>
            </svg>
          </span>
          <span className="cat-act__label">{isGroup ? 'Распределить' : 'Перевод'}</span>
        </button>
        <button
          className={`cat-act${activeTab === 'settings' ? ' cat-act--primary' : ''}`}
          type="button"
          onClick={() => setActiveTab('settings')}
        >
          <span className="cat-act__ico">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" width="16" height="16">
              <circle cx="12" cy="12" r="3"/><path d="M12 2v2.5M12 19.5V22M4.2 4.2l1.8 1.8M18 18l1.8 1.8M2 12h2.5M19.5 12H22M4.2 19.8 6 18M18 6l1.8-1.8"/>
            </svg>
          </span>
          <span className="cat-act__label">Настройки</span>
        </button>
      </div>

      {/* ── Expense tab ─────────────────────────────────────── */}
      {activeTab === 'expense' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div className="field">
            <span className="fl">Счёт</span>
            <select
              className="picker-v2"
              value={expAccountId ?? ''}
              onChange={(e) => setExpAccountId(Number(e.target.value))}
              disabled={expSubmitting}
            >
              {bankAccounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}{a.account_kind === 'credit' ? ' · Кредитная карта' : ''}
                </option>
              ))}
              {bankAccounts.length === 0 && <option value="">Счёт не найден</option>}
            </select>
          </div>
          <div className="field">
            <span className="fl">Сумма</span>
            <div className="amt">
              <input
                className="amt__inp"
                type="text"
                inputMode="decimal"
                placeholder="0"
                value={expAmount}
                onChange={(e) => setExpAmount(sanitizeDecimalInput(e.target.value))}
                autoFocus
              />
              <CurrencyPicker
                currencies={currencies}
                value={expCurrencyCode}
                onChange={setExpCurrencyCode}
                disabled={expSubmitting}
              />
            </div>
          </div>
          <div className="field field--row">
            <div className="field field--col">
              <span className="fl">Дата</span>
              <input className="picker-v2" type="date" value={expDate} onChange={(e) => setExpDate(e.target.value)} style={{ cursor: 'pointer' }} />
            </div>
          </div>
          <div className="field">
            <span className="fl">Комментарий</span>
            <input
              className="inp-v2"
              type="text"
              placeholder="Необязательно"
              value={expComment}
              onChange={(e) => setExpComment(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSubmitExpense()}
            />
          </div>
          {expError && <p className="dlg-error">{expError}</p>}
          {expAccountId === null && <p className="dlg-error">Для этой категории не найден подходящий счёт.</p>}
        </div>
      )}

      {/* ── Transfer tab ─────────────────────────────────────── */}
      {activeTab === 'transfer' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {/* FROM → TO cards */}
          <div className="xfer">
            {/* FROM card — clickable, opens source picker */}
            <button
              className="xfer__card"
              type="button"
              onClick={() => !xferSubmitting && setShowSourcePicker((v) => !v)}
              disabled={xferSubmitting}
            >
              <span className="xfer__tag">Откуда</span>
              <div className="xfer__row">
                {selectedSource ? (
                  <>
                    <span className={`sheet-ico sheet-ico--sm sheet-ico${colorClasses[selectedSource.category_id % 6]}`}>
                      {(() => { const p = parseCategoryIcon(selectedSource.name); return p.kind === 'svg' && p.icon ? <CategorySvgIcon code={p.icon} /> : p.kind === 'emoji' && p.icon ? <span style={{ fontSize: 14 }}>{p.icon}</span> : null; })()}
                    </span>
                    <div className="xfer__text">
                      <span className="xfer__name">{categoryDisplayName(selectedSource.name)}</span>
                      <span className="xfer__sub">{formatAmount(selectedSource.balance, selectedSource.currency_code)}</span>
                    </div>
                  </>
                ) : (
                  <div className="xfer__text">
                    <span className="xfer__name" style={{ color: 'var(--text-3)', fontWeight: 500 }}>Выберите источник</span>
                  </div>
                )}
                <svg className="xfer__chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d={showSourcePicker ? 'm6 15 6-6 6 6' : 'm6 9 6 6 6-6'}/>
                </svg>
              </div>
            </button>

            {/* Inline source picker */}
            {showSourcePicker && (
              <div className="xfer__source-list">
                {visibleSources.length === 0 && (
                  <div style={{ padding: '12px 14px', fontSize: 13, color: 'var(--text-3)' }}>Нет доступных источников</div>
                )}
                {visibleSources.map((s) => {
                  const sp = parseCategoryIcon(s.name);
                  const sColor = colorClasses[s.category_id % 6];
                  return (
                    <button
                      key={s.category_id}
                      type="button"
                      className={`xfer__source-item${String(s.category_id) === xferSourceId ? ' xfer__source-item--active' : ''}`}
                      onClick={() => { setXferSourceId(String(s.category_id)); setShowSourcePicker(false); }}
                    >
                      <span className={`sheet-ico sheet-ico--sm sheet-ico${sColor}`} style={{ flexShrink: 0 }}>
                        {sp.kind === 'svg' && sp.icon ? <CategorySvgIcon code={sp.icon} /> : sp.kind === 'emoji' && sp.icon ? <span style={{ fontSize: 14 }}>{sp.icon}</span> : null}
                      </span>
                      <span className="xfer__source-item__name">{categoryDisplayName(s.name)}</span>
                      <span className="xfer__source-item__bal">{formatAmount(s.balance, s.currency_code)}</span>
                    </button>
                  );
                })}
              </div>
            )}

            {/* Arrow + "Куда" — hidden for groups (target is the group itself, shown in the sheet header) */}
            {!isGroup && (
              <>
                <div className="xfer__arrow">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 5v14M6 13l6 6 6-6"/>
                  </svg>
                </div>
                <div className="xfer__card xfer__card--to">
                  <span className="xfer__tag">Куда</span>
                  <div className="xfer__row">
                    <span className={`sheet-ico sheet-ico--sm sheet-ico${colorClass}`}>
                      {parsed.kind === 'svg' && parsed.icon ? <CategorySvgIcon code={parsed.icon} /> : parsed.kind === 'emoji' && parsed.icon ? <span style={{ fontSize: 14 }}>{parsed.icon}</span> : null}
                    </span>
                    <div className="xfer__text">
                      <span className="xfer__name">{categoryDisplayName(activeTarget.name)}</span>
                      <span className="xfer__sub">{formatAmount(category.balance, category.currency_code)}</span>
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>

          {xferValidationMsg && <p className="dlg-error">{xferValidationMsg}</p>}

          {/* Amount */}
          <div className="field">
            <span className="fl">{activeTarget.kind === 'group' ? 'Сумма к распределению' : 'Сумма'}</span>
            <div className="amt">
              <input
                className="amt__inp"
                type="text"
                inputMode="decimal"
                placeholder="0"
                value={xferAmount}
                onChange={(e) => setXferAmount(sanitizeDecimalInput(e.target.value))}
                disabled={xferSubmitting}
              />
              <span className="amt__cur" style={{ fontSize: 18, fontWeight: 600, color: 'var(--text-2)' }}>{baseCurrencyCode}</span>
            </div>
          </div>

          {/* Comment */}
          <div className="field">
            <span className="fl">Комментарий</span>
            <input
              className="inp-v2"
              type="text"
              placeholder="Необязательно"
              value={xferComment}
              onChange={(e) => setXferComment(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !xferSubmitting && handleSubmitTransfer()}
            />
          </div>

          {/* Live distribution preview — only when target is a group */}
          {activeTarget.kind === 'group' && groupMembers.length > 0 && (
            <div className="grp-dist">
              <div className="grp-dist__head">
                <span className="grp-dist__label">Разложится по категориям</span>
                <span className="grp-dist__total">
                  {Math.round(groupMembers.reduce((s, m) => s + m.share, 0) * 100)}%
                </span>
              </div>
              <div className="grp-bar" aria-hidden="true">
                {[...groupMembers].sort((a, b) => b.share - a.share).slice(0, 4).map((m, i) => (
                  <span
                    key={m.child_category_id}
                    className={`grp-bar__seg grp-bar__seg--${i + 1}`}
                    style={{ ['--w' as string]: `${Math.round(m.share * 100)}%` } as React.CSSProperties}
                  />
                ))}
              </div>
              <ul className="grp-dist__list">
                {[...groupMembers].sort((a, b) => b.share - a.share).map((m, i) => {
                  const active = xferAmountValue > 0;
                  const amt = active ? xferAmountValue * m.share : 0;
                  return (
                    <li key={m.child_category_id} className="grp-row">
                      <span className={`grp-row__dot grp-row__dot--${(i % 4) + 1}`} />
                      <div>
                        <span className="grp-row__name">{categoryDisplayName(m.child_category_name)}</span>
                        <span className="grp-row__pct"> · {Math.round(m.share * 100)}%</span>
                      </div>
                      <span className={`grp-row__amt${active ? ' grp-row__amt--active' : ''}`}>
                        {active ? new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(amt) : '—'}
                        <span> {baseCurrencyCode}</span>
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {xferError && <p className="dlg-error">{xferError}</p>}
        </div>
      )}

      {/* ── Settings tab ─────────────────────────────────────── */}
      {activeTab === 'settings' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

          {/* Name + icon */}
          <div className="field">
            <span className="fl">Название</span>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <button
                type="button"
                className="category-icon-btn"
                onClick={() => setShowEmojiPicker((v) => !v)}
                aria-label="Выбрать иконку"
              >
                {iconDraft
                  ? /\p{Extended_Pictographic}/u.test(iconDraft)
                    ? iconDraft
                    : <CategorySvgIcon code={iconDraft} />
                  : '＋'}
              </button>
              <input
                className="inp-v2"
                type="text"
                placeholder="Название категории"
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && !saving && handleSubmitSettings()}
                style={{ flex: 1 }}
              />
            </div>
          </div>

          {showEmojiPicker && (
            <EmojiPicker selected={iconDraft} onSelect={(e) => { setIconDraft(e); if (e) setShowEmojiPicker(false); }} />
          )}

          {/* Group settings */}
          {category.kind === 'group' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span className="fl" style={{ margin: 0 }}>Состав группы</span>
                <span style={{ marginLeft: 'auto', fontSize: 12, fontWeight: 600, color: Math.abs(totalSharePercent - 100) < 0.001 ? 'var(--pos)' : 'var(--text-3)' }}>
                  {totalSharePercent.toFixed(0)} / 100%
                </span>
                {loadingGroupSettings && <span style={{ fontSize: 12, color: 'var(--text-3)' }}>загружаем...</span>}
              </div>
              {!loadingGroupSettings && groupRows.map((row) => (
                <div key={row.key} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <select
                    className="picker-v2"
                    value={row.child_category_id}
                    onChange={(e) => handleGroupRowChange(row.key, 'child_category_id', e.target.value)}
                    disabled={saving}
                    style={{ flex: 1 }}
                  >
                    <option value="">Выберите категорию</option>
                    {groupSelectableCategories.map((cat) => (
                      <option key={cat.id} value={cat.id}>{groupOptionLabel(cat)}</option>
                    ))}
                  </select>
                  <div style={{ position: 'relative', flexShrink: 0 }}>
                    <input
                      className="picker-v2"
                      type="text"
                      inputMode="decimal"
                      placeholder="0"
                      value={row.share_percent}
                      onChange={(e) => handleGroupRowChange(row.key, 'share_percent', e.target.value)}
                      disabled={saving}
                      style={{ width: 72, paddingRight: 22 }}
                    />
                    <span style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', fontSize: 11, color: 'var(--text-3)', pointerEvents: 'none' }}>%</span>
                  </div>
                  <button className="dlg-tag-btn" type="button" onClick={() => removeGroupRow(row.key)} disabled={saving}>×</button>
                </div>
              ))}
              {!loadingGroupSettings && (
                <button className="dlg-tag-btn" type="button" onClick={addGroupRow} disabled={saving} style={{ alignSelf: 'flex-start' }}>
                  + Категорию
                </button>
              )}
            </div>
          )}

          {/* Scheduled expenses */}
          {category.kind === 'regular' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <span className="fl">Расписание списаний</span>

              {loadingSchedules && <span style={{ fontSize: 13, color: 'var(--text-3)' }}>Загружаем...</span>}

              {!loadingSchedules && schedules.map((s) => (
                <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: 'var(--surface-inset)', borderRadius: 'var(--r-md)' }}>
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <span style={{ fontWeight: 700, fontSize: 14 }}>{s.amount} {s.currency_code}</span>
                    <span style={{ fontSize: 12, color: 'var(--text-3)' }}>
                      {formatScheduleLabel(s)}{s.comment ? ` · ${s.comment}` : ''}
                    </span>
                    <span style={{ fontSize: 11, color: 'var(--text-3)' }}>Следующее: {s.next_run_at}</span>
                    {s.last_error && <span style={{ fontSize: 11, color: 'var(--neg)' }}>Ошибка: {s.last_error}</span>}
                  </div>
                  <button
                    className="sh-btn"
                    type="button"
                    style={{ flexShrink: 0, background: 'var(--neg-bg)', color: 'var(--neg)', fontSize: 13 }}
                    onClick={() => handleDeleteSchedule(s.id)}
                    disabled={deletingScheduleId === s.id}
                  >
                    {deletingScheduleId === s.id ? '...' : 'Удалить'}
                  </button>
                </div>
              ))}

              {!loadingSchedules && !showScheduleForm && (
                <button className="dlg-tag-btn" type="button" style={{ alignSelf: 'flex-start' }} onClick={() => { setShowScheduleForm(true); setScheduleError(null); }}>
                  + Добавить расписание
                </button>
              )}

              {showScheduleForm && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '14px', background: 'var(--surface-inset)', borderRadius: 'var(--r-md)' }}>
                  {/* Amount + currency */}
                  <div className="field">
                    <span className="fl">Сумма</span>
                    <div className="amt">
                      <input
                        className="amt__inp"
                        type="text"
                        inputMode="decimal"
                        placeholder="0"
                        value={sfAmount}
                        onChange={(e) => setSfAmount(e.target.value)}
                        disabled={savingSchedule}
                      />
                      <CurrencyPicker
                        currencies={accountCurrencies.length === 0
                          ? [{ code: category.currency_code, name: category.currency_code, scale: 2 }]
                          : accountCurrencies.map((c) => ({ code: c.code, name: c.code, scale: 2 }))}
                        value={sfCurrencyCode}
                        onChange={setSfCurrencyCode}
                        disabled={savingSchedule || accountCurrencies.length === 0}
                      />
                    </div>
                  </div>

                  {/* Frequency toggle */}
                  <div className="field">
                    <span className="fl">Периодичность</span>
                    <div className="seg-src">
                      {(['monthly', 'weekly'] as const).map((freq) => (
                        <button
                          key={freq}
                          type="button"
                          className={`seg-src__o${sfFrequency === freq ? ' seg-src__o--on' : ''}`}
                          onClick={() => setSfFrequency(freq)}
                          disabled={savingSchedule}
                        >
                          {freq === 'monthly' ? 'Ежемесячно' : 'Еженедельно'}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Monthly day picker */}
                  {sfFrequency === 'monthly' && (
                    <div className="field">
                      <span className="fl">День месяца</span>
                      <MonthDayPicker selected={sfDayOfMonth} onChange={setSfDayOfMonth} disabled={savingSchedule} />
                    </div>
                  )}

                  {/* Weekly day picker */}
                  {sfFrequency === 'weekly' && (
                    <div className="field">
                      <span className="fl">День недели</span>
                      <div className="seg-src">
                        {DAY_NAMES.map((name, i) => (
                          <button
                            key={i}
                            type="button"
                            className={`seg-src__o${sfDayOfWeek === i + 1 ? ' seg-src__o--on' : ''}`}
                            onClick={() => setSfDayOfWeek(i + 1)}
                            disabled={savingSchedule}
                          >
                            {name}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Comment */}
                  <div className="field">
                    <span className="fl">Комментарий</span>
                    <input
                      className="inp-v2"
                      type="text"
                      placeholder="Необязательно"
                      value={sfComment}
                      onChange={(e) => setSfComment(e.target.value)}
                      disabled={savingSchedule}
                    />
                  </div>

                  {scheduleError && <p className="dlg-error">{scheduleError}</p>}

                  <div style={{ display: 'flex', gap: 8, paddingTop: 4, borderTop: '1px solid var(--line)' }}>
                    <button className="sh-btn sh-btn--ghost" type="button" onClick={() => { setShowScheduleForm(false); setScheduleError(null); }} disabled={savingSchedule}>
                      Отмена
                    </button>
                    <button className="sh-btn sh-btn--primary" type="button" onClick={handleAddSchedule} disabled={savingSchedule || !sfAmount} style={{ flex: 1 }}>
                      {savingSchedule ? '...' : 'Добавить'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {settingsError && <p className="dlg-error">{settingsError}</p>}
        </div>
      )}
    </BottomSheet>
  );
}
