import { useEffect, useMemo, useState } from 'react';
import { AlertCircle } from 'lucide-react';

import BottomSheet from './BottomSheet';
import { useModalOpen } from '../hooks/useModalOpen';
import { partialCloseCryptoProtocolPosition } from '../api';
import { sanitizeDecimalInput } from '../utils/validation';
import { currencySymbol, formatNumericAmount } from '../utils/format';
import { todayIso } from '../utils/portfolioPosition';
import type { CryptoProtocolPosition } from '../types';


interface Props {
  open: boolean;
  position: CryptoProtocolPosition;
  baseCurrencyCode: string;
  onClose: () => void;
  onSuccess: () => void;
}


function suggestValue(qty: number, refQty: number, refValue: number): string {
  if (!Number.isFinite(qty) || qty <= 0) return '';
  if (!Number.isFinite(refQty) || refQty <= 0) return '';
  if (!Number.isFinite(refValue) || refValue <= 0) return '';
  const value = (qty * refValue) / refQty;
  return String(Number(value.toFixed(2)));
}


export default function CryptoProtocolPartialCloseSheet({
  open,
  position,
  baseCurrencyCode,
  onClose,
  onSuccess,
}: Props) {
  useModalOpen(open);

  const symbol = position.asset_symbol;
  const baseSym = currencySymbol(baseCurrencyCode);

  const principalRemaining = position.quantity ?? 0;
  const currentQuantity = position.current_quantity ?? principalRemaining;
  const currentValue = position.current_value_in_base ?? 0;
  const unclaimedRewards = position.rewards_unclaimed_in_base ?? 0;

  const [principalQty, setPrincipalQty] = useState('');
  const [principalValue, setPrincipalValue] = useState('');
  const [principalValueTouched, setPrincipalValueTouched] = useState(false);
  const [rewardsQty, setRewardsQty] = useState('');
  const [rewardsValue, setRewardsValue] = useState('');
  const [rewardsValueTouched, setRewardsValueTouched] = useState(false);
  const [returnedAt, setReturnedAt] = useState(todayIso());
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setPrincipalQty('');
      setPrincipalValue('');
      setPrincipalValueTouched(false);
      setRewardsQty('');
      setRewardsValue('');
      setRewardsValueTouched(false);
      setReturnedAt(todayIso());
      setComment('');
      setError(null);
    }
  }, [open]);

  // Auto-suggest principal value as user types qty (proportional split of current_value).
  useEffect(() => {
    if (principalValueTouched) return;
    setPrincipalValue(suggestValue(Number(principalQty), currentQuantity, currentValue));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [principalQty, currentQuantity, currentValue]);

  useEffect(() => {
    if (rewardsValueTouched) return;
    setRewardsValue(suggestValue(Number(rewardsQty), currentQuantity, currentValue));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rewardsQty, currentQuantity, currentValue]);

  const principalQtyNum = Number(principalQty);
  const rewardsQtyNum = Number(rewardsQty);
  const principalValueNum = Number(principalValue);
  const rewardsValueNum = Number(rewardsValue);

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
      const principalValForApi = principalQtyNum > 0
        ? (Number.isFinite(principalValueNum) && principalValueNum > 0 ? principalValueNum : undefined)
        : undefined;
      const rewardsValForApi = rewardsQtyNum > 0
        ? (Number.isFinite(rewardsValueNum) && rewardsValueNum > 0 ? rewardsValueNum : undefined)
        : undefined;
      await partialCloseCryptoProtocolPosition(position.id, {
        principal_qty: principalQtyNum > 0 ? principalQtyNum : 0,
        rewards_qty: rewardsQtyNum > 0 ? rewardsQtyNum : 0,
        principal_value_in_base: principalValForApi,
        rewards_value_in_base: rewardsValForApi,
        returned_at: returnedAt || undefined,
        comment: comment.trim() || undefined,
      });
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
          <span>Из них principal</span>
          <strong>{formatNumericAmount(principalRemaining, 8)} {symbol}</strong>
        </div>
        <div className="ppc-sheet__summary-row">
          <span>Текущая оценка</span>
          <strong>{formatNumericAmount(currentValue, 2)} {baseSym}</strong>
        </div>
        <div className="ppc-sheet__summary-row">
          <span>Награды нереализованные</span>
          <strong>{formatNumericAmount(unclaimedRewards, 2)} {baseSym}</strong>
        </div>
      </div>

      <h4 className="ppc-sheet__section">Principal</h4>
      <p className="ppc-sheet__hint">
        Принципал переносит cost basis из DeFi (макс. {formatNumericAmount(principalRemaining, 8)} {symbol}).
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
        <div className="apf-field" style={{ flex: 1 }}>
          <label className="apf-label">Оценка в {baseCurrencyCode}</label>
          <div className="amt">
            <input
              className="amt__inp"
              type="text"
              inputMode="decimal"
              placeholder="0"
              value={principalValue}
              onChange={(event) => {
                setPrincipalValueTouched(true);
                setPrincipalValue(sanitizeDecimalInput(event.target.value));
              }}
              disabled={submitting}
            />
            <span className="amt__cur">{baseSym}</span>
          </div>
        </div>
      </div>

      <h4 className="ppc-sheet__section">Награды</h4>
      <p className="ppc-sheet__hint">
        Награды зачисляются с zero-cost (income event). На P&L влияют только при выводе в банк.
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
        <div className="apf-field" style={{ flex: 1 }}>
          <label className="apf-label">Оценка в {baseCurrencyCode}</label>
          <div className="amt">
            <input
              className="amt__inp"
              type="text"
              inputMode="decimal"
              placeholder="0"
              value={rewardsValue}
              onChange={(event) => {
                setRewardsValueTouched(true);
                setRewardsValue(sanitizeDecimalInput(event.target.value));
              }}
              disabled={submitting}
            />
            <span className="amt__cur">{baseSym}</span>
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
