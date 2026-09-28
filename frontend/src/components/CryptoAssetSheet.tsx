import { walletMarketValue } from '../utils/cryptoProtocolValuation';
import { useEffect, useState } from 'react';
import { AlertCircle, ArrowDownLeft, ArrowLeftRight, ArrowUpRight, ChevronDown, ChevronUp, Info, Landmark, Plus, RefreshCw } from 'lucide-react';

import BottomSheet from './BottomSheet';
import { useModalOpen } from '../hooks/useModalOpen';
import { fetchCryptoAssetDetail } from '../api';
import { getCryptoIconUrl } from '../utils/cryptoAssets';
import { cryptoNetworkSuffix, cryptoPriceSourceLabel, cryptoQuoteTime } from '../utils/cryptoAssetLabel';
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
  isHidden?: boolean;
  onChangeHidden?: (hidden: boolean) => Promise<void>;
  onOpenWithdraw?: () => void;
  onOpenSwap?: () => void;
  onOpenTransfer?: () => void;
  onOpenIncome?: () => void;
  onRefundFee?: (entry: CryptoAssetEntry, symbol: string) => void;
  canTransferBetweenAccounts?: boolean;
}


const ENTRY_TYPES = new Set(['open', 'top_up', 'transfer_in', 'swap_in', 'income']);
const HISTORY_PAGE = 30;


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


