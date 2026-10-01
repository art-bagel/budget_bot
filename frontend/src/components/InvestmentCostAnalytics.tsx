import { useEffect, useState } from 'react';
import { ArrowUpFromLine, Receipt, Shuffle, Wallet } from 'lucide-react';
import { fetchInvestmentCostAnalytics, type InvestmentCostAnalyticsData } from '../api';
import { currencySymbol, formatNumericAmount } from '../utils/format';
import { cryptoNetworkSuffix } from '../utils/cryptoAssetLabel';
import { getCryptoIconUrl } from '../utils/cryptoAssets';
import PaRow, { PA_COLORS } from './PaRow';

type Props = { assetType: 'crypto' | 'collectible'; accountId?: number; baseCurrencyCode: string };

const COLLAPSED_COINS = 8;

const quantityText = (value: number) => formatNumericAmount(value, value >= 100 ? 2 : value >= 1 ? 4 : 6);

export default function InvestmentCostAnalytics({ assetType, accountId, baseCurrencyCode }: Props) {
  const [data, setData] = useState<InvestmentCostAnalyticsData | null>(null);
  const [error, setError] = useState('');
  const [allCoins, setAllCoins] = useState(false);
  useEffect(() => {
    let active = true;
    setData(null);
    setError('');
    fetchInvestmentCostAnalytics(assetType, accountId)
      .then(value => { if (active) setData(value); })
      .catch((e: unknown) => { if (active) setError(e instanceof Error ? e.message : 'Не удалось загрузить аналитику'); });
    return () => { active = false; };
  }, [assetType, accountId]);
  const sym = currencySymbol(baseCurrencyCode);
  const money = (value: number) => `${formatNumericAmount(value, 0)} ${sym}`;
  const signed = (value: number) => `${value > 0 ? '+' : value < 0 ? '−' : ''}${money(Math.abs(value))}`;
  if (error) return <section className="pa-card"><div className="tk-error" role="alert">{error}</div></section>;
  if (!data) return <section className="pa-card"><p className="ca-sheet__hist-empty" role="status">Загружаем аналитику…</p></section>;

  // Everything ever put in is either still held, withdrawn, spent, or a residual difference.
  const spent = data.fees + data.interest + data.expenses;
  const share = (value: number) => (data.invested > 0 ? Math.max(value, 0) / data.invested : 0);
  const pct = (value: number) => `${formatNumericAmount(share(value) * 100, share(value) < 0.1 ? 1 : 0)}%`;
  // Breakdown lines under a row, aligned with its title.
  const split = (items: [string, number][]) => {
    const shown = items.filter(([, amount]) => Math.abs(amount) >= 0.5);
    return shown.length > 1 ? (
      <div className="ica-split">
        {shown.map(([label, amount]) => (
          <div className="ica-split__row" key={label}><span>{label}</span><span>{money(amount)}</span></div>
        ))}
      </div>
    ) : null;
  };
  const segments = [
    { key: 'held', label: 'В активах', value: data.cost, color: 'g' },
    { key: 'out', label: 'Выведено', value: data.withdrawn, color: 'b' },
    { key: 'spent', label: 'Расходы', value: spent, color: 'r' },
    { key: 'other', label: 'Прочее', value: data.other, color: 'p' },
  ].filter((segment) => segment.value > 0.5);

  const coins = [...data.coins].sort((a, b) => b.cost - a.cost);
  const costed = coins.filter((coin) => coin.cost > 0 || coin.incomplete);
  const free = coins.filter((coin) => !costed.includes(coin));
  const costedTotal = costed.reduce((sum, coin) => sum + coin.cost, 0);
  const shownCoins = allCoins ? costed : costed.slice(0, COLLAPSED_COINS);

  return <>
    <section className="pa-card">
      <div className="pa-card__head"><h3 className="pa-card__title">Вложения за всё время</h3></div>
      <div className="ica-total">
        <span className="ica-total__label">Внесено</span>
        <span className="ica-total__value">{money(data.invested)}</span>
      </div>
      {segments.length > 1 && (
        <>
          <div className="ica-bar" aria-hidden="true">
            {segments.map((segment) => (
              <span key={segment.key} className={`ana-cat__fill--${segment.color}`} style={{ flexGrow: segment.value }} />
            ))}
          </div>
          {/* Shares of the invested total, keyed to the bar colours. */}
          <ul className="ica-legend">
            {segments.map((segment) => (
              <li key={segment.key}>
                <span className={`ica-legend__dot ana-cat__fill--${segment.color}`} aria-hidden="true" />
                {segment.label}<b>{pct(segment.value)}</b>
              </li>
            ))}
          </ul>
        </>
      )}
      <div className="ana-cats">
        <PaRow icon={<Wallet strokeWidth={2} />} color="g" title="Сейчас в активах" amount={money(data.cost)}
          foot={data.incomplete ? 'по известной себестоимости' : 'по себестоимости'} />
        {data.withdrawn >= 0.5 && (
          <>
            <PaRow icon={<ArrowUpFromLine strokeWidth={2} />} color="b" title="Выведено" amount={money(data.withdrawn)}
              foot="по себестоимости" />
            {assetType === 'crypto' && split([['В банк', data.bank_out], ['В коллекции', data.collection_out]])}
          </>
        )}
        {spent >= 0.5 && (
          <>
            <PaRow icon={<Receipt strokeWidth={2} />} color="r" title="Расходы" amount={money(spent)} />
            {split([['Комиссии минус возвраты', data.fees], ['Проценты и ликвидации', data.interest], ['Прочие расходы', data.expenses]])}
          </>
        )}
        {Math.abs(data.other) >= 0.5 && (
          <PaRow icon={<Shuffle strokeWidth={2} />} color="p" title="Прочие изменения" amount={signed(data.other)}
            foot="остаток сверки" />
        )}
      </div>
    </section>

    {assetType === 'crypto' && coins.length > 0 && (
      <section className="pa-card">
        <div className="pa-card__head"><h3 className="pa-card__title">Себестоимость монет</h3></div>
        <div className="ana-cats">
          {shownCoins.map((coin, index) => {
            const logo = getCryptoIconUrl(coin.symbol, { network_code: coin.network });
            const notes = [
              `${quantityText(coin.quantity)} ${coin.symbol}`,
              coin.defi_quantity > 0 ? `в DeFi ${quantityText(coin.defi_quantity)}` : null,
              coin.incomplete ? 'часть затрат неизвестна' : null,
              coin.funded ? 'есть заёмные средства' : null,
            ].filter(Boolean).join(' · ');
            return (
              <PaRow key={coin.asset_id} color={PA_COLORS[index % PA_COLORS.length]}
                icon={logo ? <img src={logo} alt="" loading="lazy" /> : coin.symbol.slice(0, 1).toUpperCase()}
                title={`${coin.symbol}${cryptoNetworkSuffix(coin.network, coin.symbol)}`}
                amount={money(coin.cost)} share={costedTotal > 0 ? coin.cost / costedTotal : 0}
                foot={notes}
                footRight={coin.unit_cost === null ? undefined : `${formatNumericAmount(coin.unit_cost, coin.unit_cost >= 1 ? 2 : 6)} ${sym} за 1`} />
            );
          })}
          {free.length > 0 && (allCoins || costed.length <= COLLAPSED_COINS) && (
            <PaRow icon="0" color="v" title="Без затрат" amount={`${free.length} шт.`} amountTone="mute"
              foot={free.map((coin) => coin.symbol).join(', ')} />
          )}
        </div>
        {costed.length > COLLAPSED_COINS && (
          <button type="button" className="pf-grp__more" onClick={() => setAllCoins((value) => !value)}>
            {allCoins ? 'Свернуть' : `Показать ещё ${costed.length - COLLAPSED_COINS + (free.length > 0 ? 1 : 0)}`}
          </button>
        )}
      </section>
    )}
  </>;
}
