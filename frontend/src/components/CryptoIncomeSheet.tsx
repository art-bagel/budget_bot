import { useEffect, useState } from 'react';
import { AlertCircle, Gift } from 'lucide-react';

import BottomSheet from './BottomSheet';
import { useModalOpen } from '../hooks/useModalOpen';
import { recordPortfolioIncome } from '../api';
import { sanitizeDecimalInput } from '../utils/validation';
import { currencySymbol, formatNumericAmount } from '../utils/format';
import { todayIso } from '../utils/portfolioPosition';
import type { CryptoLivePrice } from '../types';


type IncomeKind = 'airdrop' | 'reward' | 'interest' | 'lp_fees' | 'fork' | 'other';

const KIND_OPTIONS: { value: IncomeKind; label: string }[] = [
  { value: 'airdrop', label: 'Airdrop' },
  { value: 'reward', label: 'Награда' },
  { value: 'interest', label: 'Проценты (lending)' },
  { value: 'lp_fees', label: 'Комиссии пула (LP)' },
  { value: 'fork', label: 'Fork' },
  { value: 'other', label: 'Другое' },
];


interface Props {
  open: boolean;
  positionId: number;
  symbol: string;
  iconUrl?: string | null;
  livePrice?: CryptoLivePrice | null;
  baseCurrencyCode: string;
  onClose: () => void;
  onSuccess: () => void;
}


export default function CryptoIncomeSheet({
  open,
  positionId,
  symbol,
  iconUrl,
  livePrice,
  baseCurrencyCode,
  onClose,
  onSuccess,
}: Props) {
  useModalOpen(open);

  const [quantity, setQuantity] = useState('');
  const [incomeKind, setIncomeKind] = useState<IncomeKind>('airdrop');
  const [receivedAt, setReceivedAt] = useState(todayIso());
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setQuantity('');
      setIncomeKind('airdrop');
      setReceivedAt(todayIso());
      setComment('');
      setError(null);
    }
  }, [open]);

  const qtyNum = Number(quantity);
  const canSubmit = !submitting && Number.isFinite(qtyNum) && qtyNum > 0;
  const baseSym = currencySymbol(baseCurrencyCode);
  const projectedValue = livePrice && livePrice.price > 0 && qtyNum > 0
    ? qtyNum * livePrice.price
    : null;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      await recordPortfolioIncome(positionId, {
        amount: 0,
        currency_code: baseCurrencyCode,
        quantity: qtyNum,
        income_kind: incomeKind,
        destination: 'position',
        received_at: receivedAt || undefined,
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
      tag="Криптовалюта"
      title={`Зачислить · ${symbol}`}
      icon={iconUrl ? <img src={iconUrl} alt="" /> : <Gift size={18} strokeWidth={2.2} />}
      iconColor={iconUrl ? undefined : 'o'}
      onClose={onClose}
      actions={(
        <div className="tk-foot pf-sheet-actions">
          {error && (
            <div className="tk-error">
              <AlertCircle strokeWidth={2} />
              <span>{error}</span>
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
              {submitting ? 'Зачисляем…' : 'Зачислить'}
            </button>
          </div>
        </div>
      )}
    >
      <div className="field">
        <span className="fl">Тип</span>
        <select
          className="picker-v2"
          value={incomeKind}
          onChange={(event) => setIncomeKind(event.target.value as IncomeKind)}
          disabled={submitting}
        >
          {KIND_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      </div>

      <div className="field">
        <span className="fl">Количество</span>
        <div className="amt">
          <input
            className="amt__inp"
            type="text"
            inputMode="decimal"
            placeholder="0"
            value={quantity}
            onChange={(event) => setQuantity(sanitizeDecimalInput(event.target.value))}
            disabled={submitting}
          />
          <span className="amt__cur">{symbol}</span>
        </div>
        {projectedValue !== null && (
          <span className="amt__hint">
            Текущая оценка: {formatNumericAmount(projectedValue)} {baseSym} (cost basis = 0)
          </span>
        )}
      </div>

      <div className="field">
        <span className="fl">Дата</span>
        <input
          className="picker-v2"
          type="date"
          value={receivedAt}
          onChange={(event) => setReceivedAt(event.target.value)}
          disabled={submitting}
        />
      </div>

      <div className="field">
        <span className="fl">Комментарий</span>
        <input
          className="inp-v2"
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
