import { useState } from 'react';

import { useModalOpen } from '../hooks/useModalOpen';

import {
  allocateBudget,
  allocateGroupBudget,
} from '../api';
import type {
  AllocateBudgetRequest,
  AllocateGroupBudgetRequest,
} from '../types';
import { formatAmount } from '../utils/format';
import { sanitizeDecimalInput } from '../utils/validation';


export interface TransferSource {
  category_id: number;
  name: string;
  kind: string;
  balance: number;
  currency_code: string;
}


export interface TransferTarget {
  category_id: number;
  name: string;
  kind: string;
  currency_code: string;
}


interface Props {
  sources: TransferSource[];
  initialSourceId: number | null;
  target: TransferTarget;
  baseCurrencyCode: string;
  onClose: () => void;
  onSuccess: () => void;
}


export default function TransferDialog({
  sources,
  initialSourceId,
  target,
  baseCurrencyCode,
  onClose,
  onSuccess,
}: Props) {
  useModalOpen();
  const [sourceId, setSourceId] = useState(initialSourceId !== null ? String(initialSourceId) : '');
  const [amount, setAmount] = useState('');
  const [comment, setComment] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const selectedSource = sources.find((item) => String(item.category_id) === sourceId) || null;
  const canSubmit = !submitting && !!selectedSource && parseFloat(amount) > 0;

  const handleSubmit = async () => {
    if (!selectedSource || parseFloat(amount) <= 0) return;

    setSubmitting(true);
    setError(null);

    try {
      if (target.kind === 'group') {
        await allocateGroupBudget({
          from_category_id: selectedSource.category_id,
          group_id: target.category_id,
          amount_in_base: parseFloat(amount),
          comment: comment.trim() || undefined,
        } as AllocateGroupBudgetRequest);
      } else {
        await allocateBudget({
          from_category_id: selectedSource.category_id,
          to_category_id: target.category_id,
          amount_in_base: parseFloat(amount),
          comment: comment.trim() || undefined,
        } as AllocateBudgetRequest);
      }

      onSuccess();
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={() => !submitting && onClose()}>
      <div className="modal-card" onClick={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <div className="section__header">
            <div>
              <div className="section__eyebrow">Перевод бюджета</div>
              <h2 className="section__title">Перенос между категориями</h2>
            </div>
          </div>
        </div>

        <div className="modal-body">
          <div className="operations-note">
            Выбери источник и сумму для перевода в <strong>{target.name}</strong>.
          </div>

          <div className="form-row">
            <select
              className="input"
              value={sourceId}
              onChange={(event) => setSourceId(event.target.value)}
              disabled={submitting}
            >
              <option value="">Откуда перевести</option>
              {sources.map((item) => (
                <option key={item.category_id} value={item.category_id}>
                  {item.name} · {formatAmount(item.balance, item.currency_code)}
                </option>
              ))}
            </select>
          </div>

          <div className="form-row">
            <div className="input input--read-only" style={{ flex: 1 }}>
              Куда: {target.name}
            </div>
          </div>

          <div className="form-row">
            <input
              className="input"
              type="text"
              inputMode="decimal"
              placeholder={`Сумма в ${baseCurrencyCode}`}
              value={amount}
              onChange={(event) => setAmount(sanitizeDecimalInput(event.target.value))}
            />
          </div>

          <div className="form-row">
            <input
              className="input"
              type="text"
              placeholder="Комментарий (необязательно)"
              value={comment}
              onChange={(event) => setComment(event.target.value)}
              onKeyDown={(event) => event.key === 'Enter' && !submitting && handleSubmit()}
              style={{ flex: 1 }}
            />
          </div>

          {error && (
            <p style={{ color: 'var(--tag-out-fg)', fontSize: '0.85rem', marginTop: 4 }}>
              {error}
            </p>
          )}
        </div>

        <div className="modal-actions">
          <button className="btn" type="button" onClick={onClose} disabled={submitting}>
            Отмена
          </button>
          <button
            className="btn btn--primary"
            type="button"
            disabled={!canSubmit}
            onClick={handleSubmit}
          >
            {submitting ? '...' : 'Перевести'}
          </button>
        </div>
      </div>
    </div>
  );
}
