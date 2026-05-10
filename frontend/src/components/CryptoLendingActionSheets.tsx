import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, Plus, ArrowDownToLine, X, HandCoins, Wallet, SlidersHorizontal } from 'lucide-react';

import BottomSheet from './BottomSheet';
import { useModalOpen } from '../hooks/useModalOpen';
import { sanitizeDecimalInput } from '../utils/validation';
import { formatNumericAmount } from '../utils/format';
import { todayIso, getPositionMetadataText, getPositionMetadataNumber } from '../utils/portfolioPosition';
import {
  topUpCryptoProtocolPosition,
  closeCryptoProtocolPosition,
  updateCryptoProtocolPosition,
  partialCloseCryptoProtocolPosition,
  takeLendingDebt,
  repayLendingDebt,
} from '../api';
import type {
  CryptoProtocolPosition,
  PortfolioPosition,
  CryptoLivePrice,
  CryptoAsset,
} from '../types';
import { getLendingMetadata } from '../types';
import { DefiFeeField, EMPTY_FEE_DRAFT, applyDefiFee } from './DefiFeeField';
import type { DefiFeeDraft } from './DefiFeeField';


type CommonProps = {
  open: boolean;
  position: CryptoProtocolPosition;
  onClose: () => void;
  onSuccess: () => void;
};


function findAccountPositionForAsset(
  accountPositions: PortfolioPosition[],
  cryptoAssetId: number | null | undefined,
): PortfolioPosition | undefined {
  if (cryptoAssetId == null) return undefined;
  return accountPositions.find((p) => (
    p.status === 'open'
    && p.asset_type_code === 'crypto'
    && getPositionMetadataNumber(p, 'crypto_asset_id') === cryptoAssetId
  ));
}


export function LendingTopUpSheet({
  open,
  position,
  accountPositions,
  onClose,
  onSuccess,
}: CommonProps & { accountPositions: PortfolioPosition[] }) {
  useModalOpen(open);
  const collateralSymbol = position.asset_symbol;
  const source = useMemo(
    () => findAccountPositionForAsset(accountPositions, position.crypto_asset_id),
    [accountPositions, position.crypto_asset_id],
  );
  const sourceSymbol = source ? (getPositionMetadataText(source, 'asset_symbol') ?? source.title) : collateralSymbol;
  const available = source?.quantity ?? 0;

  const [quantity, setQuantity] = useState('');
  const [operatedAt, setOperatedAt] = useState(todayIso());
  const [comment, setComment] = useState('');
  const [feeDraft, setFeeDraft] = useState<DefiFeeDraft>(EMPTY_FEE_DRAFT);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setQuantity('');
      setOperatedAt(todayIso());
      setComment('');
      setFeeDraft(EMPTY_FEE_DRAFT);
      setError(null);
    }
  }, [open]);

  const num = Number(quantity);
  const valid = !!source && Number.isFinite(num) && num > 0 && num <= available;
  const canSubmit = !submitting && valid;

  const submit = async () => {
    if (!canSubmit || !source) return;
    setSubmitting(true);
    setError(null);
    try {
      await topUpCryptoProtocolPosition(position.id, {
        source_position_id: source.id,
        quantity: num,
        operated_at: operatedAt || undefined,
        comment: comment.trim() || undefined,
      });
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setSubmitting(false);
      return;
    }
    const feeError = await applyDefiFee(feeDraft, accountPositions, position.id, operatedAt);
    if (feeError) {
      setError(feeError);
      setSubmitting(false);
      return;
    }
    onSuccess();
  };

  return (
    <BottomSheet
      open={open}
      tag={position.protocol_name}
      title="Долить из актива"
      icon={<Plus size={18} strokeWidth={2.2} />}
      iconColor="o"
      onClose={onClose}
      actions={(
        <div className="tk-foot pf-sheet-actions">
          {error && <div className="tk-error"><AlertCircle strokeWidth={2} /><span>{error}</span></div>}
          <div className="tk-foot__row">
            <button className="btn btn--ghost" type="button" onClick={onClose} disabled={submitting}>Отмена</button>
            <button className="btn btn--primary" type="button" onClick={() => void submit()} disabled={!canSubmit}>
              {submitting ? 'Доливаем…' : 'Долить'}
            </button>
          </div>
        </div>
      )}
    >
      <p className="list-row__sub" style={{ lineHeight: 1.5, marginBottom: 6 }}>
        Снимет монеты со счёта и добавит в лендинг.
      </p>
      <div className="apf-field">
        <label className="apf-label">{sourceSymbol} — количество</label>
        <input
          className="apf-input"
          type="text"
          inputMode="decimal"
          placeholder="0"
          value={quantity}
          onChange={(e) => setQuantity(sanitizeDecimalInput(e.target.value))}
          disabled={submitting || !source}
        />
        {source ? (
          <span className="tok-row__hint">Доступно: {formatNumericAmount(available, 8)} {sourceSymbol}</span>
        ) : (
          <span className="tok-row__hint tok-row__hint--muted">{collateralSymbol} не найден в активах счёта</span>
        )}
      </div>
      <div className="apf-field">
        <label className="apf-label">Дата</label>
        <input className="apf-input" type="date" value={operatedAt} onChange={(e) => setOperatedAt(e.target.value)} disabled={submitting} />
      </div>
      <div className="apf-field">
        <label className="apf-label">Комментарий</label>
        <input className="apf-input" type="text" placeholder="Необязательно" value={comment} onChange={(e) => setComment(e.target.value)} disabled={submitting} />
      </div>
      <DefiFeeField accountPositions={accountPositions} value={feeDraft} onChange={setFeeDraft} disabled={submitting} />
    </BottomSheet>
  );
}


