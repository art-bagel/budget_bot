import { useEffect, useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { fetchCryptoProtocolHistory } from '../api';
import type { CryptoProtocolHistoryEntry } from '../api';
import { currencySymbol, formatNumericAmount } from '../utils/format';

const LABELS: Record<string, string> = {
  stake_to_protocol: 'Размещение в DeFi',
  top_up_protocol: 'Пополнение позиции',
  return_from_protocol: 'Возврат из DeFi',
  partial_return_from_protocol: 'Частичный вывод',
  rewards_from_protocol: 'Получение награды',
  lending_take_more_debt: 'Получение займа',
  lending_repay: 'Погашение займа',
  interest_accrual: 'Начисление процентов по займу',
  collateral_accrual: 'Начисление на залог',
  liquidation: 'Ликвидация: погашенный долг',
  fee: 'Комиссия',
  defi_gas_fee: 'Комиссия сети',
  external_expense: 'Расход',
  lp_farm: 'LP-токены переданы в фарминг',
  lp_return: 'LP-токены возвращены из фарминга',
  collateral_liquidation: 'Ликвидация: списанный залог',
  consume: 'Расход',
  opening: 'Открытие позиции',
};

export default function CryptoProtocolHistory({ positionId, baseCurrencyCode }: {
  positionId: number;
  baseCurrencyCode: string;
}) {
  const [entries, setEntries] = useState<CryptoProtocolHistoryEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [retry, setRetry] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  // biome-ignore lint/correctness/useExhaustiveDependencies: retry deliberately reloads a failed page.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(false);
    fetchCryptoProtocolHistory(positionId, offset)
      .then((data) => {
        if (cancelled) return;
        setEntries((previous) => offset === 0 ? data.entries : [...previous, ...data.entries]);
        setTotal(data.total);
      })
      .catch(() => { if (!cancelled) setError(true); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [positionId, offset, retry]);

  return (
    <div className="ca-sheet__hist">
      <button type="button" className="ca-sheet__hist-toggle" aria-expanded={!collapsed}
        onClick={() => setCollapsed((value) => !value)}>
        <h3 className="ca-sheet__hist-title">История · <span className="ca-sheet__hist-count">{total}</span></h3>
        {collapsed ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
      </button>
      {!collapsed && <>
        {entries.map((entry) => (
          <div key={entry.id} className="ca-sheet__row">
            <div className="ca-sheet__row-date">{entry.event_at.slice(2).split('-').reverse().join('.')}</div>
            <div className="ca-sheet__row-body">
              <div className="ca-sheet__row-line">
                <span className="ca-sheet__row-qty">{LABELS[entry.kind] ?? 'Операция DeFi'}</span>
              </div>
              <div className="ca-sheet__row-meta">
                {entry.quantity !== null && <span>{formatNumericAmount(Math.abs(entry.quantity), 9)} {entry.symbol}</span>}
                {entry.cost_basis !== null && <span>Себестоимость: {formatNumericAmount(entry.cost_basis)} {currencySymbol(baseCurrencyCode)}</span>}
              </div>
              {entry.comment && <div className="ca-sheet__row-comment">{entry.comment}</div>}
            </div>
          </div>
        ))}
        {loading && <p className="ca-sheet__hist-empty" role="status">Загружаем историю…</p>}
        {error && <div role="alert">
          <p>Не удалось загрузить историю.</p>
          <button type="button" className="btn btn--ghost" onClick={() => setRetry((value) => value + 1)}>Повторить</button>
        </div>}
        {!loading && !error && total === 0 && <p className="ca-sheet__hist-empty">Событий пока нет.</p>}
        {!loading && !error && entries.length < total && (
          <button type="button" className="btn btn--ghost" onClick={() => setOffset(entries.length)}>Показать ещё</button>
        )}
      </>}
    </div>
  );
}
