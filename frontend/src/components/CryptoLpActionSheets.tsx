import { useCryptoRequestKey } from '../hooks/useCryptoRequestKey';
import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, Plus, Coins, ArrowDownToLine, X } from 'lucide-react';

import BottomSheet from './BottomSheet';
import { useModalOpen } from '../hooks/useModalOpen';
import { sanitizeDecimalInput } from '../utils/validation';
import { formatNumericAmount } from '../utils/format';
import { todayIso } from '../utils/portfolioPosition';
import { getPositionMetadataText } from '../utils/portfolioPosition';
import {
  topUpCryptoProtocolPosition,
  partialCloseCryptoProtocolPosition,
  closeCryptoProtocolPosition,
} from '../api';
import type {
  CryptoProtocolPosition,
  PortfolioPosition,
} from '../types';
import { getLiquidityPoolMetadata } from '../types';
import { DefiFeeField, EMPTY_FEE_DRAFT, manualFee } from './DefiFeeField';
import type { DefiFeeDraft } from './DefiFeeField';


type LpSheetCommon = {
  open: boolean;
  position: CryptoProtocolPosition;
  onClose: () => void;
  onSuccess: () => void;
};

type AddProps = LpSheetCommon & {
  accountPositions: PortfolioPosition[];
};

function symbolOf(p: PortfolioPosition): string {
  return getPositionMetadataText(p, 'asset_symbol') ?? p.title;
}

function findSourceForSymbol(positions: PortfolioPosition[], symbol: string): PortfolioPosition | undefined {
  const upper = symbol.toUpperCase();
  return positions.find((p) => (
    p.status === 'open'
    && p.asset_type_code === 'crypto'
    && (p.quantity ?? 0) > 0
    && symbolOf(p).toUpperCase() === upper
  ));
}


