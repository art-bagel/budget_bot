import { useEffect, useRef, useState } from 'react';

import {
  archiveCategory,
  fetchCategories,
  fetchGroupMembers,
  replaceGroupMembers,
  updateCategory,
} from '../api';
import type {
  Category,
  DashboardBudgetCategory,
} from '../types';


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
  const [nameDraft, setNameDraft] = useState(category.name);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);

  const [groupRows, setGroupRows] = useState<GroupDraftRow[]>([createDraftRow(1)]);
  const [initialGroupRowsSnapshot, setInitialGroupRowsSnapshot] = useState('[]');
  const [groupRegularCategories, setGroupRegularCategories] = useState<Category[]>([]);
  const [loadingGroupSettings, setLoadingGroupSettings] = useState(false);
  const requestIdRef = useRef(0);

  useEffect(() => {
    if (category.kind !== 'group') return;

    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setLoadingGroupSettings(true);
    setError(null);

    void Promise.all([
      fetchCategories(),
      fetchGroupMembers(category.category_id),
    ])
      .then(([loadedCategories, members]) => {
        if (requestIdRef.current !== requestId) return;

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
      .catch((reason: unknown) => {
        if (requestIdRef.current !== requestId) return;
        setError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => {
        if (requestIdRef.current === requestId) {
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
  const hasNameChanged = nameDraft.trim() !== category.name;
  const canSaveGroupSettings = category.kind === 'group' &&
    !loadingGroupSettings &&
    validGroupRows.length > 0 &&
    Math.abs(totalSharePercent - 100) < 0.001;
  const canSubmit =
    !saving &&
    !archiving &&
    !!nameDraft.trim() &&
    (hasNameChanged || groupRowsChanged) &&
    (category.kind !== 'group' || !groupRowsChanged || canSaveGroupSettings);

  const handleSubmit = async () => {
    if (!nameDraft.trim()) return;

    if (category.kind === 'group' && groupRowsChanged && !canSaveGroupSettings) {
      setError('Для группы нужна хотя бы одна категория, а сумма долей должна быть ровно 100%.');
      return;
    }

    setSaving(true);
    setError(null);

    try {
      if (hasNameChanged) {
        await updateCategory(category.category_id, nameDraft.trim());
      }

      if (category.kind === 'group' && groupRowsChanged) {
        await replaceGroupMembers(
          category.category_id,
          validGroupRows.map((row) => Number(row.child_category_id)),
          validGroupRows.map((row) => Number(row.share_percent) / 100),
        );
      }

      onSuccess();
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSaving(false);
    }
  };

  const handleArchive = async () => {
    if (!confirmArchive) {
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
        <div className="section__header">
          <div>
            <div className="section__eyebrow">Категория</div>
            <h2 className="section__title">Редактирование категории</h2>
          </div>
          <span className="pill">{category.kind}</span>
        </div>

        <div className="operations-note">
          Тут можно переименовать категорию или убрать её в архив.
        </div>

        <div className="form-row">
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
                  {groupRegularCategories.map((cat) => (
                    <option key={cat.id} value={cat.id}>
                      {cat.name}
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

        {error && (
          <p style={{ color: 'var(--tag-out-fg)', fontSize: '0.85rem', marginTop: 4 }}>
            {error}
          </p>
        )}

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
            <button
              className="btn"
              type="button"
              onClick={onClose}
              disabled={isBusy}
            >
              Отмена
            </button>
            <button
              className="btn btn--primary"
              type="button"
              onClick={handleSubmit}
              disabled={!canSubmit}
            >
              {saving ? '...' : 'Сохранить'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
