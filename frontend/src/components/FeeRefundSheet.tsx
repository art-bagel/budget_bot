import { useState } from 'react';
import BottomSheet from './BottomSheet';
import { useCryptoRequestKey } from '../hooks/useCryptoRequestKey';
import { refundCryptoFee } from '../api';
import { todayIso } from '../utils/portfolioPosition';
import { sanitizeDecimalInput } from '../utils/validation';

export default function FeeRefundSheet({ eventId, positionId, symbol, onClose, onSuccess }: {
  eventId: number; positionId: number; symbol: string; onClose: () => void; onSuccess: () => void;
}) {
  const request = useCryptoRequestKey(`fee-refund:${eventId}`);
  const [quantity, setQuantity] = useState('');
  const [day, setDay] = useState(todayIso());
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    if (busy || !(Number(quantity) > 0) || !day) return;
    setBusy(true); setError(null);
    const payload = { source_position_id: positionId, quantity, operated_at: day, comment: comment.trim() || undefined };
    try {
      await refundCryptoFee(eventId, { ...payload, request_id: request.requestId(payload) });
      request.completed(); onSuccess();
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  };
  return <BottomSheet open title="Возврат комиссии" tag={symbol} onClose={onClose}
    actions={<div className="tk-foot pf-sheet-actions">{error && <p className="tk-error">{error}</p>}
      <button className="btn btn--primary" disabled={busy || !(Number(quantity) > 0) || !day} onClick={() => void submit()}>{busy ? 'Сохраняем…' : 'Записать возврат'}</button></div>}>
    <div className="apf-field"><label className="apf-label">Получено, {symbol}</label><input className="apf-input" inputMode="decimal" value={quantity} disabled={busy} onChange={(e) => setQuantity(sanitizeDecimalInput(e.target.value))} /></div>
    <div className="apf-field"><label className="apf-label">Дата возврата</label><input className="apf-input" type="date" value={day} disabled={busy} onChange={(e) => setDay(e.target.value)} /></div>
    <div className="apf-field"><label className="apf-label">Комментарий</label><input className="apf-input" value={comment} disabled={busy} onChange={(e) => setComment(e.target.value)} /></div>
  </BottomSheet>;
}