export function LendingTakeDebtSheet({
  open,
  position,
  accountPositions,
  cryptoAssets,
  cryptoLivePrices,
  baseCurrencyCode,
  onClose,
  onSuccess,
}: CommonProps & {
  accountPositions: PortfolioPosition[];
  cryptoAssets: CryptoAsset[];
  cryptoLivePrices: Map<number, CryptoLivePrice>;
  baseCurrencyCode: string;
}) {
  useModalOpen(open);
  const lend = useMemo(() => getLendingMetadata(position), [position]);
  const lockedAssetId = lend.borrowed_crypto_asset_id ?? null;
  const sortedAssets = useMemo(
    () => [...cryptoAssets].sort((a, b) => a.symbol.localeCompare(b.symbol)),
    [cryptoAssets],
  );

  const [pickedAssetId, setPickedAssetId] = useState<string>('');
  const [quantity, setQuantity] = useState('');
  const [operatedAt, setOperatedAt] = useState(todayIso());
  const [comment, setComment] = useState('');
  const [feeDraft, setFeeDraft] = useState<DefiFeeDraft>(EMPTY_FEE_DRAFT);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setPickedAssetId(lockedAssetId != null ? String(lockedAssetId) : '');
      setQuantity('');
      setOperatedAt(todayIso());
      setComment('');
      setFeeDraft(EMPTY_FEE_DRAFT);
      setError(null);
    }
  }, [open, lockedAssetId]);

  const effectiveAssetId = lockedAssetId ?? (pickedAssetId ? Number(pickedAssetId) : null);
  const effectiveAsset = effectiveAssetId != null
    ? sortedAssets.find((a) => a.id === effectiveAssetId) ?? null
    : null;
  const symbol = lend.borrowed_asset_symbol ?? lend.borrowed_asset ?? effectiveAsset?.symbol ?? '';
  const livePrice = effectiveAssetId != null ? cryptoLivePrices.get(effectiveAssetId)?.price ?? null : null;

  const num = Number(quantity);
  const valid = Number.isFinite(num) && num > 0 && effectiveAssetId != null;
  const canSubmit = !submitting && valid;
  const valueInBase = (valid && livePrice && livePrice > 0) ? livePrice * num : null;

  const submit = async () => {
    if (!canSubmit || effectiveAssetId == null) return;
    setSubmitting(true);
    setError(null);
    try {
      await takeLendingDebt(position.id, {
        debt_qty: num,
        value_in_base: valueInBase != null ? Math.round(valueInBase * 100) / 100 : undefined,
        operated_at: operatedAt || undefined,
        comment: comment.trim() || undefined,
        borrowed_crypto_asset_id: lockedAssetId == null ? effectiveAssetId : undefined,
      });
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setSubmitting(false);
      return;
    }
    const feeError = await applyDefiFee(feeDraft, accountPositions, position.id, operatedAt);
    if (feeError) {
      setError(feeError);
      setSubmitting(false);
      return;
    }
    onSuccess();
  };

  return (
    <BottomSheet
      open={open}
      tag={position.protocol_name}
      title={lockedAssetId != null ? 'Взять ещё в долг' : 'Взять в долг'}
      icon={<HandCoins size={18} strokeWidth={2.2} />}
      iconColor="o"
      onClose={onClose}
      actions={(
        <div className="tk-foot pf-sheet-actions">
          {error && <div className="tk-error"><AlertCircle strokeWidth={2} /><span>{error}</span></div>}
          <div className="tk-foot__row">
            <button className="btn btn--ghost" type="button" onClick={onClose} disabled={submitting}>Отмена</button>
            <button className="btn btn--primary" type="button" onClick={() => void submit()} disabled={!canSubmit}>
              {submitting ? 'Берём…' : 'Взять в долг'}
            </button>
          </div>
        </div>
      )}
    >
      <p className="list-row__sub" style={{ lineHeight: 1.5, marginBottom: 6 }}>
        Заёмные монеты прибавятся к активу на счёте, долг увеличится на ту же сумму.
      </p>
      {lockedAssetId == null && (
        <div className="apf-field">
          <label className="apf-label">Какую монету занимаем</label>
          <select
            className="picker-v2"
            value={pickedAssetId}
            onChange={(e) => setPickedAssetId(e.target.value)}
            disabled={submitting}
          >
            <option value="">Выберите монету</option>
            {sortedAssets.map((asset) => (
              <option key={asset.id} value={asset.id}>
                {asset.symbol}{asset.network_code ? ` · ${asset.network_code}` : ''}
              </option>
            ))}
          </select>
        </div>
      )}
      <div className="apf-field">
        <label className="apf-label">{symbol || 'Заём'} — сумма</label>
        <input
          className="apf-input"
          type="text"
          inputMode="decimal"
          placeholder="0"
          value={quantity}
          onChange={(e) => setQuantity(sanitizeDecimalInput(e.target.value))}
          disabled={submitting || effectiveAssetId == null}
        />
        <span className="tok-row__hint">
          {(lend.borrowed_quantity ?? 0) > 0
            ? `Сейчас в долге: ${formatNumericAmount(lend.borrowed_quantity ?? 0, 8)} ${symbol}`
            : 'Долга по этому лендингу пока нет'}
          {valueInBase != null ? ` · ≈ ${formatNumericAmount(valueInBase, 2)} ${baseCurrencyCode}` : ''}
        </span>
      </div>
      <div className="apf-field">
        <label className="apf-label">Дата</label>
        <input className="apf-input" type="date" value={operatedAt} onChange={(e) => setOperatedAt(e.target.value)} disabled={submitting} />
      </div>
      <div className="apf-field">
        <label className="apf-label">Комментарий</label>
        <input className="apf-input" type="text" placeholder="Необязательно" value={comment} onChange={(e) => setComment(e.target.value)} disabled={submitting} />
      </div>
      <DefiFeeField accountPositions={accountPositions} value={feeDraft} onChange={setFeeDraft} disabled={submitting} />
    </BottomSheet>
  );
}


