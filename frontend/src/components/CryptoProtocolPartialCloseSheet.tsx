import { useCryptoRequestKey } from '../hooks/useCryptoRequestKey';
import { useEffect, useMemo, useState } from 'react';
import { AlertCircle } from 'lucide-react';

import BottomSheet from './BottomSheet';
import { useModalOpen } from '../hooks/useModalOpen';
import { partialCloseCryptoProtocolPosition } from '../api';
import { sanitizeDecimalInput } from '../utils/validation';
import { formatNumericAmount } from '../utils/format';
import { todayIso } from '../utils/portfolioPosition';
import type { CryptoProtocolPosition } from '../types';


interface Props {
  open: boolean;
  position: CryptoProtocolPosition;
  baseCurrencyCode: string;
  onClose: () => void;
  onSuccess: () => void;
}


export default function CryptoProtocolPartialCloseSheet({
  open,
  position,
  onClose,
  onSuccess,
}: Props) {
  const manualRequest = useCryptoRequestKey(`CryptoProtocolPartialCloseSheet.tsx:${position.id}:1`);
  useModalOpen(open);

  const symbol = position.asset_symbol;

  const principalRemaining = position.quantity ?? 0;
  const currentQuantity = position.current_quantity ?? principalRemaining;

  const [principalQty, setPrincipalQty] = useState('');
  const [rewardsQty, setRewardsQty] = useState('');
  const [returnedAt, setReturnedAt] = useState(todayIso());
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setPrincipalQty('');
      setRewardsQty('');
      setReturnedAt(todayIso());
      setComment('');
      setError(null);
    }
  }, [open]);

  const principalQtyNum = Number(principalQty);
  const rewardsQtyNum = Number(rewardsQty);

  const principalQtyValid = principalQty === '' || (Number.isFinite(principalQtyNum) && principalQtyNum >= 0);
  const rewardsQtyValid = rewardsQty === '' || (Number.isFinite(rewardsQtyNum) && rewardsQtyNum >= 0);

  const totalQty = (principalQtyNum > 0 ? principalQtyNum : 0) + (rewardsQtyNum > 0 ? rewardsQtyNum : 0);
  const exceedsPrincipal = principalQtyNum > principalRemaining + 1e-9;
  const exceedsCurrent = totalQty > currentQuantity + 1e-9;
  const atLeastOnePositive = (principalQtyNum > 0) || (rewardsQtyNum > 0);

  const validationError = useMemo<string | null>(() => {
    if (!principalQtyValid) return 'Principal qty невалидно';
    if (!rewardsQtyValid) return 'Rewards qty невалидно';
    if (!atLeastOnePositive) return 'Укажите principal или rewards (или оба)';
    if (exceedsPrincipal) return `Principal ≤ ${formatNumericAmount(principalRemaining, 8)} ${symbol}`;
    if (exceedsCurrent) return `Сумма ≤ ${formatNumericAmount(currentQuantity, 8)} ${symbol} (в позиции сейчас)`;
    return null;
  }, [
    principalQtyValid, rewardsQtyValid, atLeastOnePositive,
    exceedsPrincipal, exceedsCurrent,
    principalRemaining, currentQuantity, symbol,
  ]);

  const canSubmit = !submitting && !validationError;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const payload = {
        principal_qty: principalQty.trim() || "0",
        rewards_qty: rewardsQty.trim() || "0",
        returned_at: returnedAt || undefined,
        comment: comment.trim() || undefined,
      };
      await partialCloseCryptoProtocolPosition(position.id, { ...payload, request_id: manualRequest.requestId(payload) });
      manualRequest.completed();
      onSuccess();
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <BottomSheet
      open={open}
      tag={`DeFi · ${position.protocol_name}`}
      title={`Частичный вывод · ${symbol}`}
      onClose={onClose}
      actions={(
        <div className="tk-foot pf-sheet-actions">
          {(error || validationError) && (
            <div className="tk-error">
              <AlertCircle strokeWidth={2} />
              <span>{error ?? validationError}</span>
            </div>
          )}
          <div className="tk-foot__row">
            <button className="btn btn--ghost" type="button" onClick={onClose} disabled={submitting}>
              Отмена
            </button>
            <button
              className="btn btn--primary"
              type="button"
              onClick={() => void handleSubmit()}
              disabled={!canSubmit}
            >
              {submitting ? 'Возвращаем…' : 'Подтвердить'}
            </button>
          </div>
        </div>
      )}
    >
      <div className="ppc-sheet__summary">
        <div className="ppc-sheet__summary-row">
          <span>В позиции сейчас</span>
          <strong>{formatNumericAmount(currentQuantity, 8)} {symbol}</strong>
        </div>
        <div className="ppc-sheet__summary-row">
          <span>Основная сумма</span>
          <strong>{formatNumericAmount(principalRemaining, 8)} {symbol}</strong>
        </div>


      </div>

      <h4 className="ppc-sheet__section">Основная сумма</h4>
      <p className="ppc-sheet__hint">
        Себестоимость основной суммы переносится из DeFi (макс. {formatNumericAmount(principalRemaining, 8)} {symbol}).
      </p>
      <div className="apf-row">
        <div className="apf-field" style={{ flex: 1 }}>
          <label className="apf-label">Количество</label>
          <div className="amt">
            <input
              className="amt__inp"
              type="text"
              inputMode="decimal"
              placeholder="0"
              value={principalQty}
              onChange={(event) => setPrincipalQty(sanitizeDecimalInput(event.target.value))}
              disabled={submitting}
            />
            <span className="amt__cur">{symbol}</span>
          </div>
        </div>

      </div>

      <h4 className="ppc-sheet__section">Награды</h4>
      <p className="ppc-sheet__hint">
        Награды зачисляются с нулевой себестоимостью. Предварительно учтите начисленные монеты в карточке DeFi.
      </p>
      <div className="apf-row">
        <div className="apf-field" style={{ flex: 1 }}>
          <label className="apf-label">Количество</label>
          <div className="amt">
            <input
              className="amt__inp"
              type="text"
              inputMode="decimal"
              placeholder="0"
              value={rewardsQty}
              onChange={(event) => setRewardsQty(sanitizeDecimalInput(event.target.value))}
              disabled={submitting}
            />
            <span className="amt__cur">{symbol}</span>
          </div>
        </div>

      </div>

      <div className="apf-field">
        <label className="apf-label">Дата</label>
        <input
          className="apf-input"
          type="date"
          value={returnedAt}
          onChange={(event) => setReturnedAt(event.target.value)}
          disabled={submitting}
        />
      </div>

      <div className="apf-field">
        <label className="apf-label">Комментарий</label>
        <input
          className="apf-input"
          type="text"
          placeholder="Необязательно"
          value={comment}
          onChange={(event) => setComment(event.target.value)}
          disabled={submitting}
        />
      </div>
    </BottomSheet>
  );
}
