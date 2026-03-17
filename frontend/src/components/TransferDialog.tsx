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
  owner_type?: string;
}


export interface TransferTarget {
  category_id: number;
  name: string;
  kind: string;
  currency_code: string;
  owner_type?: string;
}


interface Props {
  sources: TransferSource[];
  initialSourceId: number | null;
  target: TransferTarget;
  extraTargets?: TransferTarget[];
  baseCurrencyCode: string;
  onClose: () => void;
  onSuccess: () => void;
}


export default function TransferDialog({
  sources,
  initialSourceId,
  target,
  extraTargets,
  baseCurrencyCode,
  onClose,
  onSuccess,
}: Props) {
  useModalOpen();
  const allTargets = extraTargets && extraTargets.length > 0 ? [target, ...extraTargets] : null;
  const [selectedTargetId, setSelectedTargetId] = useState(target.category_id);
  const activeTarget = allTargets?.find((t) => t.category_id === selectedTargetId) ?? target;
  const visibleSources = activeTarget.owner_type
    ? sources.filter((s) => !s.owner_type || s.owner_type === activeTarget.owner_type)
    : sources;
  const [sourceId, setSourceId] = useState(initialSourceId !== null ? String(initialSourceId) : '');
  const [amount, setAmount] = useState('');
  const [comment, setComment] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleTargetChange = (targetId: number) => {
    setSelectedTargetId(targetId);
    const newTarget = allTargets?.find((t) => t.category_id === targetId);
    if (newTarget?.owner_type && sourceId) {
      const stillValid = sources.some(
        (s) => String(s.category_id) === sourceId && (!s.owner_type || s.owner_type === newTarget.owner_type),
      );
      if (!stillValid) setSourceId('');
    }
  };

  const selectedSource = visibleSources.find((item) => String(item.category_id) === sourceId) || null;
  const amountValue = parseFloat(amount);
  const hasPositiveBalance = (selectedSource?.balance || 0) > 0;
  const exceedsSourceBalance = !!selectedSource && amountValue > selectedSource.balance;
  const validationMessage = !selectedSource
    ? null
    : !hasPositiveBalance
      ? 'В выбранной категории нет денег для перевода.'
      : exceedsSourceBalance
        ? `Нельзя перевести больше, чем есть в источнике: ${formatAmount(selectedSource.balance, selectedSource.currency_code)}.`
        : null;
  const canSubmit = !submitting && !!selectedSource && amountValue > 0 && !validationMessage;

  const handleSubmit = async () => {
    if (!selectedSource || amountValue <= 0) return;

    if (validationMessage) {
      setError(validationMessage);
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      if (activeTarget.kind === 'group') {
        await allocateGroupBudget({
          from_category_id: selectedSource.category_id,
          group_id: activeTarget.category_id,
          amount_in_base: parseFloat(amount),
          comment: comment.trim() || undefined,
        } as AllocateGroupBudgetRequest);
      } else {
        await allocateBudget({
          from_category_id: selectedSource.category_id,
          to_category_id: activeTarget.category_id,
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
            Выбери источник и сумму для перевода.
          </div>

          {allTargets && (
            <div className="form-row">
              {allTargets.map((t) => (
                <button
                  key={t.category_id}
                  type="button"
                  onClick={() => handleTargetChange(t.category_id)}
                  disabled={submitting}
                  style={{
                    flex: 1,
                    padding: '8px 12px',
                    fontSize: '0.9rem',
                    background: selectedTargetId === t.category_id ? '#22a84a' : 'transparent',
                    color: selectedTargetId === t.category_id ? '#fff' : 'var(--text-primary)',
                    border: 'none',
                    borderRadius: 8,
                    cursor: submitting ? 'default' : 'pointer',
                    outline: 'none',
                  }}
                >
                  {t.owner_type === 'family' ? 'Семейный' : 'Личный'}
                </button>
              ))}
            </div>
          )}

          {validationMessage && (
            <p style={{ color: 'var(--tag-out-fg)', fontSize: '0.85rem', marginBottom: 14 }}>
              {validationMessage}
            </p>
          )}

          <div className="form-row">
            <select
              className="input"
              value={sourceId}
              onChange={(event) => setSourceId(event.target.value)}
              disabled={submitting}
            >
              <option value="">Откуда перевести</option>
              {visibleSources.map((item) => (
                <option key={item.category_id} value={item.category_id}>
                  {item.name} · {formatAmount(item.balance, item.currency_code)}
                </option>
              ))}
            </select>
          </div>

          <div className="form-row">
            <div className="input input--read-only" style={{ flex: 1 }}>
              Куда: {activeTarget.name}
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
          <div className="action-pill">
            <button className="action-pill__cancel" type="button" onClick={onClose} disabled={submitting}>
              Отмена
            </button>
            <button className="action-pill__confirm" type="button" disabled={!canSubmit} onClick={handleSubmit}>
              {submitting ? '...' : 'Перевести'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