export function LendingRepayDebtSheet({
  open,
  position,
  accountPositions,
  cryptoLivePrices,
  baseCurrencyCode,
  onClose,
  onSuccess,
}: CommonProps & { accountPositions: PortfolioPosition[]; cryptoLivePrices: Map<number, CryptoLivePrice>; baseCurrencyCode: string }) {
  useModalOpen(open);
  const lend = useMemo(() => getLendingMetadata(position), [position]);
  const symbol = lend.borrowed_asset_symbol ?? lend.borrowed_asset ?? '';
  const debtQty = lend.borrowed_quantity ?? 0;
  const sourcePosition = useMemo(
    () => findAccountPositionForAsset(accountPositions, lend.borrowed_crypto_asset_id),
    [accountPositions, lend.borrowed_crypto_asset_id],
  );
  const available = sourcePosition?.quantity ?? 0;
  const livePrice = lend.borrowed_crypto_asset_id
    ? cryptoLivePrices.get(lend.borrowed_crypto_asset_id)?.price ?? null
    : null;

  const [quantity, setQuantity] = useState('');
  const [operatedAt, setOperatedAt] = useState(todayIso());
  const [comment, setComment] = useState('');
  const [feeDraft, setFeeDraft] = useState<DefiFeeDraft>(EMPTY_FEE_DRAFT);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setQuantity('');
      setOperatedAt(todayIso());
      setComment('');
      setFeeDraft(EMPTY_FEE_DRAFT);
      setError(null);
    }
  }, [open]);

  const num = Number(quantity);
  const valid = !!sourcePosition
    && Number.isFinite(num)
    && num > 0
    && num <= available
    && num <= debtQty;
  const canSubmit = !submitting && valid;
  const valueInBase = (valid && livePrice && livePrice > 0) ? livePrice * num : null;

  const submit = async () => {
    if (!canSubmit || !sourcePosition) return;
    setSubmitting(true);
    setError(null);
    try {
      await repayLendingDebt(position.id, {
        source_position_id: sourcePosition.id,
        repay_qty: num,
        value_in_base: valueInBase != null ? Math.round(valueInBase * 100) / 100 : undefined,
        operated_at: operatedAt || undefined,
        comment: comment.trim() || undefined,
      });
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setSubmitting(false);
      return;
    }
    const feeError = await applyDefiFee(feeDraft, accountPositions, position.id, operatedAt);
    if (feeError) {
      setError(feeError);
      setSubmitting(false);
      return;
    }
    onSuccess();
  };

  return (
    <BottomSheet
      open={open}
      tag={position.protocol_name}
      title="Погасить долг"
      icon={<Wallet size={18} strokeWidth={2.2} />}
      iconColor="o"
      onClose={onClose}
      actions={(
        <div className="tk-foot pf-sheet-actions">
          {error && <div className="tk-error"><AlertCircle strokeWidth={2} /><span>{error}</span></div>}
          <div className="tk-foot__row">
            <button className="btn btn--ghost" type="button" onClick={onClose} disabled={submitting}>Отмена</button>
            <button className="btn btn--primary" type="button" onClick={() => void submit()} disabled={!canSubmit}>
              {submitting ? 'Гасим…' : 'Погасить'}
            </button>
          </div>
        </div>
      )}
    >
      <p className="list-row__sub" style={{ lineHeight: 1.5, marginBottom: 6 }}>
        Спишет монеты со счёта и уменьшит долг лендинга.
      </p>
      <div className="apf-field">
        <label className="apf-label">{symbol || 'Заём'} — погасить</label>
        <input
          className="apf-input"
          type="text"
          inputMode="decimal"
          placeholder="0"
          value={quantity}
          onChange={(e) => setQuantity(sanitizeDecimalInput(e.target.value))}
          disabled={submitting || !sourcePosition}
        />
        <span className="tok-row__hint">
          Долг: {formatNumericAmount(debtQty, 8)} {symbol} · На счёте: {formatNumericAmount(available, 8)} {symbol}
          {valueInBase != null ? ` · ≈ ${formatNumericAmount(valueInBase, 2)} ${baseCurrencyCode}` : ''}
        </span>
        {!sourcePosition && (
          <span className="tok-row__hint tok-row__hint--muted">На счёте нет заёмного актива — сначала пополни баланс.</span>
        )}
      </div>
      <div className="apf-field">
        <label className="apf-label">Дата</label>
        <input className="apf-input" type="date" value={operatedAt} onChange={(e) => setOperatedAt(e.target.value)} disabled={submitting} />
      </div>
      <div className="apf-field">
        <label className="apf-label">Комментарий</label>
        <input className="apf-input" type="text" placeholder="Необязательно" value={comment} onChange={(e) => setComment(e.target.value)} disabled={submitting} />
      </div>
      <DefiFeeField accountPositions={accountPositions} value={feeDraft} onChange={setFeeDraft} disabled={submitting} />
    </BottomSheet>
  );
}


