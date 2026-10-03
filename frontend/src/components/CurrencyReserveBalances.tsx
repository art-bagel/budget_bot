import { useState } from 'react';
import type { PortfolioSummaryItem } from '../types';
import { currencyName, currencySymbol, formatAmount, formatNumericAmount } from '../utils/format';
import type { DollarDisplay } from './CurrencySwitch';

// Issuer's flag for each currency, from the same CDN as the coin icons; pinned version.
const CURRENCY_COUNTRY: Record<string, string> = {
  RUB: 'ru', USD: 'us', EUR: 'eu', GBP: 'gb', CNY: 'cn', JPY: 'jp', CHF: 'ch', TRY: 'tr',
  KZT: 'kz', UAH: 'ua', BYN: 'by', AMD: 'am', GEL: 'ge', AZN: 'az', UZS: 'uz', EGP: 'eg',
};

function CurrencyEmblem({ code }: { code: string }) {
  const country = CURRENCY_COUNTRY[code];
  const [failed, setFailed] = useState(false);
  return country && !failed
    ? <img className="pf-pos__logo" src={`https://cdn.jsdelivr.net/gh/lipis/flag-icons@7.5.0/flags/1x1/${country}.svg`} alt=""
        loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
    : <div className="pf-pos__icon pf-pos__icon--other" aria-hidden="true">{currencySymbol(code).slice(0, 2)}</div>;
}

// Currency balances of a reserve account, as position rows: amount and rate on the left,
// value and result in the base currency on the right.
export default function CurrencyReserveBalances({ summary, display }: {
  summary: PortfolioSummaryItem | undefined;
  display: DollarDisplay;
}) {
  const balances = summary?.currency_balances ?? [];
  if (!balances.length) return <p className="pf-empty">Переведите деньги на этот счёт из банка — валюты появятся здесь.</p>;
  const money = (value: number) => `${formatNumericAmount(display.convert(value), 0)} ${display.symbol}`;
  return (
    <>
      {balances.map((balance) => {
        const result = balance.unrealized_result_in_base;
        return (
          <div className="pf-pos" key={balance.currency_code}>
            <div className="pf-pos__identity">
              <CurrencyEmblem code={balance.currency_code} />
              <div className="pf-pos__copy">
                <div className="pf-pos__title">{currencyName(balance.currency_code)}</div>
                <div className="pf-pos__sub">
                  {formatAmount(balance.amount, balance.currency_code)}
                  {balance.rate !== null && ` · курс ${formatNumericAmount(balance.rate, balance.rate >= 1 ? 2 : 4)} ${currencySymbol(balance.base_currency_code)}`}
                </div>
              </div>
            </div>
            <div className="pf-pos__right">
              {balance.market_value_in_base === null ? (
                <>
                  <div className="pf-pos__amount pf-pos__amount--none">—</div>
                  <div className="pf-pos__sub">нет курса</div>
                </>
              ) : (
                <div className="pf-pos__amount">{money(balance.market_value_in_base)}</div>
              )}
              {result !== null && Math.abs(result) >= 0.5 && (
                <div className={`pf-pos__pnl pf-pos__pnl--${result >= 0 ? 'pos' : 'neg'}`}>
                  {result > 0 ? '+' : '−'}{money(Math.abs(result))}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </>
  );
}
