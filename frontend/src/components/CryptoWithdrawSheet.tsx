import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, Wallet } from 'lucide-react';

import BottomSheet from './BottomSheet';
import { useModalOpen } from '../hooks/useModalOpen';
import { transferCryptoFromInvestment } from '../api';
import { sanitizeDecimalInput } from '../utils/validation';
import { currencySymbol, formatNumericAmount } from '../utils/format';
import { getCryptoIconUrl } from '../utils/cryptoAssets';
import {
  formatDraftDecimal,
  getPositionMetadataText,
  isSameAccountOwner,
  todayIso,
} from '../utils/portfolioPosition';
import type {
  BankAccount,
  CryptoLivePrice,
  PortfolioPosition,
} from '../types';


interface Props {
  open: boolean;
  position: PortfolioPosition;
  cashAccounts: BankAccount[];
  livePrice?: CryptoLivePrice | null;
  baseCurrencyCode: string;
  defaultBankAccountId?: number | null;
  onClose: () => void;
  onSuccess: () => void;
}


export default function CryptoWithdrawSheet({
  open,
  position,
  cashAccounts,
  livePrice,
  baseCurrencyCode,
  defaultBankAccountId,
  onClose,
  onSuccess,
}: Props) {
  useModalOpen(open);

  const symbol = getPositionMetadataText(position, 'asset_symbol') ?? position.title;
  const sourceQuantity = position.quantity ?? 0;

  const targets = useMemo(
    () => cashAccounts.filter((account) => isSameAccountOwner(account, position)),
    [cashAccounts, position],
  );

  const defaultBank = targets.find((a) => a.id === defaultBankAccountId) ?? targets[0];
  const defaultAmount = sourceQuantity > 0 ? formatDraftDecimal(sourceQuantity, 8) : '';
  const computeValueInBase = (amountText: string): string => {
    const amount = Number(amountText);
    if (!livePrice || !Number.isFinite(amount) || amount <= 0) return '';
    return String(Number((livePrice.price * amount).toFixed(2)));
  };

  const [bankAccountId, setBankAccountId] = useState<string>(defaultBank ? String(defaultBank.id) : '');
  const [amount, setAmount] = useState(defaultAmount);
  const [valueInBase, setValueInBase] = useState(computeValueInBase(defaultAmount));
  const [withdrawnAt, setWithdrawnAt] = useState(todayIso());
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [valueTouched, setValueTouched] = useState(false);

  // Refresh suggested value when amount changes (only if user hasn't manually edited it).
  useEffect(() => {
    if (valueTouched) return;
    setValueInBase(computeValueInBase(amount));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [amount, livePrice?.price]);

  const amountNum = Number(amount);
  const valueNum = Number(valueInBase);
  const exceedsBalance = sourceQuantity > 0 && Number.isFinite(amountNum) && amountNum > sourceQuantity;
  const canSubmit = !submitting
    && !exceedsBalance
    && !!bankAccountId
    && Number.isFinite(amountNum) && amountNum > 0
    && Number.isFinite(valueNum) && valueNum > 0;

  const targetBank = targets.find((a) => String(a.id) === bankAccountId);

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      await transferCryptoFromInvestment({
        position_id: position.id,
        bank_account_id: Number(bankAccountId),
        amount: amountNum,
        value_in_base: valueNum,
        comment: comment.trim() || undefined,
        operated_at: withdrawnAt || undefined,
      });
      onSuccess();
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSubmitting(false);
    }
  };

  const iconUrl = getCryptoIconUrl(symbol, position.metadata);
  const baseSym = currencySymbol(baseCurrencyCode);

  return (
    <BottomSheet
      open={open}
      tag="Криптовалюта"
      title={`В банк · ${symbol}`}
      icon={iconUrl ? <img src={iconUrl} alt="" /> : undefined}
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
              {submitting ? 'Выводим…' : 'Подтвердить вывод'}
            </button>
          </div>
        </div>
      )}
    >
      <div className="field">
        <span className="fl">Куда вывести</span>
        <select
          className="picker-v2"
          value={bankAccountId}
          onChange={(event) => setBankAccountId(event.target.value)}
          disabled={submitting}
        >
          <option value="">Выберите банковский счёт</option>
          {targets.map((account) => (
            <option key={account.id} value={account.id}>{account.name}</option>
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
            value={amount}
            onChange={(event) => setAmount(sanitizeDecimalInput(event.target.value))}
            disabled={submitting}
          />
          <span className="amt__cur">{symbol}</span>
        </div>
        <span className="amt__hint">
          В позиции: {formatNumericAmount(sourceQuantity, 8)} {symbol}
        </span>
      </div>

      <div className="field">
        <span className="fl">Оценка в {baseCurrencyCode}</span>
        <div className="amt">
          <input
            className="amt__inp"
            type="text"
            inputMode="decimal"
            placeholder="0"
            value={valueInBase}
            onChange={(event) => {
              setValueTouched(true);
              setValueInBase(sanitizeDecimalInput(event.target.value));
            }}
            disabled={submitting}
          />
          <span className="amt__cur">{baseSym}</span>
        </div>
        {livePrice && (
          <span className="amt__hint">
            Live: 1 {symbol} ≈ {formatNumericAmount(livePrice.price, 6)} {currencySymbol(livePrice.vs_currency)}.
            {valueTouched ? ' Значение редактировано вручную.' : ' Подставлено автоматически.'}
          </span>
        )}
      </div>

      <div className="field">
        <span className="fl">Дата</span>
        <input
          className="picker-v2"
          type="date"
          value={withdrawnAt}
          onChange={(event) => setWithdrawnAt(event.target.value)}
          disabled={submitting}
        />
      </div>

      {exceedsBalance && (
        <div className="tk-error">
          <AlertCircle strokeWidth={2} />
          <span>Сумма превышает остаток в позиции.</span>
        </div>
      )}

      {targetBank && (
        <div className="cs-sheet__hint">
          <Wallet size={14} strokeWidth={2.2} />
          <span>
            На счёте «{targetBank.name}» появится новый crypto-лот {symbol} с cost basis = указанная оценка.
          </span>
        </div>
      )}

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