export function LendingAdjustSheet({ open, position, onClose, onSuccess }: CommonProps) {
  useModalOpen(open);
  const lend = useMemo(() => getLendingMetadata(position), [position]);
  const collateralSymbol = position.asset_symbol;
  const debtSymbol = lend.borrowed_asset_symbol ?? lend.borrowed_asset ?? '';

  const [collateralQty, setCollateralQty] = useState('');
  const [debtQty, setDebtQty] = useState('');
  const [apr, setApr] = useState('');
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setCollateralQty(position.current_quantity != null ? String(position.current_quantity) : '');
      setDebtQty(lend.borrowed_quantity != null ? String(lend.borrowed_quantity) : '');
      setApr(lend.apr != null ? String(lend.apr) : '');
      setComment('');
      setError(null);
    }
  }, [open, position, lend.borrowed_quantity, lend.apr]);

  const collNum = collateralQty.trim() ? Number(collateralQty) : null;
  const debtNum = debtQty.trim() ? Number(debtQty) : null;
  const aprNum = apr.trim() ? Number(apr) : null;
  const collValid = collNum === null || (Number.isFinite(collNum) && collNum >= 0);
  const debtValid = debtNum === null || (Number.isFinite(debtNum) && debtNum >= 0);
  const aprValid = aprNum === null || Number.isFinite(aprNum);
  const canSubmit = !submitting && collValid && debtValid && aprValid;

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const metadata: Record<string, unknown> = {};
      if (debtNum !== null) metadata.borrowed_quantity = debtNum;
      if (aprNum !== null) metadata.apr = aprNum;
      await updateCryptoProtocolPosition(position.id, {
        current_quantity: collNum !== null ? collNum : undefined,
        comment: comment.trim() || undefined,
        metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
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
      tag={position.protocol_name}
      title="Корректировка"
      icon={<SlidersHorizontal size={18} strokeWidth={2.2} />}
      iconColor="o"
      onClose={onClose}
      actions={(
        <div className="tk-foot pf-sheet-actions">
          {error && <div className="tk-error"><AlertCircle strokeWidth={2} /><span>{error}</span></div>}
          <div className="tk-foot__row">
            <button className="btn btn--ghost" type="button" onClick={onClose} disabled={submitting}>Отмена</button>
            <button className="btn btn--primary" type="button" onClick={() => void submit()} disabled={!canSubmit}>
              {submitting ? 'Сохраняем…' : 'Сохранить'}
            </button>
          </div>
        </div>
      )}
    >
      <p className="list-row__sub" style={{ lineHeight: 1.5, marginBottom: 6 }}>
        Меняет цифры в позиции без движения по активу — для учёта набежавших процентов.
      </p>
      <div className="apf-field">
        <label className="apf-label">{collateralSymbol} в лендинге</label>
        <input
          className="apf-input"
          type="text"
          inputMode="decimal"
          placeholder="0"
          value={collateralQty}
          onChange={(e) => setCollateralQty(sanitizeDecimalInput(e.target.value))}
          disabled={submitting}
        />
      </div>
      {lend.borrowed_crypto_asset_id != null && (
        <div className="apf-field">
          <label className="apf-label">{debtSymbol || 'Долг'} — текущий долг</label>
          <input
            className="apf-input"
            type="text"
            inputMode="decimal"
            placeholder="0"
            value={debtQty}
            onChange={(e) => setDebtQty(sanitizeDecimalInput(e.target.value))}
            disabled={submitting}
          />
        </div>
      )}
      <div className="apf-field">
        <label className="apf-label">APR, %</label>
        <input
          className="apf-input"
          type="text"
          inputMode="decimal"
          placeholder="0"
          value={apr}
          onChange={(e) => setApr(sanitizeDecimalInput(e.target.value))}
          disabled={submitting}
        />
      </div>
      <div className="apf-field">
        <label className="apf-label">Комментарий</label>
        <input className="apf-input" type="text" placeholder="Необязательно" value={comment} onChange={(e) => setComment(e.target.value)} disabled={submitting} />
      </div>
    </BottomSheet>
  );
}


