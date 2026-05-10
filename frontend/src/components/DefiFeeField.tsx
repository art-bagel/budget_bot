import { useMemo } from 'react';
import type { PortfolioPosition } from '../types';
import { sanitizeDecimalInput } from '../utils/validation';
import { formatNumericAmount } from '../utils/format';
import { getPositionMetadataText } from '../utils/portfolioPosition';
import { payCryptoFee } from '../api';

export type DefiFeeDraft = {
  positionId: string;
  quantity: string;
};

export const EMPTY_FEE_DRAFT: DefiFeeDraft = { positionId: '', quantity: '' };

export function isFeeDraftActive(draft: DefiFeeDraft): boolean {
  return !!draft.positionId && !!draft.quantity.trim();
}

export function parseFeeDraft(
  draft: DefiFeeDraft,
  candidates: PortfolioPosition[],
): { positionId: number; quantity: number } | null {
  if (!isFeeDraftActive(draft)) return null;
  const positionId = Number(draft.positionId);
  const quantity = Number(draft.quantity);
  if (!Number.isFinite(positionId) || positionId <= 0) return null;
  if (!Number.isFinite(quantity) || quantity <= 0) return null;
  const candidate = candidates.find((p) => p.id === positionId);
  if (!candidate) return null;
  return { positionId, quantity };
}

export async function applyDefiFee(
  draft: DefiFeeDraft,
  accountPositions: PortfolioPosition[],
  linkProtocolPositionId: number | null,
  operatedAt?: string | null,
): Promise<string | null> {
  const fee = parseFeeDraft(draft, accountPositions);
  if (!fee) return null;
  try {
    await payCryptoFee(fee.positionId, {
      quantity: fee.quantity,
      link_protocol_position_id: linkProtocolPositionId ?? undefined,
      operated_at: operatedAt || undefined,
    });
    return null;
  } catch (reason) {
    return `Операция выполнена, но не удалось списать газ: ${reason instanceof Error ? reason.message : String(reason)}`;
  }
}

type Props = {
  accountPositions: PortfolioPosition[];
  value: DefiFeeDraft;
  onChange: (next: DefiFeeDraft) => void;
  disabled?: boolean;
};

export function DefiFeeField({ accountPositions, value, onChange, disabled }: Props) {
  const candidates = useMemo(
    () => accountPositions
      .filter((p) => p.status === 'open' && p.asset_type_code === 'crypto' && (p.quantity ?? 0) > 0)
      .sort((a, b) => {
        const sa = (getPositionMetadataText(a, 'asset_symbol') ?? a.title).toUpperCase();
        const sb = (getPositionMetadataText(b, 'asset_symbol') ?? b.title).toUpperCase();
        return sa.localeCompare(sb);
      }),
    [accountPositions],
  );

  const selected = candidates.find((p) => String(p.id) === value.positionId);
  const symbol = selected ? (getPositionMetadataText(selected, 'asset_symbol') ?? selected.title) : '';
  const available = selected?.quantity ?? 0;
  const num = Number(value.quantity);
  const tooMuch = !!selected && Number.isFinite(num) && num > available;

  return (
    <div className="apf-field">
      <label className="apf-label">Газ / комиссия (опционально)</label>
      <div className="tok-row">
        <div className="tok-row__pick">
          <select
            className="picker-v2"
            value={value.positionId}
            onChange={(e) => onChange({ ...value, positionId: e.target.value })}
            disabled={disabled || candidates.length === 0}
          >
            <option value="">{candidates.length > 0 ? 'Без комиссии' : 'Нет активов'}</option>
            {candidates.map((p) => {
              const sym = getPositionMetadataText(p, 'asset_symbol') ?? p.title;
              return (
                <option key={p.id} value={p.id}>
                  {sym}
                </option>
              );
            })}
          </select>
        </div>
        <input
          className="apf-input tok-row__amt"
          type="text"
          inputMode="decimal"
          placeholder="0"
          value={value.quantity}
          onChange={(e) => onChange({ ...value, quantity: sanitizeDecimalInput(e.target.value) })}
          disabled={disabled || !selected}
        />
      </div>
      {selected ? (
        <span className={`tok-row__hint${tooMuch ? ' tok-row__hint--muted' : ''}`}>
          {tooMuch
            ? `Не хватает ${symbol}: на счёте ${formatNumericAmount(available, 8)}`
            : `Спишется со счёта · доступно ${formatNumericAmount(available, 8)} ${symbol}`}
        </span>
      ) : null}
    </div>
  );
}
