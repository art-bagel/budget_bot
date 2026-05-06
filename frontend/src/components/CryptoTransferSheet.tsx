import { useMemo, useState } from 'react';
import { AlertCircle, ArrowLeftRight } from 'lucide-react';

import BottomSheet from './BottomSheet';
import { useModalOpen } from '../hooks/useModalOpen';
import { transferCryptoBetweenInvestmentAccounts } from '../api';
import { sanitizeDecimalInput } from '../utils/validation';
import { formatNumericAmount } from '../utils/format';
import { getCryptoIconUrl } from '../utils/cryptoAssets';
import {
  formatDraftDecimal,
  getPositionMetadataText,
  isSameAccountOwner,
  todayIso,
} from '../utils/portfolioPosition';
import type {
  BankAccount,
  PortfolioPosition,
} from '../types';

type AccountEntry = { account: BankAccount };


interface Props {
  open: boolean;
  position: PortfolioPosition;
  accounts: AccountEntry[];
  onClose: () => void;
  onSuccess: () => void;
}


export default function CryptoTransferSheet({
  open,
  position,
  accounts,
  onClose,
  onSuccess,
}: Props) {
  useModalOpen(open);

  const symbol = getPositionMetadataText(position, 'asset_symbol') ?? position.title;
  const sourceQuantity = position.quantity ?? 0;

  const targets: BankAccount[] = useMemo(
    () => accounts
      .map(({ account }) => account)
      .filter((account) => account.account_kind === 'investment'
        && account.investment_asset_type === 'crypto'
        && isSameAccountOwner(account, position)
        && account.id !== position.investment_account_id),
    [accounts, position],
  );

  const defaultTarget = targets[0];
  const defaultAmount = sourceQuantity > 0 ? formatDraftDecimal(sourceQuantity, 8) : '';

  const [targetInvestmentAccountId, setTargetInvestmentAccountId] = useState<string>(
    defaultTarget ? String(defaultTarget.id) : '',
  );
  const [amount, setAmount] = useState(defaultAmount);
  const [operatedAt, setOperatedAt] = useState(todayIso());
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const amountNum = Number(amount);
  const exceedsBalance = sourceQuantity > 0 && Number.isFinite(amountNum) && amountNum > sourceQuantity;
  const canSubmit = !submitting
    && !exceedsBalance
    && !!targetInvestmentAccountId
    && Number.isFinite(amountNum) && amountNum > 0;

  const targetAccount = targets.find((a) => String(a.id) === targetInvestmentAccountId);

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      await transferCryptoBetweenInvestmentAccounts({
        position_id: position.id,
        target_investment_account_id: Number(targetInvestmentAccountId),
        amount: amountNum,
        comment: comment.trim() || undefined,
        operated_at: operatedAt || undefined,
      });
      onSuccess();
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSubmitting(false);
    }
  };

  const iconUrl = getCryptoIconUrl(symbol, position.metadata);

  return (
    <BottomSheet
      open={open}
      tag="Криптовалюта"
      title={`Перевод · ${symbol}`}
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
              {submitting ? 'Переводим…' : 'Подтвердить перевод'}
            </button>
          </div>
        </div>
      )}
    >
      {targets.length === 0 ? (
        <div className="cs-sheet__hint">
          <span>Нет других crypto-счетов с тем же владельцем для перевода.</span>
        </div>
      ) : (
        <>
          <div className="field">
            <span className="fl">Куда перевести</span>
            <select
              className="picker-v2"
              value={targetInvestmentAccountId}
              onChange={(event) => setTargetInvestmentAccountId(event.target.value)}
              disabled={submitting}
            >
              <option value="">Выберите crypto-счёт</option>
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
            <span className="fl">Дата</span>
            <input
              className="picker-v2"
              type="date"
              value={operatedAt}
              onChange={(event) => setOperatedAt(event.target.value)}
              disabled={submitting}
            />
          </div>

          {exceedsBalance && (
            <div className="tk-error">
              <AlertCircle strokeWidth={2} />
              <span>Сумма превышает остаток в позиции.</span>
            </div>
          )}

          {targetAccount && (
            <div className="cs-sheet__hint">
              <ArrowLeftRight size={14} strokeWidth={2.2} />
              <span>
                Cost basis перенесётся пропорционально (weighted-average) на счёт «{targetAccount.name}».
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
        </>
      )}
    </BottomSheet>
  );
}