export function LendingPartialWithdrawSheet({
  open,
  position,
  accountPositions,
  onClose,
  onSuccess,
}: CommonProps & { accountPositions: PortfolioPosition[] }) {
  useModalOpen(open);
  const symbol = position.asset_symbol;
  const max = position.current_quantity ?? position.quantity ?? 0;

  const [quantity, setQuantity] = useState('');
  const [operatedAt, setOperatedAt] = useState(todayIso());
  const [comment, setComment] = useState('');
  const [feeDraft, setFeeDraft] = useState<DefiFeeDraft>(EMPTY_FEE_DRAFT);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setQuantity('');
      setOperatedAt(todayIso());
      setComment('');
      setFeeDraft(EMPTY_FEE_DRAFT);
      setError(null);
    }
  }, [open]);

  const num = Number(quantity);
  const valid = Number.isFinite(num) && num > 0 && num <= max;
  const canSubmit = !submitting && valid;

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      await partialCloseCryptoProtocolPosition(position.id, {
        principal_qty: num,
        returned_at: operatedAt || undefined,
        comment: comment.trim() || undefined,
      });
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setSubmitting(false);
      return;
    }
    const feeError = await applyDefiFee(feeDraft, accountPositions, position.id, operatedAt);
    if (feeError) {
      setError(feeError);
      setSubmitting(false);
      return;
    }
    onSuccess();
  };

  return (
    <BottomSheet
      open={open}
      tag={position.protocol_name}
      title="Снять из залога"
      icon={<ArrowDownToLine size={18} strokeWidth={2.2} />}
      iconColor="o"
      onClose={onClose}
      actions={(
        <div className="tk-foot pf-sheet-actions">
          {error && <div className="tk-error"><AlertCircle strokeWidth={2} /><span>{error}</span></div>}
          <div className="tk-foot__row">
            <button className="btn btn--ghost" type="button" onClick={onClose} disabled={submitting}>Отмена</button>
            <button className="btn btn--primary" type="button" onClick={() => void submit()} disabled={!canSubmit}>
              {submitting ? 'Снимаем…' : 'Снять'}
            </button>
          </div>
        </div>
      )}
    >
      <p className="list-row__sub" style={{ lineHeight: 1.5, marginBottom: 6 }}>
        Часть залога вернётся на счёт. Долг при этом не меняется.
      </p>
      <div className="apf-field">
        <label className="apf-label">{symbol} — снять</label>
        <input
          className="apf-input"
          type="text"
          inputMode="decimal"
          placeholder="0"
          value={quantity}
          onChange={(e) => setQuantity(sanitizeDecimalInput(e.target.value))}
          disabled={submitting}
        />
        <span className="tok-row__hint">В залоге: {formatNumericAmount(max, 8)} {symbol}</span>
      </div>
      <div className="apf-field">
        <label className="apf-label">Дата</label>
        <input className="apf-input" type="date" value={operatedAt} onChange={(e) => setOperatedAt(e.target.value)} disabled={submitting} />
      </div>
      <div className="apf-field">
        <label className="apf-label">Комментарий</label>
        <input className="apf-input" type="text" placeholder="Необязательно" value={comment} onChange={(e) => setComment(e.target.value)} disabled={submitting} />
      </div>
      <DefiFeeField accountPositions={accountPositions} value={feeDraft} onChange={setFeeDraft} disabled={submitting} />
    </BottomSheet>
  );
}


