import { useState } from 'react';

import { createCategory } from '../api';
import { useModalOpen } from '../hooks/useModalOpen';


interface Props {
  kind: 'regular' | 'group';
  onClose: () => void;
  onSuccess: () => void;
}


export default function CreateCategoryDialog({ kind, onClose, onSuccess }: Props) {
  useModalOpen();
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const handleCreate = async () => {
    if (!name.trim()) return;

    setCreating(true);
    setError(null);

    try {
      await createCategory(name.trim(), kind);
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
        <div className="section__header">
          <div>
            <div className="section__eyebrow">Создание</div>
            <h2 className="section__title">
              {kind === 'group' ? 'Новая группа' : 'Новая категория'}
            </h2>
          </div>
        </div>

        <div className="operations-note">
          {kind === 'group'
            ? 'Создай группу, затем нажми на неё, чтобы настроить состав и доли.'
            : 'Добавь новую категорию, чтобы потом распределять по ней бюджет.'}
        </div>

        <div className="form-row">
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

        {error && (
          <p style={{ color: 'var(--tag-out-fg)', fontSize: '0.85rem', marginTop: 4 }}>
            {error}
          </p>
        )}

        <div className="modal-actions">
          <button
            className="btn"
            type="button"
            onClick={onClose}
            disabled={creating}
          >
            Отмена
          </button>
          <button
            className="btn btn--primary"
            type="button"
            onClick={handleCreate}
            disabled={creating || !name.trim()}
          >
            {creating ? '...' : 'Создать'}
          </button>
        </div>
      </div>
    </div>
  );
}