/** Stat tiles are narrow: whole rubles for large sums, kopecks only where they matter. */
function formatStatAmount(value: number): string {
  return formatNumericAmount(value, Math.abs(value) >= 1000 ? 0 : 2);
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

  if (sourceKind === 'funding_settlement') return 'Себестоимость после погашения займа';
  if (sourceKind === 'liquidation_funding_settlement') return 'Себестоимость после ликвидации';
  if (sourceKind === 'fee_refund') return 'Возврат комиссии';
  if (sourceKind === 'bank') return 'Из банка';
  if (targetKind === 'bank') return 'В банк';
  if (sourceKind === 'swap') return fromSymbol ? `Обмен из ${fromSymbol}` : 'Обмен (получено)';
  if (targetKind === 'swap') return toSymbol ? `Обмен в ${toSymbol}` : 'Обмен (списано)';
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
  return ({ open: 'Зачисление', top_up: 'Пополнение', fee: 'Комиссия', adjustment: 'Корректировка', transfer_in: 'Входящий перевод', transfer_out: 'Исходящий перевод', swap_in: 'Обмен (получено)', swap_out: 'Обмен (списано)', close: 'Закрытие', partial_close: 'Частичное закрытие' } as Record<string, string>)[entry.event_type] ?? 'Операция';
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
  onRefundFee,
  canTransferBetweenAccounts,
  isHidden,
  onChangeHidden,
}: Props) {
  useModalOpen(open);

  const [detail, setDetail] = useState<CryptoAssetDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [visibilitySaving, setVisibilitySaving] = useState(false);
  const [historyCollapsed, setHistoryCollapsed] = useState(false);
  const [historyLimit, setHistoryLimit] = useState(HISTORY_PAGE);

  useEffect(() => {
    if (open) {
      setHistoryCollapsed(false);
      setHistoryLimit(HISTORY_PAGE);
    }
  }, [open]);

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
  const basisQuality = detail?.basis_quality ?? detail?.asset_metadata.reconstruction_basis_quality;
  const basisUnknown = basisQuality === 'unknown' || basisQuality === 'invalid' || detail?.remaining_cost_basis == null;
  const basisEstimated = basisQuality === 'estimated';
  const basisOpen = detail?.basis_final === false;

  const currentValue = detail
    ? walletMarketValue(Number(detail.quantity), cryptoAssetId, new Map(livePrice ? [[cryptoAssetId, livePrice]] : []), baseCurrencyCode)
    : null;
  const unrealized = currentValue !== null && detail && !basisUnknown && !basisOpen && detail.remaining_cost_basis !== null
    ? currentValue - detail.remaining_cost_basis
    : null;
  const unrealizedPct = unrealized !== null && detail && detail.remaining_cost_basis !== null && detail.remaining_cost_basis > 0
    ? (unrealized / detail.remaining_cost_basis) * 100
    : null;

  const iconUrl = detail ? getCryptoIconUrl(detail.symbol, detail.asset_metadata) : null;
  const headerTag = detail?.investment_account_name ?? 'Криптовалюта';

  const hasOutflowActions = Boolean(
    (onOpenWithdraw || onOpenSwap || onOpenTransfer) && detail && detail.quantity > 0,
  );
  const showActions = Boolean(!loading && !error && detail && (hasOutflowActions || onOpenIncome));

  return (
    <BottomSheet
      open={open}
      tag={headerTag}
      title={detail ? `${detail.symbol}${cryptoNetworkSuffix(detail.network_code, detail.symbol)}` : 'Загрузка…'}
      icon={iconUrl ? <img src={iconUrl} alt="" /> : undefined}
      iconColor={iconUrl ? undefined : 'o'}
      onClose={onClose}
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
                : '—'}
            </div>
            {livePrice && (
              <div className="ca-sheet__hero-price">
                {formatNumericAmount(livePrice.price, livePrice.price < 1 ? 6 : 2)} {currencySymbol(livePrice.vs_currency)} за 1 {detail.symbol}
                {' · '}{cryptoPriceSourceLabel(livePrice.source)}, {cryptoQuoteTime(livePrice.fetched_at)}
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
              <span className="ca-sheet__stat-label">{basisOpen ? 'Учтённые затраты' : 'Себестоимость'}</span>
              <span className="ca-sheet__stat-val">
                {basisUnknown ? '—' : `${basisEstimated ? '≈ ' : ''}${formatStatAmount(detail.remaining_cost_basis ?? 0)}\u00a0${baseSym}`}
              </span>
              <span className="ca-sheet__stat-sub">
                {basisUnknown ? 'неизвестна' : basisOpen ? 'с займом' : `${formatNumericAmount(detail.avg_cost_per_unit ?? 0, (detail.avg_cost_per_unit ?? 0) < 1 ? 6 : 2)} ${baseSym} за 1 ${detail.symbol}`}
              </span>
            </div>
            <div className="ca-sheet__stat">
              <span className="ca-sheet__stat-label">Изменение цены</span>
              {unrealized !== null ? (
                <>
                  <span className={`ca-sheet__stat-val ${unrealized >= 0 ? 'ca-sheet__stat-val--pos' : 'ca-sheet__stat-val--neg'}`}>
                    {unrealized >= 0 ? '+' : ''}{formatStatAmount(unrealized)}{'\u00a0'}{baseSym}
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
                  <span className="ca-sheet__stat-sub">{currentValue === null ? 'нет курса' : basisOpen ? 'заём не погашен' : 'нет себестоимости'}</span>
                </>
              )}
            </div>
            <div className="ca-sheet__stat">
              <span className="ca-sheet__stat-label">Результат продаж</span>
              <span className={`ca-sheet__stat-val ${detail.realized_pnl_lifetime_in_base !== null && detail.realized_pnl_lifetime_in_base >= 0 ? 'ca-sheet__stat-val--pos' : detail.realized_pnl_lifetime_in_base !== null && detail.realized_pnl_lifetime_in_base < 0 ? 'ca-sheet__stat-val--neg' : 'ca-sheet__stat-val--mute'}`}>
                {basisUnknown || basisEstimated || detail.realized_pnl_lifetime_in_base === null ? '—' : `${detail.realized_pnl_lifetime_in_base > 0 ? '+' : ''}${formatStatAmount(detail.realized_pnl_lifetime_in_base)}\u00a0${baseSym}`}
              </span>
              <span className="ca-sheet__stat-sub">за всё время</span>
            </div>
          </div>

          {basisOpen && (detail.funding_components?.length ?? 0) > 0 && (
            <div className="ca-sheet__funding">
              <span className="ca-sheet__funding-label">Незакрытое финансирование</span>
              <span className="ca-sheet__funding-value">
                {detail.funding_components?.map((part) => (
                  <span key={part.loan_id}>{formatNumericAmount(Number(part.quantity), 8)} {part.symbol}</span>
                ))}
              </span>
            </div>
          )}

          {showActions && (
            <div className="cat-actions cat-actions--crypto" role="group" aria-label={`Действия с ${detail.symbol}`}>
              {onOpenIncome && (
                <button className="cat-act cat-act--primary" type="button" onClick={() => { onClose(); onOpenIncome(); }}>
                  <span className="cat-act__ico"><Plus strokeWidth={2.2} /></span>
                  <span className="cat-act__label">Зачислить</span>
                </button>
              )}
              {hasOutflowActions && onOpenSwap && (
                <button className="cat-act" type="button" onClick={() => { onClose(); onOpenSwap(); }}>
                  <span className="cat-act__ico"><RefreshCw strokeWidth={2} /></span>
                  <span className="cat-act__label">Обмен</span>
                </button>
              )}
              {hasOutflowActions && onOpenTransfer && canTransferBetweenAccounts && (
                <button className="cat-act" type="button" onClick={() => { onClose(); onOpenTransfer(); }}>
                  <span className="cat-act__ico"><ArrowLeftRight strokeWidth={2} /></span>
                  <span className="cat-act__label">Перевод</span>
                </button>
              )}
              {hasOutflowActions && onOpenWithdraw && (
                <button className="cat-act" type="button" onClick={() => { onClose(); onOpenWithdraw(); }}>
                  <span className="cat-act__ico"><Landmark strokeWidth={2} /></span>
                  <span className="cat-act__label">В банк</span>
                </button>
              )}
            </div>
          )}

          {detail.quantity === 0 && onChangeHidden && (
            <button type="button" className="credits-textbtn ca-sheet__hide" disabled={visibilitySaving}
              onClick={async () => {
                setVisibilitySaving(true);
                try { await onChangeHidden(!isHidden); } finally { setVisibilitySaving(false); }
              }}>
              {isHidden ? 'Показывать в кошельке' : 'Скрыть из кошелька'}
            </button>
          )}

          <div className="ca-sheet__hist">
            <button
              type="button"
              className="ca-sheet__hist-toggle"
              onClick={() => setHistoryCollapsed((v) => !v)}
              aria-expanded={!historyCollapsed}
            >
              <h3 className="ca-sheet__hist-title">
                История · <span className="ca-sheet__hist-count">{detail.entries.length}</span>
              </h3>
              {historyCollapsed
                ? <ChevronDown size={16} strokeWidth={2.2} />
                : <ChevronUp size={16} strokeWidth={2.2} />}
            </button>

            {!historyCollapsed && detail.entries.length === 0 && (
              <p className="ca-sheet__hist-empty">Событий пока нет.</p>
            )}

            {!historyCollapsed && detail.entries.slice(0, historyLimit).map((entry) => {
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
                        {entry.source_kind === 'funding_settlement' || entry.source_kind === 'liquidation_funding_settlement' ? 'Уточнение себестоимости' : `${isEntry ? '+' : '−'}${formatNumericAmount(Math.abs(entry.quantity ?? 0), 8)} ${detail.symbol}`}
                      </span>
                      <span className="ca-sheet__row-val">
                        {valueShown !== null && valueShown !== undefined
                          ? `${formatNumericAmount(valueShown)} ${baseSym}`
                          : '—'}
                      </span>
                    </div>
                    <div className="ca-sheet__row-meta">
                      <span className="ca-sheet__row-cp">{describeCounterparty(entry)}</span>
                      {entry.event_type !== 'fee' && realized !== null && realized !== undefined && Math.abs(realized) > 0.005 && (
                        <span className={`ca-sheet__row-real ${realized >= 0 ? 'ca-sheet__row-real--pos' : 'ca-sheet__row-real--neg'}`}>
                          Результат: {realized >= 0 ? '+' : ''}{formatNumericAmount(realized)} {baseSym}
                        </span>
                      )}
                      {entry.event_type === 'fee' && entry.position_id && onRefundFee && (
                        <button type="button" className="credits-textbtn ca-sheet__row-link" onClick={() => onRefundFee(entry, detail.symbol)}>
                          Записать возврат
                        </button>
                      )}
                    </div>
                    {entry.is_legacy_no_basis && (
                      <div className="ca-sheet__row-legacy">
                        <Info size={12} strokeWidth={2} />
                        <span>Себестоимость не указана</span>
                      </div>
                    )}
                    {entry.comment && !entry.comment_is_system && (
                      <div className="ca-sheet__row-comment">{entry.comment}</div>
                    )}
                  </div>
                </div>
              );
            })}
            {!historyCollapsed && detail.entries.length > historyLimit && (
              <button type="button" className="pf-closed__toggle" onClick={() => setHistoryLimit((limit) => limit + HISTORY_PAGE * 2)}>
                Показать ещё
              </button>
            )}
          </div>
        </>
      )}
    </BottomSheet>
  );
}