export function LendingCloseSheet({
  open,
  position,
  accountPositions,
  onClose,
  onSuccess,
}: CommonProps & { accountPositions: PortfolioPosition[] }) {
  useModalOpen(open);
  const lend = useMemo(() => getLendingMetadata(position), [position]);
  const symbol = position.asset_symbol;
  const max = position.current_quantity ?? position.quantity ?? 0;
  const debtQty = lend.borrowed_quantity ?? 0;
  const hasDebt = debtQty > 0;

  const [quantity, setQuantity] = useState('');
  const [operatedAt, setOperatedAt] = useState(todayIso());
  const [comment, setComment] = useState('');
  const [feeDraft, setFeeDraft] = useState<DefiFeeDraft>(EMPTY_FEE_DRAFT);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setQuantity(max > 0 ? String(max) : '');
      setOperatedAt(todayIso());
      setComment('');
      setFeeDraft(EMPTY_FEE_DRAFT);
      setError(null);
    }
  }, [open, max]);

  const num = quantity.trim() ? Number(quantity) : 0;
  const valid = !hasDebt && (num === 0 || (Number.isFinite(num) && num > 0));
  const canSubmit = !submitting && valid;

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      await closeCryptoProtocolPosition(position.id, {
        return_quantity: num > 0 ? num : undefined,
        withdrawn_at: operatedAt || undefined,
        comment: comment.trim() || undefined,
      });
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setSubmitting(false);
      return;
    }
    const feeError = await applyDefiFee(feeDraft, accountPositions, position.id, operatedAt);
    if (feeError) {
      setError(feeError);
      setSubmitting(false);
      return;
    }
    onSuccess();
  };

  return (
    <BottomSheet
      open={open}
      tag={position.protocol_name}
      title="Закрыть лендинг"
      icon={<X size={18} strokeWidth={2.2} />}
      iconColor="o"
      onClose={onClose}
      actions={(
        <div className="tk-foot pf-sheet-actions">
          {error && <div className="tk-error"><AlertCircle strokeWidth={2} /><span>{error}</span></div>}
          <div className="tk-foot__row">
            <button className="btn btn--ghost" type="button" onClick={onClose} disabled={submitting}>Отмена</button>
            <button className="btn btn--primary" type="button" onClick={() => void submit()} disabled={!canSubmit}>
              {submitting ? 'Закрываем…' : 'Закрыть'}
            </button>
          </div>
        </div>
      )}
    >
      {hasDebt ? (
        <p className="list-row__sub" style={{ lineHeight: 1.5, marginBottom: 6 }}>
          Сначала погаси долг {formatNumericAmount(debtQty, 8)} {lend.borrowed_asset_symbol ?? lend.borrowed_asset ?? ''}, после этого позицию можно закрыть.
        </p>
      ) : (
        <p className="list-row__sub" style={{ lineHeight: 1.5, marginBottom: 6 }}>
          Залог вернётся на счёт. Можно подкрутить количество, если оно отличается от того, что в позиции.
        </p>
      )}
      <div className="apf-field">
        <label className="apf-label">{symbol} — вернётся</label>
        <input
          className="apf-input"
          type="text"
          inputMode="decimal"
          placeholder="0"
          value={quantity}
          onChange={(e) => setQuantity(sanitizeDecimalInput(e.target.value))}
          disabled={submitting || hasDebt}
        />
        <span className="tok-row__hint">В позиции: {formatNumericAmount(max, 8)} {symbol}</span>
      </div>
      <div className="apf-field">
        <label className="apf-label">Дата</label>
        <input className="apf-input" type="date" value={operatedAt} onChange={(e) => setOperatedAt(e.target.value)} disabled={submitting || hasDebt} />
      </div>
      <div className="apf-field">
        <label className="apf-label">Комментарий</label>
        <input className="apf-input" type="text" placeholder="Необязательно" value={comment} onChange={(e) => setComment(e.target.value)} disabled={submitting || hasDebt} />
      </div>
      {!hasDebt && (
        <DefiFeeField accountPositions={accountPositions} value={feeDraft} onChange={setFeeDraft} disabled={submitting} />
      )}
    </BottomSheet>
  );
}
