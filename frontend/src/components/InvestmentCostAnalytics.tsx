import { useEffect, useState } from 'react';
import { fetchInvestmentCostAnalytics, type InvestmentCostAnalyticsData } from '../api';
import { currencySymbol, formatNumericAmount } from '../utils/format';
import { cryptoNetworkLabel } from '../utils/cryptoAssetLabel';

type Props = { assetType: 'crypto' | 'collectible'; accountId?: number; baseCurrencyCode: string };

export default function InvestmentCostAnalytics({ assetType, accountId, baseCurrencyCode }: Props) {
  const [data, setData] = useState<InvestmentCostAnalyticsData | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    setData(null);
    setError('');
    fetchInvestmentCostAnalytics(assetType, accountId)
      .then(value => { if (active) setData(value); })
      .catch((e: unknown) => { if (active) setError(e instanceof Error ? e.message : 'Не удалось загрузить аналитику'); });
    return () => { active = false; };
  }, [assetType, accountId]);
  const money = (value: number, digits = 2) => `${formatNumericAmount(value, digits)} ${currencySymbol(baseCurrencyCode)}`;
  if (error) return <section className="pa-card"><div className="tk-error" role="alert">{error}</div></section>;
  if (!data) return <section className="pa-card"><p className="ca-sheet__hist-empty" role="status">Загружаем аналитику…</p></section>;
  const rows: [string, number][] = [
    ['Внесено за всё время', data.invested],
    ['Себестоимость', data.cost],
    ['Выведено по себестоимости', data.withdrawn],
    ...(assetType === 'crypto' ? [
      ['Из них в банк', data.bank_out],
      ['Из них в коллекции', data.collection_out],
    ] as [string, number][] : []),
    ['Комиссии за вычетом возвратов', data.fees],
    ['Проценты и издержки ликвидаций', data.interest],
    ['Прочие учтённые расходы', data.expenses],
    ['Прочие изменения', data.other],
  ];
  return <>
    <section className="pa-card">
      <div className="pa-card__head"><h3 className="pa-card__title">Движение вложений</h3><span className="sec-tag">За всё время</span></div>
      {rows.filter(([, amount], i) => i < 3 || Math.abs(amount) >= 0.005).map(([label, amount]) =>
        <div className="pf-dcond__row" key={label}>
          <span className="pf-dcond__row-label">{label}</span>
          <span className="pf-dcond__row-value">{money(amount)}</span>
        </div>)}
    </section>
    {assetType === 'crypto' && data.coins.length > 0 && <section className="pa-card">
      <div className="pa-card__head"><h3 className="pa-card__title">Себестоимость монет</h3><span className="sec-tag">Кошельки и DeFi</span></div>
      {data.coins.map(coin => <div className="pf-dcond__row" key={coin.asset_id}>
        <span className="pf-dcond__row-label">{coin.symbol}
          <span className="pf-dcond__row-note">{formatNumericAmount(coin.quantity, 8)} · {cryptoNetworkLabel(coin.network)}</span>
          {coin.defi_quantity > 0 && <span className="pf-dcond__row-note">В DeFi: {formatNumericAmount(coin.defi_quantity, 8)}</span>}
        </span>
        <span className="pf-dcond__row-value">{coin.unit_cost === null ? '—' : money(coin.unit_cost, 6)} / монета
          <span className="pf-dcond__row-note">{coin.incomplete ? 'Известные затраты' : 'Всего'}: {money(coin.cost)}</span>
          {coin.funded && <span className="pf-dcond__row-note">Открытое финансирование</span>}
        </span>
      </div>)}
    </section>}
  </>;
}
