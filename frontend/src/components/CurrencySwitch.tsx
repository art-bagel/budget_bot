import { useEffect, useState } from 'react';
import { fetchCryptoAssets, fetchCryptoLivePrices } from '../api';
import { currencySymbol, formatNumericAmount } from '../utils/format';

// There is no fiat rate source: CoinGecko quotes every coin in both currencies through
// the same fiat rate, so any coin's price ratio is today's base-per-dollar rate.
async function fetchDollarRate(baseCurrencyCode: string): Promise<number> {
  const assets = await fetchCryptoAssets();
  const ids = [...assets].sort((a, b) => Number(b.symbol === 'USDT') - Number(a.symbol === 'USDT')).slice(0, 20).map((asset) => asset.id);
  const [base, usd] = await Promise.all([fetchCryptoLivePrices(ids, baseCurrencyCode.toLowerCase()), fetchCryptoLivePrices(ids, 'usd')]);
  for (const quote of base) {
    const dollar = usd.find((item) => item.crypto_asset_id === quote.crypto_asset_id);
    if (dollar && dollar.price > 0 && quote.price > 0 && !quote.is_stale && !dollar.is_stale) return quote.price / dollar.price;
  }
  throw new Error('Курс доллара сейчас недоступен');
}

export type DollarDisplay = {
  baseCurrencyCode: string;
  inDollars: boolean;
  rate: number | null;
  state: 'idle' | 'loading' | 'failed';
  /** Base-currency amount in the shown currency. */
  convert: (value: number) => number;
  symbol: string;
  show: (dollars: boolean) => Promise<void>;
};

// The viewer's last choice; storage may be unavailable, so it is only a convenience.
const STORAGE_KEY = 'portfolio.displayCurrency';
function rememberDollars(dollars: boolean) {
  try { localStorage.setItem(STORAGE_KEY, dollars ? 'USD' : 'base'); } catch { /* not remembered */ }
}
function rememberedDollars(): boolean {
  try { return localStorage.getItem(STORAGE_KEY) === 'USD'; } catch { return false; }
}

// Amounts in the base currency, optionally shown in dollars at today's rate.
export function useDollarDisplay(baseCurrencyCode: string): DollarDisplay {
  const [rate, setRate] = useState<number | null>(null);
  const [inDollars, setInDollars] = useState(false);
  const [state, setState] = useState<DollarDisplay['state']>('idle');
  const active = inDollars && rate !== null;
  const show = async (dollars: boolean) => {
    rememberDollars(dollars);
    if (!dollars || rate !== null) { setInDollars(dollars); return; }
    setState('loading');
    try {
      setRate(await fetchDollarRate(baseCurrencyCode));
      setInDollars(true);
      setState('idle');
    } catch {
      setState('failed');
    }
  };
  // biome-ignore lint/correctness/useExhaustiveDependencies: restore the remembered choice once per base currency.
  useEffect(() => {
    if (baseCurrencyCode !== 'USD' && rememberedDollars()) void show(true);
  }, [baseCurrencyCode]);
  return {
    baseCurrencyCode,
    inDollars: active,
    rate,
    state,
    convert: (value) => (active ? value / (rate as number) : value),
    symbol: active ? '$' : currencySymbol(baseCurrencyCode),
    show,
  };
}

export default function CurrencySwitch({ display }: { display: DollarDisplay }) {
  if (display.baseCurrencyCode === 'USD') return null;
  return (
    <div className="ica-cur" role="group" aria-label="Валюта сумм">
      {[false, true].map((dollars) => (
        <button key={String(dollars)} type="button" aria-pressed={display.inDollars === dollars}
          className={`ica-cur__btn${display.inDollars === dollars ? ' ica-cur__btn--on' : ''}`}
          disabled={display.state === 'loading'} onClick={() => void display.show(dollars)}>
          {dollars ? '$' : currencySymbol(display.baseCurrencyCode)}
        </button>
      ))}
    </div>
  );
}

// Which rate the amounts use, or why they stayed in the base currency.
export function CurrencyNote({ display }: { display: DollarDisplay }) {
  if (display.state === 'failed') return <span className="ica-total__rate" role="alert">Курс доллара сейчас недоступен, суммы в {display.baseCurrencyCode}</span>;
  if (!display.inDollars || display.rate === null) return null;
  return <span className="ica-total__rate">По текущему курсу CoinGecko: 1 $ = {formatNumericAmount(display.rate, 2)} {currencySymbol(display.baseCurrencyCode)}</span>;
}
