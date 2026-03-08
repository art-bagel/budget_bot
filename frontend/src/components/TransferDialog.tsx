import { useState } from 'react';

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
  source: TransferSource;
  target: TransferTarget;
  baseCurrencyCode: string;
  onClose: () => void;
  onSuccess: () => void;
}


export default function TransferDialog({ source, target, baseCurrencyCode, onClose, onSuccess }: Props) {
  const [amount, setAmount] = useState('');
  const [comment, setComment] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (parseFloat(amount) <= 0) return;

    setSubmitting(true);
    setError(null);

    try {
      if (target.kind === 'group') {
        await allocateGroupBudget({
          from_category_id: source.category_id,
          group_id: target.category_id,
          amount_in_base: parseFloat(amount),
          comment: comment.trim() || undefined,
        } as AllocateGroupBudgetRequest);
      } else {
        await allocateBudget({
          from_category_id: source.category_id,
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
        <div className="section__header">
          <div>
            <div className="section__eyebrow">Перевод бюджета</div>
            <h2 className="section__title">Перенос между категориями</h2>
          </div>
        </div>

        <div className="operations-note">
          Из <strong>{source.name}</strong> ({formatAmount(source.balance, source.currency_code)}) в <strong>{target.name}</strong>.
        </div>

        <div className="form-row">
          <div className="input input--read-only">
            Из: {source.name}
          </div>
          <div className="input input--read-only">
            В: {target.name}
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

        <div className="modal-actions">
          <button className="btn" type="button" onClick={onClose} disabled={submitting}>
            Отмена
          </button>
          <button
            className="btn btn--primary"
            type="button"
            disabled={submitting || !(parseFloat(amount) > 0)}
            onClick={handleSubmit}
          >
            {submitting ? '...' : 'Перевести'}
          </button>
        </div>
      </div>
    </div>
  );
}
