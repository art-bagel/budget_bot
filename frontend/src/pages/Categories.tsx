import { useEffect, useMemo, useState } from 'react';

import {
  archiveCategory,
  createCategory,
  fetchCategories,
  fetchGroupMembers,
  replaceGroupMembers,
} from '../api';
import type { Category, UserContext } from '../types';


const KIND_LABELS: Record<string, string> = {
  regular: 'Обычная',
  group: 'Группа',
};

const CREATABLE_KINDS = [
  { value: 'regular', label: 'Обычная категория' },
  { value: 'group', label: 'Группа' },
];

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


export default function Categories({
  user,
  embedded = false,
}: {
  user: UserContext;
  embedded?: boolean;
}) {
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [kind, setKind] = useState<'regular' | 'group'>('regular');
  const [creating, setCreating] = useState(false);

  const [selectedGroupId, setSelectedGroupId] = useState('');
  const [groupRows, setGroupRows] = useState<GroupDraftRow[]>([createDraftRow(1)]);
  const [loadingGroup, setLoadingGroup] = useState(false);
  const [savingGroup, setSavingGroup] = useState(false);
  const [groupError, setGroupError] = useState<string | null>(null);
  const [archivingCategoryId, setArchivingCategoryId] = useState<number | null>(null);

  const regularCategories = useMemo(
    () => categories.filter((item) => item.kind === 'regular'),
    [categories],
  );
  const groups = useMemo(
    () => categories.filter((item) => item.kind === 'group'),
    [categories],
  );

  const loadGroupMembers = async (groupId: string) => {
    if (!groupId) {
      setGroupRows([createDraftRow(1)]);
      return;
    }

    setLoadingGroup(true);
    setGroupError(null);

    try {
      const members = await fetchGroupMembers(Number(groupId));

      if (members.length === 0) {
        setGroupRows([createDraftRow(1)]);
        return;
      }

      setGroupRows(
        members.map((member, index) => ({
          key: 'member-' + index + '-' + member.child_category_id,
          child_category_id: String(member.child_category_id),
          share_percent: String(Number((member.share * 100).toFixed(2))),
        })),
      );
    } catch (reason: any) {
      setGroupError(reason.message);
    } finally {
      setLoadingGroup(false);
    }
  };

  const loadCategories = async () => {
    setLoading(true);
    setError(null);

    try {
      const loadedCategories = await fetchCategories();
      const visibleCategories = loadedCategories.filter((item) => item.kind !== 'system');
      const availableGroups = visibleCategories.filter((item) => item.kind === 'group');
      const hasSelectedGroup = availableGroups.some((item) => String(item.id) === selectedGroupId);

      setCategories(visibleCategories);

      if (availableGroups.length === 0) {
        setSelectedGroupId('');
      } else if (!hasSelectedGroup) {
        setSelectedGroupId(String(availableGroups[0].id));
      }
    } catch (reason: any) {
      setError(reason.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadCategories();
  }, []);

  useEffect(() => {
    void loadGroupMembers(selectedGroupId);
  }, [selectedGroupId]);

  const handleCreate = async () => {
    const normalizedName = name.trim();
    if (!normalizedName) return;

    setCreating(true);
    setError(null);

    try {
      await createCategory(normalizedName, kind);
      setName('');
      await loadCategories();
    } catch (reason: any) {
      setError(reason.message);
    } finally {
      setCreating(false);
    }
  };

  const handleRowChange = (rowKey: string, field: 'child_category_id' | 'share_percent', value: string) => {
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
  const canSaveGroup =
    !savingGroup &&
    !!selectedGroupId &&
    validGroupRows.length > 0 &&
    Math.abs(totalSharePercent - 100) < 0.001;

  const handleSaveGroup = async () => {
    if (!selectedGroupId) return;

    const childCategoryIds = validGroupRows.map((row) => Number(row.child_category_id));
    const shares = validGroupRows.map((row) => Number(row.share_percent) / 100);

    setSavingGroup(true);
    setGroupError(null);

    try {
      await replaceGroupMembers(Number(selectedGroupId), childCategoryIds, shares);
      await loadCategories();
      await loadGroupMembers(selectedGroupId);
    } catch (reason: any) {
      setGroupError(reason.message);
    } finally {
      setSavingGroup(false);
    }
  };

  const handleArchiveCategory = async (categoryId: number) => {
    setArchivingCategoryId(categoryId);
    setError(null);

    try {
      const result = await archiveCategory(categoryId);
      await loadCategories();
      if (result.kind !== 'group' && selectedGroupId) {
        await loadGroupMembers(selectedGroupId);
      }
    } catch (reason: any) {
      setError(reason.message);
    } finally {
      setArchivingCategoryId(null);
    }
  };

  if (loading) {
    return (
      <div className="status-screen">
        <h1>Загрузка...</h1>
      </div>
    );
  }

  return (
    <>
      {!embedded && <h1 className="page-title">Категории и группы</h1>}

      <section className="section">
        <div className="section__header">
          <h2 className="section__title">Создать категорию</h2>
        </div>
        <div className="panel">
          <div className="form-row">
            <input
              className="input"
              type="text"
              placeholder="Название"
              value={name}
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => event.key === 'Enter' && handleCreate()}
            />
            <select
              className="input"
              value={kind}
              onChange={(event) => setKind(event.target.value as 'regular' | 'group')}
            >
              {CREATABLE_KINDS.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
            <button className="btn" type="button" disabled={creating || !name.trim()} onClick={handleCreate}>
              {creating ? '...' : 'Создать'}
            </button>
          </div>

          {error && (
            <p style={{ color: 'var(--tag-out-fg)', fontSize: '0.85rem', marginTop: 8 }}>
              {error}
            </p>
          )}
        </div>
      </section>

      <section className="section">
        <div className="section__header">
          <h2 className="section__title">Настроить группу</h2>
        </div>
        <div className="panel">
          <div className="operations-note">
            В группе хранятся только правила распределения. Сумма долей должна быть ровно 100%.
          </div>

          <div className="form-row">
            <select
              className="input"
              value={selectedGroupId}
              onChange={(event) => setSelectedGroupId(event.target.value)}
              disabled={groups.length === 0}
            >
              {groups.length === 0 ? (
                <option value="">Сначала создайте группу</option>
              ) : (
                groups.map((group) => (
                  <option key={group.id} value={group.id}>
                    {group.name}
                  </option>
                ))
              )}
            </select>
            <span className="tag tag--neutral">Сумма долей: {totalSharePercent.toFixed(2)}%</span>
          </div>

          {selectedGroupId && (
            <>
              {groupRows.map((row) => (
                <div className="form-row" key={row.key}>
                  <select
                    className="input"
                    value={row.child_category_id}
                    onChange={(event) => handleRowChange(row.key, 'child_category_id', event.target.value)}
                    disabled={loadingGroup}
                  >
                    <option value="">Выберите категорию</option>
                    {regularCategories.map((category) => (
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
                    onChange={(event) => handleRowChange(row.key, 'share_percent', event.target.value)}
                    disabled={loadingGroup}
                  />
                  <button className="btn" type="button" onClick={() => removeGroupRow(row.key)}>
                    Убрать
                  </button>
                </div>
              ))}

              <div className="form-row">
                <button className="btn" type="button" onClick={addGroupRow}>
                  Добавить категорию
                </button>
                <button className="btn btn--primary" type="button" disabled={!canSaveGroup} onClick={handleSaveGroup}>
                  {savingGroup ? '...' : 'Сохранить состав группы'}
                </button>
              </div>
            </>
          )}

          {groupError && (
            <p style={{ color: 'var(--tag-out-fg)', fontSize: '0.85rem', marginTop: 8 }}>
              {groupError}
            </p>
          )}
        </div>
      </section>

      <section className="section">
        <div className="section__header">
          <h2 className="section__title">Все категории</h2>
        </div>
        <div className="panel">
          {categories.length === 0 ? (
            <p className="list-row__sub">Нет категорий</p>
          ) : (
            <ul>
              {categories.map((category) => (
                <li className="list-row" key={category.id}>
                  <div>
                    <div className="list-row__title">{category.name}</div>
                    <div className="list-row__sub">{KIND_LABELS[category.kind] || category.kind}</div>
                  </div>
                  <div className="list-row__actions">
                    <span className="pill">{category.kind}</span>
                    <button
                      className="btn"
                      type="button"
                      disabled={archivingCategoryId === category.id}
                      onClick={() => handleArchiveCategory(category.id)}
                    >
                      {archivingCategoryId === category.id ? '...' : 'В архив'}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </>
  );
}
