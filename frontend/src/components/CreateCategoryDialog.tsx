import { useEffect, useRef, useState } from 'react';
import BottomSheet from './BottomSheet';

import { archiveCategory, createCategory, fetchCategories, fetchMyFamily, replaceGroupMembers } from '../api';
import EmojiPicker from './EmojiPicker';
import { buildCategoryName, parseCategoryIcon } from '../utils/categoryIcon';
import { CategorySvgIcon } from './CategorySvgIcon';
import { useModalOpen } from '../hooks/useModalOpen';
import type { Category } from '../types';


interface CategorySelectProps {
  options: Category[];
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
}

function CategorySelect({ options, value, onChange, disabled }: CategorySelectProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const selected = options.find((o) => String(o.id) === value);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const renderIcon = (cat: Category) => {
    const parsed = parseCategoryIcon(cat.name);
    if (parsed.kind === 'svg' && parsed.icon) return <CategorySvgIcon code={parsed.icon} />;
    if (parsed.kind === 'emoji' && parsed.icon) return <span style={{ fontSize: 14, lineHeight: 1 }}>{parsed.icon}</span>;
    return null;
  };

  return (
    <div className="ccd-csel" ref={ref}>
      <button
        type="button"
        className={`ccd-csel__btn${open ? ' ccd-csel__btn--open' : ''}`}
        onClick={() => !disabled && setOpen((v) => !v)}
        disabled={disabled}
      >
        {selected ? (
          <>
            <span className="ccd-csel__ico">{renderIcon(selected)}</span>
            <span className="ccd-csel__label">{categoryLabel(selected)}</span>
          </>
        ) : (
          <span className="ccd-csel__placeholder">Категория</span>
        )}
        <svg className="ccd-csel__chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" width="13" height="13">
          <path d={open ? 'm6 15 6-6 6 6' : 'm6 9 6 6 6-6'} />
        </svg>
      </button>
      {open && (
        <div className="ccd-csel__drop">
          {options.length === 0 && (
            <div className="ccd-csel__empty">Нет доступных категорий</div>
          )}
          {options.map((o) => (
            <button
              key={o.id}
              type="button"
              className={`ccd-csel__item${String(o.id) === value ? ' ccd-csel__item--on' : ''}`}
              onMouseDown={(e) => { e.preventDefault(); onChange(String(o.id)); setOpen(false); }}
            >
              <span className="ccd-csel__ico">{renderIcon(o)}</span>
              <span className="ccd-csel__item-name">{categoryLabel(o)}</span>
              {o.kind === 'group' && <span className="ccd-csel__item-tag">группа</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}


interface GroupDraftRow {
  key: string;
  child_category_id: string;
  share_percent: string;
}


function categoryLabel(category: Pick<Category, 'kind' | 'name'>): string {
  const raw = parseCategoryIcon(category.name).displayName;
  if (raw === 'Unallocated' || category.name === 'Unallocated') return 'Свободный остаток';
  return raw;
}


function createDraftRow(index: number): GroupDraftRow {
  return {
    key: 'draft-' + index,
    child_category_id: '',
    share_percent: '',
  };
}


interface Props {
  kind: 'regular' | 'group';
  onClose: () => void;
  onSuccess: () => void;
}


export default function CreateCategoryDialog({ kind, onClose, onSuccess }: Props) {
  useModalOpen();
  const [name, setName] = useState('');
  const [icon, setIcon] = useState<string | null>(null);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [ownerType, setOwnerType] = useState<'user' | 'family'>('user');
  const [inFamily, setInFamily] = useState(false);
  const [groupSelectableCategories, setGroupSelectableCategories] = useState<Category[]>([]);
  const [groupRows, setGroupRows] = useState<GroupDraftRow[]>([createDraftRow(1)]);
  const [loadingGroupOptions, setLoadingGroupOptions] = useState(false);

  useEffect(() => {
    fetchMyFamily()
      .then((f) => setInFamily(!!f))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (kind !== 'group') {
      setGroupSelectableCategories([]);
      setGroupRows([createDraftRow(1)]);
      return;
    }

    let cancelled = false;
    setLoadingGroupOptions(true);

    void fetchCategories()
      .then((categories) => {
        if (cancelled) return;
        setGroupSelectableCategories(
          categories.filter(
            (item) => item.is_active && (item.kind !== 'system' || item.name === 'Unallocated'),
          ),
        );
      })
      .catch((reason: unknown) => {
        if (cancelled) return;
        setError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingGroupOptions(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [kind]);

  useEffect(() => {
    if (kind === 'group') {
      setGroupRows([createDraftRow(1)]);
    }
  }, [kind, ownerType]);

  const handleGroupRowChange = (
    rowKey: string,
    field: 'child_category_id' | 'share_percent',
    value: string,
  ) => {
    setGroupRows((prev) => prev.map((row) => (row.key === rowKey ? { ...row, [field]: value } : row)));
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
  const hasGroupDraftInput = groupRows.some((row) => row.child_category_id || row.share_percent);
  const totalSharePercent = validGroupRows.reduce((acc, row) => acc + Number(row.share_percent || 0), 0);
  const canSaveGroupMembers =
    validGroupRows.length > 0 &&
    Math.abs(totalSharePercent - 100) < 0.001;
  const visibleGroupOptions = groupSelectableCategories.filter((item) => item.owner_type === ownerType);

  const handleCreate = async () => {
    if (!name.trim()) return;

    if (kind === 'group' && hasGroupDraftInput && !canSaveGroupMembers) {
      setError('Если заполняешь состав группы, нужна хотя бы одна строка и сумма долей должна быть ровно 100%.');
      return;
    }

    setCreating(true);
    setError(null);

    try {
      const result = await createCategory(buildCategoryName(icon, name), kind, ownerType);

      if (kind === 'group' && validGroupRows.length > 0) {
        try {
          await replaceGroupMembers(
            result.id,
            validGroupRows.map((row) => Number(row.child_category_id)),
            validGroupRows.map((row) => Number(row.share_percent) / 100),
          );
        } catch (reason) {
          await archiveCategory(result.id).catch(() => undefined);
          throw reason;
        }
      }

      onSuccess();
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setCreating(false);
    }
  };

  return (
    <BottomSheet
      open
      tag="Создание"
      title={kind === 'group' ? 'Новая группа' : 'Новая категория'}
      icon={kind === 'group'
        ? <CategorySvgIcon code="package" />
        : <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" width="20" height="20"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><circle cx="7" cy="7" r="1.5" fill="currentColor" stroke="none"/></svg>
      }
      iconColor={kind === 'group' ? 'b' : 'g'}
      onClose={() => !creating && onClose()}
    >
      <div className="apf-body">
        {/* Hint */}
        <p className="ccd-hint">
          {kind === 'group'
            ? 'Можно сразу задать состав группы и доли распределения. Если оставить поля пустыми — группа создастся без состава.'
            : 'Добавь новую категорию, чтобы потом распределять по ней бюджет.'}
        </p>

        {/* Icon + name */}
        <div className="apf-field">
          <span className="apf-label">Название</span>
          <div className="ccd-name-row">
            <button
              type="button"
              className="ccd-icon-btn"
              onClick={() => setShowEmojiPicker((v) => !v)}
              aria-label="Выбрать иконку"
            >
              {icon
                ? /\p{Extended_Pictographic}/u.test(icon)
                  ? icon
                  : <CategorySvgIcon code={icon} />
                : <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" width="18" height="18"><path d="M12 5v14M5 12h14"/></svg>}
            </button>
            <input
              className="apf-input"
              type="text"
              placeholder={kind === 'group' ? 'Название группы' : 'Название категории'}
              value={name}
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => event.key === 'Enter' && !creating && void handleCreate()}
              autoFocus
            />
          </div>
        </div>

        {/* Emoji picker */}
        {showEmojiPicker && (
          <div className="apf-field">
            <EmojiPicker selected={icon} onSelect={(e) => { setIcon(e); if (e) setShowEmojiPicker(false); }} />
          </div>
        )}

        {/* Owner type toggle — only when in family */}
        {inFamily && (
          <div className="apf-field">
            <span className="apf-label">Владелец</span>
            <div className="apf-segtog">
              {(['user', 'family'] as const).map((type) => (
                <button
                  key={type}
                  type="button"
                  className={`apf-segtog__opt${ownerType === type ? ' apf-segtog__opt--on' : ''}`}
                  onClick={() => setOwnerType(type)}
                  disabled={creating}
                >
                  {type === 'user' ? 'Личная' : 'Семейная'}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Group composition */}
        {kind === 'group' && (
          <>
            <div className="apf-field">
              <div className="ccd-grp-head">
                <span className="apf-label">Состав группы</span>
                <span className={`ccd-grp-pct${Math.abs(totalSharePercent - 100) < 0.001 ? ' ccd-grp-pct--ok' : ''}`}>
                  {loadingGroupOptions ? 'загружаем...' : `${totalSharePercent.toFixed(0)} / 100%`}
                </span>
              </div>

              {!loadingGroupOptions && (
                <div className="ccd-grp-rows">
                  {groupRows.map((row, idx) => (
                    <div className="ccd-grp-row" key={row.key}>
                      <span className="ccd-grp-num">{idx + 1}</span>
                      <CategorySelect
                        options={visibleGroupOptions}
                        value={row.child_category_id}
                        onChange={(id) => handleGroupRowChange(row.key, 'child_category_id', id)}
                        disabled={creating}
                      />
                      <div className="ccd-grp-pct-wrap">
                        <input
                          className="apf-input ccd-grp-pct-inp"
                          type="text"
                          inputMode="decimal"
                          placeholder="0"
                          value={row.share_percent}
                          onChange={(event) => handleGroupRowChange(row.key, 'share_percent', event.target.value)}
                          disabled={creating}
                        />
                        <span className="ccd-grp-pct-sym">%</span>
                      </div>
                      <button
                        className="ccd-grp-remove"
                        type="button"
                        onClick={() => removeGroupRow(row.key)}
                        disabled={creating}
                        aria-label="Убрать"
                      >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" width="14" height="14"><path d="M18 6 6 18M6 6l12 12"/></svg>
                      </button>
                    </div>
                  ))}

                  <button
                    className="ccd-grp-add"
                    type="button"
                    onClick={addGroupRow}
                    disabled={creating}
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" width="14" height="14"><path d="M12 5v14M5 12h14"/></svg>
                    Добавить категорию
                  </button>
                </div>
              )}
            </div>
          </>
        )}

        {/* Error */}
        {error && <p className="apf-error">{error}</p>}

        {/* Actions */}
        <div className="apf-actions ccd-actions">
          <button className="apf-cancel" type="button" onClick={onClose} disabled={creating}>Отмена</button>
          <button
            className="apf-submit ccd-submit"
            type="button"
            onClick={() => void handleCreate()}
            disabled={creating || !name.trim()}
          >
            {creating ? '...' : 'Создать'}
          </button>
        </div>
      </div>
    </BottomSheet>
  );
}
