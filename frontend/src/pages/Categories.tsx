import { useEffect, useState } from 'react';
import { fetchCategories, createCategory } from '../api';
import type { Category, UserContext } from '../types';

const KIND_LABELS: Record<string, string> = {
  system: 'Системная',
  regular: 'Расход',
  income: 'Доход',
  group: 'Группа',
};

const CREATABLE_KINDS = [
  { value: 'regular', label: 'Расход' },
  { value: 'income', label: 'Доход' },
  { value: 'group', label: 'Группа' },
];

export default function Categories(_props: { user: UserContext }) {
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [kind, setKind] = useState('regular');
  const [creating, setCreating] = useState(false);

  const load = () => {
    fetchCategories()
      .then(setCategories)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const handleCreate = async () => {
    if (!name.trim()) return;
    setCreating(true);
    try {
      await createCategory(name.trim(), kind);
      setName('');
      load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setCreating(false);
    }
  };

  if (loading) {
    return (
      <div className="status-screen">
        <h1>Загрузка...</h1>
      </div>
    );
  }

  if (error) {
    return (
      <div className="status-screen">
        <h1>Ошибка</h1>
        <p>{error}</p>
      </div>
    );
  }

  return (
    <>
      <h1 className="page-title">Категории</h1>

      <div className="panel">
        <div className="form-row">
          <input
            className="input"
            type="text"
            placeholder="Название"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
          />
          <select className="input" value={kind} onChange={(e) => setKind(e.target.value)}>
            {CREATABLE_KINDS.map((k) => (
              <option key={k.value} value={k.value}>{k.label}</option>
            ))}
          </select>
          <button className="btn" type="button" disabled={creating || !name.trim()} onClick={handleCreate}>
            {creating ? '...' : 'Создать'}
          </button>
        </div>
      </div>

      <section className="section">
        <div className="panel">
          {categories.length === 0 ? (
            <p className="list-row__sub">Нет категорий</p>
          ) : (
            <ul>
              {categories.map((cat) => (
                <li className="list-row" key={cat.id}>
                  <div>
                    <div className="list-row__title">{cat.name}</div>
                    <div className="list-row__sub">{KIND_LABELS[cat.kind] || cat.kind}</div>
                  </div>
                  <span className="pill">{cat.kind}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </>
  );
}