export function LpAddLiquiditySheet({ open, position, accountPositions, onClose, onSuccess }: AddProps) {
  const manualRequest = useCryptoRequestKey(`CryptoLpActionSheets.tsx:${position.id}:1`);
  useModalOpen(open);
  const lp = useMemo(() => getLiquidityPoolMetadata(position), [position]);
  const tokenASymbol = position.asset_symbol;
  const tokenBSymbol = lp.token1_symbol ?? '';

  const sourceA = useMemo(
    () => findSourceForSymbol(accountPositions, tokenASymbol),
    [accountPositions, tokenASymbol],
  );
  const sourceB = useMemo(
    () => tokenBSymbol ? findSourceForSymbol(accountPositions, tokenBSymbol) : undefined,
    [accountPositions, tokenBSymbol],
  );

  const [qtyA, setQtyA] = useState('');
  const [qtyB, setQtyB] = useState('');
  const [operatedAt, setOperatedAt] = useState(todayIso());
  const [comment, setComment] = useState('');
  const [feeDraft, setFeeDraft] = useState<DefiFeeDraft>(EMPTY_FEE_DRAFT);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setQtyA('');
      setQtyB('');
      setOperatedAt(todayIso());
      setComment('');
      setFeeDraft(EMPTY_FEE_DRAFT);
      setError(null);
    }
  }, [open]);

  const numA = Number(qtyA);
  const numB = Number(qtyB);
  const validA = Number.isFinite(numA) && numA > 0 && sourceA && (sourceA.quantity ?? 0) >= numA;
  const validB = Number.isFinite(numB) && numB > 0 && sourceB && (sourceB.quantity ?? 0) >= numB;
  const canSubmit = !submitting && !!sourceA && !!sourceB && validA && validB;

  const submit = async () => {
    if (!canSubmit || !sourceA || !sourceB) return;
    setSubmitting(true);
    setError(null);
    try {
      const payload = {
        source_position_id: sourceA.id,
        quantity: qtyA,
        secondary_source_position_id: sourceB.id,
        secondary_quantity: qtyB,
        operated_at: operatedAt || undefined,
        comment: comment.trim() || undefined,
        fee: manualFee(feeDraft, accountPositions),
      };
      await topUpCryptoProtocolPosition(position.id, { ...payload, request_id: manualRequest.requestId(payload) });
      manualRequest.completed();
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setSubmitting(false);
      return;
    }
    onSuccess();
  };

  return (
    <BottomSheet
      open={open}
      tag={position.protocol_name}
      title="Добавить ликвидность"
      icon={<Plus size={18} strokeWidth={2.2} />}
      iconColor="o"
      onClose={onClose}
      actions={(
        <div className="tk-foot pf-sheet-actions">
          {error && <div className="tk-error"><AlertCircle strokeWidth={2} /><span>{error}</span></div>}
          <div className="tk-foot__row">
            <button className="btn btn--ghost" type="button" onClick={onClose} disabled={submitting}>Отмена</button>
            <button className="btn btn--primary" type="button" onClick={() => void submit()} disabled={!canSubmit}>
              {submitting ? 'Добавляем…' : 'Добавить'}
            </button>
          </div>
        </div>
      )}
    >
      <div className="apf-field">
        <label className="apf-label">{tokenASymbol} — количество</label>
        <input
          className="apf-input"
          type="text"
          inputMode="decimal"
          placeholder="0"
          value={qtyA}
          onChange={(e) => setQtyA(sanitizeDecimalInput(e.target.value))}
          disabled={submitting || !sourceA}
        />
        {sourceA ? (
          <span className="tok-row__hint">Доступно: {formatNumericAmount(sourceA.quantity ?? 0, 8)} {tokenASymbol}</span>
        ) : (
          <span className="tok-row__hint tok-row__hint--muted">{tokenASymbol} не найден в активах счёта</span>
        )}
      </div>

      <div className="apf-field">
        <label className="apf-label">{tokenBSymbol || 'Token B'} — количество</label>
        <input
          className="apf-input"
          type="text"
          inputMode="decimal"
          placeholder="0"
          value={qtyB}
          onChange={(e) => setQtyB(sanitizeDecimalInput(e.target.value))}
          disabled={submitting || !sourceB}
        />
        {sourceB ? (
          <span className="tok-row__hint">Доступно: {formatNumericAmount(sourceB.quantity ?? 0, 8)} {tokenBSymbol}</span>
        ) : (
          <span className="tok-row__hint tok-row__hint--muted">{tokenBSymbol || 'Token B'} не найден в активах счёта</span>
        )}
      </div>

      <div className="apf-field">
        <label className="apf-label">Дата</label>
        <input
          className="apf-input"
          type="date"
          value={operatedAt}
          onChange={(e) => setOperatedAt(e.target.value)}
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
          onChange={(e) => setComment(e.target.value)}
          disabled={submitting}
        />
      </div>
      <DefiFeeField accountPositions={accountPositions} value={feeDraft} onChange={setFeeDraft} disabled={submitting} />
    </BottomSheet>
  );
}


