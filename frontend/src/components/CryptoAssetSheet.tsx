import { useEffect, useState } from 'react';
import { AlertCircle, ArrowDownLeft, ArrowLeftRight, ArrowUpRight, Gift, Info, Repeat, Wallet } from 'lucide-react';

import BottomSheet from './BottomSheet';
import { useModalOpen } from '../hooks/useModalOpen';
import { fetchCryptoAssetDetail } from '../api';
import { getCryptoIconUrl } from '../utils/cryptoAssets';
import { currencySymbol, formatNumericAmount } from '../utils/format';
import type {
  CryptoAssetDetail,
  CryptoAssetEntry,
  CryptoLivePrice,
} from '../types';


interface Props {
  open: boolean;
  investmentAccountId: number;
  cryptoAssetId: number;
  baseCurrencyCode: string;
  livePrice?: CryptoLivePrice | null;
  onClose: () => void;
  onOpenWithdraw?: () => void;
  onOpenSwap?: () => void;
  onOpenTransfer?: () => void;
  onOpenIncome?: () => void;
  canTransferBetweenAccounts?: boolean;
}


const ENTRY_TYPES = new Set(['open', 'top_up', 'transfer_in', 'swap_in', 'income']);


function formatDate(value: string): string {
  if (!value) return '';
  const [y, m, d] = value.split('-');
  if (!y || !m || !d) return value;
  return `${d}.${m}.${y.slice(2)}`;
}


function formatStaleAge(seconds: number | null | undefined): string {
  if (!seconds || seconds < 60) return '· не обновляется';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `· обновлено ${minutes} мин назад`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `· обновлено ${hours} ч назад`;
  const days = Math.floor(hours / 24);
  return `· обновлено ${days} дн назад`;
}


const INCOME_KIND_LABELS: Record<string, string> = {
  airdrop: 'Airdrop',
  reward: 'Награда',
  fork: 'Fork',
  other: 'Зачисление',
};


function describeCounterparty(entry: CryptoAssetEntry): string {
  const meta = entry.metadata ?? {};
  const sourceKind = entry.source_kind ?? null;
  const targetKind = entry.target_kind ?? null;
  const action = typeof meta.action === 'string' ? meta.action : null;
  const protocolName = typeof meta.protocol_name === 'string' ? meta.protocol_name : null;
  const incomeKind = typeof meta.income_kind === 'string' ? meta.income_kind : null;
  const fromSymbol = typeof meta.from_asset_symbol === 'string' ? meta.from_asset_symbol : null;
  const toSymbol = typeof meta.to_asset_symbol === 'string' ? meta.to_asset_symbol : null;

  if (sourceKind === 'bank') return 'Из банка';
  if (targetKind === 'bank') return 'В банк';
  if (sourceKind === 'swap') return fromSymbol ? `Swap из ${fromSymbol}` : 'Swap (вход)';
  if (targetKind === 'swap') return toSymbol ? `Swap в ${toSymbol}` : 'Swap (выход)';
  if (sourceKind === 'cross_account') return 'Перевод из другого счёта';
  if (targetKind === 'cross_account') return 'Перевод в другой счёт';
  if (sourceKind === 'defi_return') return protocolName ? `Возврат из ${protocolName}` : 'Возврат из DeFi';
  if (targetKind === 'defi') return protocolName ? `В DeFi: ${protocolName}` : 'В DeFi';
  if (sourceKind === 'income') {
    if (protocolName) return `Награды: ${protocolName}`;
    if (incomeKind && INCOME_KIND_LABELS[incomeKind]) return INCOME_KIND_LABELS[incomeKind];
    return 'Зачисление';
  }
  if (action === 'rewards_from_protocol') return protocolName ? `Награды: ${protocolName}` : 'Награды DeFi';
  if (action === 'return_from_protocol') return protocolName ? `Возврат из ${protocolName}` : 'Возврат из DeFi';
  if (action === 'stake_to_protocol') return protocolName ? `В DeFi: ${protocolName}` : 'В DeFi';
  if (action === 'transfer_to_banking') return 'В банк';
  if (entry.event_type === 'income') {
    if (incomeKind && INCOME_KIND_LABELS[incomeKind]) return INCOME_KIND_LABELS[incomeKind];
    return 'Зачисление';
  }
  return entry.event_type;
}


