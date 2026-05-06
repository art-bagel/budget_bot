import { useMemo, useState } from 'react';
import { AlertCircle, ArrowDown, Repeat } from 'lucide-react';

import BottomSheet from './BottomSheet';
import { useModalOpen } from '../hooks/useModalOpen';
import { swapCryptoInvestmentAsset } from '../api';
import { sanitizeDecimalInput } from '../utils/validation';
import { currencySymbol, formatNumericAmount } from '../utils/format';
import { getCryptoIconUrl } from '../utils/cryptoAssets';
import {
  formatDraftDecimal,
  getCryptoAssetId,
  getPositionMetadataText,
  isSameAccountOwner,
  todayIso,
} from '../utils/portfolioPosition';
import type {
  BankAccount,
  CryptoAsset,
  CryptoLivePrice,
  PortfolioPosition,
} from '../types';

type AccountEntry = { account: BankAccount };


interface Props {
  open: boolean;
  position: PortfolioPosition;
  cryptoAssets: CryptoAsset[];
  accounts: AccountEntry[];
  livePrice?: CryptoLivePrice | null;
  baseCurrencyCode: string;
  onClose: () => void;
  onSuccess: () => void;
}


export default function CryptoSwapSheet({
  open,
  position,
  cryptoAssets,
  accounts,
  livePrice,
  baseCurrencyCode,
  onClose,
  onSuccess,
}: Props) {
  useModalOpen(open);

  const sourceAssetId = getCryptoAssetId(position);
  const sourceSymbol = getPositionMetadataText(position, 'asset_symbol') ?? position.title;
  const sourceQuantity = position.quantity ?? 0;

  const targetAssetCandidates = useMemo(
    () => cryptoAssets.filter((asset) => asset.id !== sourceAssetId),
    [cryptoAssets, sourceAssetId],
  );

  const targetAccounts: BankAccount[] = useMemo(
    () => accounts
      .map(({ account }) => account)
      .filter((account) => account.account_kind === 'investment'
        && account.investment_asset_type === 'crypto'
        && isSameAccountOwner(account, position)),
    [accounts, position],
  );

  const defaultAmount = sourceQuantity > 0 ? formatDraftDecimal(sourceQuantity, 8) : '';
  const defaultTargetAsset = targetAssetCandidates[0];
  const defaultTargetAccount = targetAccounts.find((a) => a.id === position.investment_account_id)
    ?? targetAccounts[0];

  const [fromAmount, setFromAmount] = useState(defaultAmount);
  const [toAmount, setToAmount] = useState('');
  const [toCryptoAssetId, setToCryptoAssetId] = useState<string>(
    defaultTargetAsset ? String(defaultTargetAsset.id) : '',
  );
  const [targetInvestmentAccountId, setTargetInvestmentAccountId] = useState<string>(
    defaultTargetAccount ? String(defaultTargetAccount.id) : String(position.investment_account_id),
  );
  const [operatedAt, setOperatedAt] = useState(todayIso());
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fromNum = Number(fromAmount);
  const toNum = Number(toAmount);
  const toAsset = cryptoAssets.find((a) => String(a.id) === toCryptoAssetId);
  const toAccount = targetAccounts.find((a) => String(a.id) === targetInvestmentAccountId);

  const exceedsBalance = sourceQuantity > 0 && Number.isFinite(fromNum) && fromNum > sourceQuantity;
  const valueInBase = livePrice && livePrice.price > 0 && Number.isFinite(fromNum) && fromNum > 0
    ? Number((livePrice.price * fromNum).toFixed(2))
    : null;

  const canSubmit = !submitting
    && !exceedsBalance
    && Number.isFinite(fromNum) && fromNum > 0
    && Number.isFinite(toNum) && toNum > 0
    && !!toCryptoAssetId
    && !!targetInvestmentAccountId
    && Number(toCryptoAssetId) !== sourceAssetId;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      await swapCryptoInvestmentAsset({
        position_id: position.id,
        from_amount: fromNum,
        to_crypto_asset_id: Number(toCryptoAssetId),
        to_amount: toNum,
        target_investment_account_id: Number(targetInvestmentAccountId),
        comment: comment.trim() || undefined,
        operated_at: operatedAt || undefined,
        value_in_base: valueInBase ?? undefined,
      });
      onSuccess();
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSubmitting(false);
    }
  };

  const sourceIconUrl = getCryptoIconUrl(sourceSymbol, position.metadata);

  return (
    <BottomSheet
      open={open}
      tag="Криптовалюта"
      title={`Своп · ${sourceSymbol}`}
      icon={sourceIconUrl ? <img src={sourceIconUrl} alt="" /> : undefined}
      iconColor={sourceIconUrl ? undefined : 'o'}
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
              {submitting ? 'Обмениваем…' : 'Подтвердить обмен'}
            </button>
          </div>
        </div>
      )}
    >
      <div className="cs-sheet__pair">
        <div className="cs-sheet__leg">
          <span className="fl">Отдаём · {sourceSymbol}</span>
          <div className="amt">
            <input
              className="amt__inp"
              type="text"
              inputMode="decimal"
              placeholder="0"
              value={fromAmount}
              onChange={(event) => setFromAmount(sanitizeDecimalInput(event.target.value))}
              disabled={submitting}
            />
            <span className="amt__cur">{sourceSymbol}</span>
          </div>
          <span className="amt__hint">
            В позиции: {formatNumericAmount(sourceQuantity, 8)} {sourceSymbol}
          </span>
        </div>

        <div className="cs-sheet__divider" aria-hidden="true">
          <ArrowDown size={18} strokeWidth={2.4} />
        </div>

        <div className="cs-sheet__leg">
          <span className="fl">Получаем</span>
          <div className="amt">
            <input
              className="amt__inp"
              type="text"
              inputMode="decimal"
              placeholder="0"
              value={toAmount}
              onChange={(event) => setToAmount(sanitizeDecimalInput(event.target.value))}
              disabled={submitting}
            />
            <span className="amt__cur">{toAsset?.symbol ?? '—'}</span>
          </div>
        </div>
      </div>

      <div className="field">
        <span className="fl">Монета на вход</span>
        <select
          className="picker-v2"
          value={toCryptoAssetId}
          onChange={(event) => setToCryptoAssetId(event.target.value)}
          disabled={submitting || targetAssetCandidates.length === 0}
        >
          <option value="">Выберите монету</option>
          {targetAssetCandidates.map((asset) => (
            <option key={asset.id} value={asset.id}>
              {asset.symbol}{asset.network_code ? ` · ${asset.network_code}` : ''}
            </option>
          ))}
        </select>
      </div>

      {targetAccounts.length > 1 && (
        <div className="field">
          <span className="fl">Счёт получения</span>
          <select
            className="picker-v2"
            value={targetInvestmentAccountId}
            onChange={(event) => setTargetInvestmentAccountId(event.target.value)}
            disabled={submitting}
          >
            {targetAccounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}{account.id === position.investment_account_id ? ' (этот же)' : ''}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="field field--row">
        <div className="field--col">
          <span className="fl">Дата</span>
          <input
            className="picker-v2"
            type="date"
            value={operatedAt}
            onChange={(event) => setOperatedAt(event.target.value)}
            disabled={submitting}
          />
        </div>
      </div>

      {valueInBase !== null && (
        <div className="cs-sheet__hint">
          <Repeat size={14} strokeWidth={2.2} />
          <span>
            Снимок курса: {formatNumericAmount(valueInBase)} {currencySymbol(baseCurrencyCode)}{' '}
            <em>(live × количество)</em>
          </span>
        </div>
      )}

      {exceedsBalance && (
        <div className="tk-error">
          <AlertCircle strokeWidth={2} />
          <span>Сумма превышает остаток в позиции.</span>
        </div>
      )}

      {toAccount && toAccount.id !== position.investment_account_id && (
        <div className="cs-sheet__hint">
          <span>Новая позиция {toAsset?.symbol ?? ''} появится на счёте «{toAccount.name}».</span>
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
