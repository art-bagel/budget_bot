import { useEffect, useState } from 'react';

import { createCategory, fetchCategories, fetchMyFamily, replaceGroupMembers } from '../api';
import EmojiPicker from './EmojiPicker';
import { buildCategoryName } from '../utils/categoryIcon';
import { CategorySvgIcon } from './CategorySvgIcon';
import { useModalOpen } from '../hooks/useModalOpen';
import type { Category } from '../types';


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
          categories.filter((item) => item.is_active && item.kind !== 'system'),
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
        await replaceGroupMembers(
          result.id,
          validGroupRows.map((row) => Number(row.child_category_id)),
          validGroupRows.map((row) => Number(row.share_percent) / 100),
        );
      }

      onSuccess();
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={() => !creating && onClose()}>
      <div className="modal-card modal-card--compact" onClick={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <div className="section__header">
            <div>
              <div className="section__eyebrow">Создание</div>
              <h2 className="section__title">
                {kind === 'group' ? 'Новая группа' : 'Новая категория'}
              </h2>
            </div>
          </div>
        </div>

        <div className="modal-body">
          <div className="operations-note">
            {kind === 'group'
              ? 'Можно сразу задать состав группы и доли распределения. Если оставить поля пустыми, группа создастся без состава.'
              : 'Добавь новую категорию, чтобы потом распределять по ней бюджет.'}
          </div>

          <div className="form-row">
            <button
              type="button"
              className="category-icon-btn"
              onClick={() => setShowEmojiPicker((v) => !v)}
              aria-label="Выбрать иконку"
              title="Выбрать иконку"
            >
              {icon
                ? /\p{Extended_Pictographic}/u.test(icon)
                  ? icon
                  : <CategorySvgIcon code={icon} />
                : '＋'}
            </button>
            <input
              className="input"
              type="text"
              placeholder={kind === 'group' ? 'Название группы' : 'Название категории'}
              value={name}
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => event.key === 'Enter' && !creating && handleCreate()}
              style={{ flex: 1 }}
            />
          </div>

          {showEmojiPicker && (
            <div className="form-row" style={{ display: 'block', paddingTop: 0 }}>
              <EmojiPicker selected={icon} onSelect={(e) => { setIcon(e); if (e) setShowEmojiPicker(false); }} />
            </div>
          )}

          {inFamily && (
            <div className="form-row">
              {(['user', 'family'] as const).map((type) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => setOwnerType(type)}
                  disabled={creating}
                  style={{
                    flex: 1,
                    padding: '8px 12px',
                    fontSize: '0.9rem',
                    background: ownerType === type ? 'var(--bg-accent)' : 'transparent',
                    color: ownerType === type ? 'var(--text-on-accent)' : 'var(--text-primary)',
                    border: 'none',
                    borderRadius: 8,
                    cursor: creating ? 'default' : 'pointer',
                    outline: 'none',
                  }}
                >
                  {type === 'user' ? 'Личная' : 'Семейная'}
                </button>
              ))}
            </div>
          )}

          {kind === 'group' && (
            <>
              <div className="operations-note">
                Выбери категории или группы и задай доли. Сумма долей должна быть 100%.
              </div>

              <div className="form-row">
                <span className="tag tag--neutral">
                  Сумма долей: {totalSharePercent.toFixed(2)}%
                </span>
                {loadingGroupOptions ? <span className="tag tag--neutral">Загружаем варианты...</span> : null}
              </div>

              {!loadingGroupOptions && groupRows.map((row) => (
                <div className="form-row form-row--group-editor" key={row.key}>
                  <select
                    className="input"
                    value={row.child_category_id}
                    onChange={(event) => handleGroupRowChange(row.key, 'child_category_id', event.target.value)}
                    disabled={creating}
                  >
                    <option value="">Выберите элемент</option>
                    {groupSelectableCategories.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.kind === 'group' ? `${item.name} · группа` : item.name}
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
                    disabled={creating}
                  />
                  <button
                    className="btn"
                    type="button"
                    onClick={() => removeGroupRow(row.key)}
                    disabled={creating}
                  >
                    Убрать
                  </button>
                </div>
              ))}

              {!loadingGroupOptions && (
                <div className="form-row">
                  <button
                    className="btn"
                    type="button"
                    onClick={addGroupRow}
                    disabled={creating}
                  >
                    Добавить элемент
                  </button>
                </div>
              )}
            </>
          )}

          {error && (
            <p style={{ color: 'var(--tag-out-fg)', fontSize: '0.85rem', marginTop: 4 }}>
              {error}
            </p>
          )}
        </div>

        <div className="modal-actions">
          <div className="action-pill">
            <button className="action-pill__cancel" type="button" onClick={onClose} disabled={creating}>
              Отмена
            </button>
            <button className="action-pill__confirm" type="button" onClick={handleCreate} disabled={creating || !name.trim()}>
              {creating ? '...' : 'Создать'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
