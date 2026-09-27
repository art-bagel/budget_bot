import { useState } from 'react';
import BottomSheet from './BottomSheet';
import { useCryptoRequestKey } from '../hooks/useCryptoRequestKey';
import { liquidityAction } from '../api';
import type { CryptoAsset, CryptoProtocolPosition, PortfolioPosition } from '../types';
import { sanitizeDecimalInput } from '../utils/validation';
import { todayIso } from '../utils/portfolioPosition';
import { DefiFeeField, EMPTY_FEE_DRAFT, manualFee } from './DefiFeeField';

export default function LiquidityActionSheet({ position, action, assets, accountPositions, onClose, onSuccess }: {
  position: CryptoProtocolPosition;
  action: 'lp_snapshot' | 'lp_withdraw' | 'lp_reward';
  assets: CryptoAsset[];
  accountPositions: PortfolioPosition[];
  onClose: () => void;
  onSuccess: () => void;
}) {
  const request = useCryptoRequestKey(`liquidity:${position.id}:${action}`);
  const snapshot = position.metadata.lp_composition as { quantity0?: string; quantity1?: string } | undefined;
  const [quantity, setQuantity] = useState(action === 'lp_snapshot' ? snapshot?.quantity0 ?? position.current_quantity_exact ?? String(position.current_quantity ?? position.quantity ?? '') : '');
  const [secondary, setSecondary] = useState(action === 'lp_snapshot' ? snapshot?.quantity1 ?? position.token1_quantity_exact ?? String(position.metadata.token1_quantity ?? '') : '');
  const [share, setShare] = useState('');
  const [secondAssetId, setSecondAssetId] = useState(String(position.metadata.token1_crypto_asset_id ?? ''));
  const [assetId, setAssetId] = useState(String(position.crypto_asset_id ?? ''));
  const [date, setDate] = useState(todayIso());
  const [comment, setComment] = useState('');
  const [fee, setFee] = useState(EMPTY_FEE_DRAFT);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reward = action === 'lp_reward';
  const withdraw = action === 'lp_withdraw';
  const title = reward ? 'Получить награду' : withdraw ? 'Вывести часть ликвидности' : 'Обновить состав пула';
  const valid = (reward || !!secondAssetId) && quantity.trim() !== '' && Number.isFinite(Number(quantity)) && Number(quantity) >= 0
    && (reward ? Number(quantity) > 0 && !!assetId : secondary.trim() !== '' && Number.isFinite(Number(secondary)) && Number(secondary) >= 0)
    && (!withdraw || (Number(share) > 0 && Number(share) < 100 && Number(quantity) + Number(secondary) > 0));
  const submit = async () => {
    if (!valid || busy) return;
    setBusy(true); setError(null);
    try {
      const payload = { action, quantity, ...(reward ? { crypto_asset_id: Number(assetId) } : { secondary_quantity: secondary }),
        ...(withdraw ? { share_percent: share } : {}),
        ...(action === 'lp_snapshot' && !position.metadata.token1_crypto_asset_id ? { secondary_crypto_asset_id: Number(secondAssetId) } : {}), operated_at: date, comment: comment.trim() || undefined,
        ...(action !== 'lp_snapshot' ? { fee: manualFee(fee, accountPositions) } : {}),
      };
      await liquidityAction(position.id, { ...payload, request_id: request.requestId(payload) });
      request.completed(); onSuccess();
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  };
  const field = (label: string, value: string, setter: (value: string) => void) => <div className="apf-field">
    <label className="apf-label">{label}<input className="apf-input" inputMode="decimal" value={value}
      onChange={(e) => setter(sanitizeDecimalInput(e.target.value))} disabled={busy} /></label>
  </div>;
  return <BottomSheet open title={title} tag={position.protocol_name} onClose={onClose} actions={
    <div className="tk-foot pf-sheet-actions">{error && <p className="tk-error" role="alert">{error}</p>}
      <div className="tk-foot__row"><button type="button" className="btn btn--ghost" onClick={onClose} disabled={busy}>Отмена</button>
        <button type="button" className="btn btn--primary" disabled={!valid || busy} onClick={() => void submit()}>{busy ? 'Сохраняем…' : 'Сохранить'}</button>
      </div></div>}>
    {withdraw && field('Доля позиции, %', share, setShare)}
    {reward && <div className="apf-field"><label className="apf-label">Монета награды<select className="apf-input" value={assetId} onChange={(e) => setAssetId(e.target.value)} disabled={busy}>
      <option value="">Выберите монету</option>{assets.map((a) => <option key={a.id} value={a.id}>{a.symbol} · {a.network_code}</option>)}
    </select></label></div>}
    {action === 'lp_snapshot' && !position.metadata.token1_crypto_asset_id && <div className="apf-field"><label className="apf-label">Вторая монета пула<select className="apf-input" value={secondAssetId} onChange={(e) => setSecondAssetId(e.target.value)} disabled={busy}>
      <option value="">Выберите монету</option>{assets.filter((a) => a.id !== position.crypto_asset_id).map((a) => <option key={a.id} value={a.id}>{a.symbol} · {a.network_code}</option>)}
    </select></label></div>}
    {withdraw && !secondAssetId && <p className="tok-row__hint">Сначала укажите вторую монету через «Обновить состав пула».</p>}
    {field(reward ? 'Полученное количество' : `${position.asset_symbol} — количество`, quantity, setQuantity)}
    {!reward && field(`${String(position.metadata.token1_symbol ?? assets.find((a) => a.id === Number(secondAssetId))?.symbol ?? 'Вторая монета')} — количество`, secondary, setSecondary)}
    <div className="apf-field"><label className="apf-label">Дата<input className="apf-input" type="date" value={date} onChange={(e) => setDate(e.target.value)} disabled={busy} /></label></div>
    <div className="apf-field"><label className="apf-label">Комментарий<input className="apf-input" value={comment} onChange={(e) => setComment(e.target.value)} disabled={busy} /></label></div>
    {action !== 'lp_snapshot' && <DefiFeeField accountPositions={accountPositions} value={fee} onChange={setFee} disabled={busy} />}
  </BottomSheet>;
}