export default function CryptoAssetSheet({
  open,
  investmentAccountId,
  cryptoAssetId,
  baseCurrencyCode,
  livePrice,
  onClose,
  onOpenWithdraw,
  onOpenSwap,
  onOpenTransfer,
  onOpenIncome,
  canTransferBetweenAccounts,
}: Props) {
  useModalOpen(open);

  const [detail, setDetail] = useState<CryptoAssetDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setDetail(null);
    fetchCryptoAssetDetail(investmentAccountId, cryptoAssetId)
      .then((d) => { if (!cancelled) setDetail(d); })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, investmentAccountId, cryptoAssetId]);

  const baseSym = currencySymbol(baseCurrencyCode);

  const currentValue = detail && livePrice && livePrice.price > 0
    ? detail.quantity * livePrice.price
    : null;
  const unrealized = currentValue !== null && detail
    ? currentValue - detail.remaining_cost_basis
    : null;
  const unrealizedPct = unrealized !== null && detail && detail.remaining_cost_basis > 0
    ? (unrealized / detail.remaining_cost_basis) * 100
    : null;

  const iconUrl = detail ? getCryptoIconUrl(detail.symbol, detail.asset_metadata) : null;
  const headerTag = detail?.investment_account_name
    ? `${detail.investment_account_name} · крипто`
    : 'Крипто-актив';

  const hasOutflowActions = Boolean(
    (onOpenWithdraw || onOpenSwap || onOpenTransfer) && detail && detail.quantity > 0,
  );
  const showActions = Boolean(!loading && !error && detail && (hasOutflowActions || onOpenIncome));

  return (
    <BottomSheet
      open={open}
      tag={headerTag}
      title={detail ? `${detail.symbol}${detail.network_code ? ` · ${detail.network_code}` : ''}` : 'Загрузка…'}
      icon={iconUrl ? <img src={iconUrl} alt="" /> : undefined}
      iconColor={iconUrl ? undefined : 'o'}
      onClose={onClose}
      actions={showActions ? (
        <div className="ca-sheet__actions">
          {onOpenIncome && (
            <button
              type="button"
              className="ca-sheet__action"
              onClick={() => { onClose(); onOpenIncome(); }}
            >
              <Gift size={16} strokeWidth={2.2} />
              <span>Зачислить</span>
            </button>
          )}
          {hasOutflowActions && onOpenSwap && (
            <button
              type="button"
              className="ca-sheet__action"
              onClick={() => { onClose(); onOpenSwap(); }}
            >
              <Repeat size={16} strokeWidth={2.2} />
              <span>Свопнуть</span>
            </button>
          )}
          {hasOutflowActions && onOpenTransfer && canTransferBetweenAccounts && (
            <button
              type="button"
              className="ca-sheet__action"
              onClick={() => { onClose(); onOpenTransfer(); }}
            >
              <ArrowLeftRight size={16} strokeWidth={2.2} />
              <span>На счёт</span>
            </button>
          )}
          {hasOutflowActions && onOpenWithdraw && (
            <button
              type="button"
              className="ca-sheet__action"
              onClick={() => { onClose(); onOpenWithdraw(); }}
            >
              <Wallet size={16} strokeWidth={2.2} />
              <span>В банк</span>
            </button>
          )}
        </div>
      ) : undefined}
    >
      {loading && (
        <div className="ca-sheet__state">
          <div className="ca-sheet__spinner" />
          <span>Загружаем актив…</span>
        </div>
      )}

      {error && (
        <div className="ca-sheet__state ca-sheet__state--error">
          <AlertCircle size={20} strokeWidth={2} />
          <span>{error}</span>
        </div>
      )}

      {!loading && !error && detail && (
        <>
          <div className="ca-sheet__hero">
            <div className="ca-sheet__hero-qty">
              <span className="ca-sheet__hero-qty-num">{formatNumericAmount(detail.quantity, 8)}</span>
              <span className="ca-sheet__hero-qty-sym">{detail.symbol}</span>
            </div>
            <div className="ca-sheet__hero-value">
              {currentValue !== null
                ? `${formatNumericAmount(currentValue)} ${baseSym}`
                : `≈ ${formatNumericAmount(detail.remaining_cost_basis)} ${baseSym} (по себестоимости)`}
            </div>
            {livePrice && (
              <div className="ca-sheet__hero-price">
                {formatNumericAmount(livePrice.price, 6)} {currencySymbol(livePrice.vs_currency)} за 1 {detail.symbol}
                {livePrice.is_stale && (
                  <span className="ca-sheet__hero-stale">
                    {formatStaleAge(livePrice.stale_age_seconds)}
                  </span>
                )}
              </div>
            )}
          </div>

          <div className="ca-sheet__stats">
            <div className="ca-sheet__stat">
              <span className="ca-sheet__stat-label">Cost basis</span>
              <span className="ca-sheet__stat-val">
                {formatNumericAmount(detail.remaining_cost_basis)} {baseSym}
              </span>
              <span className="ca-sheet__stat-sub">
                avg {formatNumericAmount(detail.avg_cost_per_unit, 4)}
              </span>
            </div>
            <div className="ca-sheet__stat">
              <span className="ca-sheet__stat-label">Unrealized</span>
              {unrealized !== null ? (
                <>
                  <span className={`ca-sheet__stat-val ${unrealized >= 0 ? 'ca-sheet__stat-val--pos' : 'ca-sheet__stat-val--neg'}`}>
                    {unrealized >= 0 ? '+' : ''}{formatNumericAmount(unrealized)} {baseSym}
                  </span>
                  {unrealizedPct !== null && (
                    <span className="ca-sheet__stat-sub">
                      {unrealizedPct >= 0 ? '+' : ''}{formatNumericAmount(unrealizedPct, 2)}%
                    </span>
                  )}
                </>
              ) : (
                <>
                  <span className="ca-sheet__stat-val ca-sheet__stat-val--mute">—</span>
                  <span className="ca-sheet__stat-sub">нет live-цены</span>
                </>
              )}
            </div>
            <div className="ca-sheet__stat">
              <span className="ca-sheet__stat-label">Realized</span>
              <span className={`ca-sheet__stat-val ${detail.realized_pnl_lifetime_in_base >= 0 ? 'ca-sheet__stat-val--pos' : detail.realized_pnl_lifetime_in_base < 0 ? 'ca-sheet__stat-val--neg' : 'ca-sheet__stat-val--mute'}`}>
                {detail.realized_pnl_lifetime_in_base > 0 ? '+' : ''}{formatNumericAmount(detail.realized_pnl_lifetime_in_base)} {baseSym}
              </span>
              <span className="ca-sheet__stat-sub">lifetime</span>
            </div>
          </div>

          <div className="ca-sheet__hist">
            <h3 className="ca-sheet__hist-title">
              История · <span className="ca-sheet__hist-count">{detail.entries.length}</span>
            </h3>

            {detail.entries.length === 0 && (
              <p className="ca-sheet__hist-empty">Событий пока нет.</p>
            )}

            {detail.entries.map((entry) => {
              const isEntry = ENTRY_TYPES.has(entry.event_type);
              const valueShown = isEntry ? entry.entry_value_in_base : entry.value_in_base;
              const realized = entry.realized_in_base;
              return (
                <div key={entry.event_id} className="ca-sheet__row">
                  <div className="ca-sheet__row-date">{formatDate(entry.event_at)}</div>
                  <div className="ca-sheet__row-body">
                    <div className="ca-sheet__row-line">
                      <span className={`ca-sheet__row-arrow ${isEntry ? 'ca-sheet__row-arrow--in' : 'ca-sheet__row-arrow--out'}`}>
                        {isEntry
                          ? <ArrowDownLeft size={14} strokeWidth={2.4} />
                          : <ArrowUpRight size={14} strokeWidth={2.4} />}
                      </span>
                      <span className="ca-sheet__row-qty">
                        {isEntry ? '+' : '−'}{formatNumericAmount(Math.abs(entry.quantity ?? 0), 8)} {detail.symbol}
                      </span>
                      <span className="ca-sheet__row-val">
                        {valueShown !== null && valueShown !== undefined
                          ? `${formatNumericAmount(valueShown)} ${baseSym}`
                          : '—'}
                      </span>
                    </div>
                    <div className="ca-sheet__row-meta">
                      <span className="ca-sheet__row-cp">{describeCounterparty(entry)}</span>
                      {realized !== null && realized !== undefined && Math.abs(realized) > 0.005 && (
                        <span className={`ca-sheet__row-real ${realized >= 0 ? 'ca-sheet__row-real--pos' : 'ca-sheet__row-real--neg'}`}>
                          {realized >= 0 ? '+' : ''}{formatNumericAmount(realized)} real
                        </span>
                      )}
                    </div>
                    {entry.is_legacy_no_basis && (
                      <div className="ca-sheet__row-legacy">
                        <Info size={12} strokeWidth={2} />
                        <span>Cost basis не задан (legacy event)</span>
                      </div>
                    )}
                    {entry.comment && (
                      <div className="ca-sheet__row-comment">{entry.comment}</div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </BottomSheet>
  );
}