export function LpPartialWithdrawSheet({ open, position, accountPositions, onClose, onSuccess }: LpSheetCommon & { accountPositions: PortfolioPosition[] }) {
  const manualRequest = useCryptoRequestKey(`CryptoLpActionSheets.tsx:${position.id}:2`);
  useModalOpen(open);
  const lp = useMemo(() => getLiquidityPoolMetadata(position), [position]);
  const tokenASymbol = position.asset_symbol;
  const tokenBSymbol = lp.token1_symbol ?? 'Token B';
  const maxA = position.current_quantity ?? position.quantity ?? 0;
  const maxB = lp.token1_quantity ?? 0;

  const [qtyA, setQtyA] = useState('');
  const [qtyB, setQtyB] = useState('');
  const [operatedAt, setOperatedAt] = useState(todayIso());
  const [comment, setComment] = useState('');
  const [feeDraft, setFeeDraft] = useState<DefiFeeDraft>(EMPTY_FEE_DRAFT);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setQtyA('');
      setQtyB('');
      setOperatedAt(todayIso());
      setComment('');
      setFeeDraft(EMPTY_FEE_DRAFT);
      setError(null);
    }
  }, [open]);

  const numA = Number(qtyA);
  const numB = Number(qtyB);
  const validA = Number.isFinite(numA) && numA > 0;
  const validB = Number.isFinite(numB) && numB > 0;
  const canSubmit = !submitting && validA && validB && false; // A withdrawal share is required for correct LP allocation.

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const payload = {
        principal_qty: qtyA,
        secondary_principal_qty: qtyB,
        returned_at: operatedAt || undefined,
        comment: comment.trim() || undefined,
        fee: manualFee(feeDraft, accountPositions),
      };
      await partialCloseCryptoProtocolPosition(position.id, { ...payload, request_id: manualRequest.requestId(payload) });
      manualRequest.completed();
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setSubmitting(false);
      return;
    }
    onSuccess();
  };

  return (
    <BottomSheet
      open={open}
      tag="Частичный выход пока недоступен: нужна доля выведенных LP-токенов"
      title="Частично снять"
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
      <div className="apf-field">
        <label className="apf-label">{tokenASymbol} — количество</label>
        <input
          className="apf-input"
          type="text"
          inputMode="decimal"
          placeholder="0"
          value={qtyA}
          onChange={(e) => setQtyA(sanitizeDecimalInput(e.target.value))}
          disabled={submitting}
        />
        <span className="tok-row__hint">В позиции: {formatNumericAmount(maxA, 8)} {tokenASymbol}</span>
      </div>
      <div className="apf-field">
        <label className="apf-label">{tokenBSymbol} — количество</label>
        <input
          className="apf-input"
          type="text"
          inputMode="decimal"
          placeholder="0"
          value={qtyB}
          onChange={(e) => setQtyB(sanitizeDecimalInput(e.target.value))}
          disabled={submitting}
        />
        <span className="tok-row__hint">В позиции: {formatNumericAmount(maxB, 8)} {tokenBSymbol}</span>
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


export function LpCloseSheet({ open, position, accountPositions, onClose, onSuccess }: LpSheetCommon & { accountPositions: PortfolioPosition[] }) {
  const manualRequest = useCryptoRequestKey(`CryptoLpActionSheets.tsx:${position.id}:3`);
  useModalOpen(open);
  const lp = useMemo(() => getLiquidityPoolMetadata(position), [position]);
  const tokenASymbol = position.asset_symbol;
  const tokenBSymbol = lp.token1_symbol ?? 'Token B';
  const maxA = position.current_quantity ?? position.quantity ?? 0;
  const maxB = lp.token1_quantity ?? 0;

  const [qtyA, setQtyA] = useState('');
  const [qtyB, setQtyB] = useState('');
  const [operatedAt, setOperatedAt] = useState(todayIso());
  const [comment, setComment] = useState('');
  const [feeDraft, setFeeDraft] = useState<DefiFeeDraft>(EMPTY_FEE_DRAFT);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setQtyA(position.current_quantity_exact ?? (maxA > 0 ? String(maxA) : ''));
      setQtyB(position.token1_quantity_exact ?? (maxB > 0 ? String(maxB) : ''));
      setOperatedAt(todayIso());
      setComment('');
      setFeeDraft(EMPTY_FEE_DRAFT);
      setError(null);
    }
  }, [open, maxA, maxB]);

  const numA = qtyA.trim() ? Number(qtyA) : 0;
  const numB = qtyB.trim() ? Number(qtyB) : 0;
  const aOk = numA === 0 || (Number.isFinite(numA) && numA > 0);
  const bOk = numB === 0 || (Number.isFinite(numB) && numB > 0);
  const canSubmit = !submitting && aOk && bOk && (numA > 0 || numB > 0);

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const payload = {
        return_quantity: qtyA.trim() || "0",
        secondary_return_quantity: qtyB.trim() || "0",
        withdrawn_at: operatedAt || undefined,
        comment: comment.trim() || undefined,
        fee: manualFee(feeDraft, accountPositions),
      };
      await closeCryptoProtocolPosition(position.id, { ...payload, request_id: manualRequest.requestId(payload) });
      manualRequest.completed();
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setSubmitting(false);
      return;
    }
    onSuccess();
  };

  return (
    <BottomSheet
      open={open}
      tag={position.protocol_name}
      title="Закрыть позицию"
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
      <p className="list-row__sub" style={{ lineHeight: 1.5, marginBottom: 6 }}>
        Можно вернуть только один токен из пары или оба — оставь поле пустым, чтобы не возвращать.
      </p>
      <div className="apf-field">
        <label className="apf-label">{tokenASymbol} — вернётся</label>
        <input
          className="apf-input"
          type="text"
          inputMode="decimal"
          placeholder="0"
          value={qtyA}
          onChange={(e) => setQtyA(sanitizeDecimalInput(e.target.value))}
          disabled={submitting}
        />
        <span className="tok-row__hint">В позиции: {formatNumericAmount(maxA, 8)} {tokenASymbol}</span>
      </div>
      <div className="apf-field">
        <label className="apf-label">{tokenBSymbol} — вернётся</label>
        <input
          className="apf-input"
          type="text"
          inputMode="decimal"
          placeholder="0"
          value={qtyB}
          onChange={(e) => setQtyB(sanitizeDecimalInput(e.target.value))}
          disabled={submitting}
        />
        <span className="tok-row__hint">В позиции: {formatNumericAmount(maxB, 8)} {tokenBSymbol}</span>
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


export function LpClaimFeesSheet({ open, position, accountPositions, onClose, onSuccess }: LpSheetCommon & { accountPositions: PortfolioPosition[] }) {
  const manualRequest = useCryptoRequestKey(`CryptoLpActionSheets.tsx:${position.id}:4`);
  useModalOpen(open);
  const lp = useMemo(() => getLiquidityPoolMetadata(position), [position]);
  const tokenASymbol = position.asset_symbol;
  const tokenBSymbol = lp.token1_symbol ?? 'Token B';

  const [qtyA, setQtyA] = useState('');
  const [qtyB, setQtyB] = useState('');
  const [operatedAt, setOperatedAt] = useState(todayIso());
  const [comment, setComment] = useState('');
  const [feeDraft, setFeeDraft] = useState<DefiFeeDraft>(EMPTY_FEE_DRAFT);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setQtyA('');
      setQtyB('');
      setOperatedAt(todayIso());
      setComment('');
      setFeeDraft(EMPTY_FEE_DRAFT);
      setError(null);
    }
  }, [open]);

  const numA = qtyA.trim() ? Number(qtyA) : 0;
  const numB = qtyB.trim() ? Number(qtyB) : 0;
  const aOk = numA === 0 || (Number.isFinite(numA) && numA > 0);
  const bOk = numB === 0 || (Number.isFinite(numB) && numB > 0);
  const canSubmit = !submitting && aOk && bOk && (numA > 0 || numB > 0);

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const payload = {
        principal_qty: 0,
        rewards_qty: qtyA.trim() || "0",
        secondary_principal_qty: 0,
        secondary_rewards_qty: qtyB.trim() || "0",
        returned_at: operatedAt || undefined,
        comment: comment.trim() || undefined,
        fee: manualFee(feeDraft, accountPositions),
      };
      await partialCloseCryptoProtocolPosition(position.id, { ...payload, request_id: manualRequest.requestId(payload) });
      manualRequest.completed();
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setSubmitting(false);
      return;
    }
    onSuccess();
  };

  return (
    <BottomSheet
      open={open}
      tag={position.protocol_name}
      title="Заклеймить комиссии"
      icon={<Coins size={18} strokeWidth={2.2} />}
      iconColor="o"
      onClose={onClose}
      actions={(
        <div className="tk-foot pf-sheet-actions">
          {error && <div className="tk-error"><AlertCircle strokeWidth={2} /><span>{error}</span></div>}
          <div className="tk-foot__row">
            <button className="btn btn--ghost" type="button" onClick={onClose} disabled={submitting}>Отмена</button>
            <button className="btn btn--primary" type="button" onClick={() => void submit()} disabled={!canSubmit}>
              {submitting ? 'Зачисляем…' : 'Зачислить'}
            </button>
          </div>
        </div>
      )}
    >
      <p className="list-row__sub" style={{ lineHeight: 1.5, marginBottom: 6 }}>
        Введи количество комиссий по одному или обоим токенам — они зачислятся в актив на счёте как доход.
      </p>
      <div className="apf-field">
        <label className="apf-label">{tokenASymbol} — комиссии</label>
        <input
          className="apf-input"
          type="text"
          inputMode="decimal"
          placeholder="0"
          value={qtyA}
          onChange={(e) => setQtyA(sanitizeDecimalInput(e.target.value))}
          disabled={submitting}
        />
      </div>
      <div className="apf-field">
        <label className="apf-label">{tokenBSymbol} — комиссии</label>
        <input
          className="apf-input"
          type="text"
          inputMode="decimal"
          placeholder="0"
          value={qtyB}
          onChange={(e) => setQtyB(sanitizeDecimalInput(e.target.value))}
          disabled={submitting}
        />
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
