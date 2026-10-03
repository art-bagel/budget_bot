import type { PortfolioSummaryItem } from '../types';
import { currencyName, formatAmount, formatNumericAmount } from '../utils/format';
import { currencyReserveResult, portfolioCashValue } from '../utils/currencyReserve';

export default function CurrencyReserveBalances({ summary, baseCurrencyCode }: {
  summary: PortfolioSummaryItem | undefined;
  baseCurrencyCode: string;
}) {
  const balances = summary?.currency_balances ?? [];
  if (!balances.length) return <p className="pf-empty">Переведите деньги на счёт — валюты появятся здесь автоматически.</p>;
  return (
    <div>
      <div className="pf-grp__subhead">
        Сейчас: {formatAmount(portfolioCashValue(summary), baseCurrencyCode)}
        {summary?.cash_valuation_complete === false ? ' · неполная оценка' : ''}
      </div>
      <div className="pf-grp__subhead">
        Себестоимость: {formatAmount(summary?.cash_balance_in_base ?? 0, baseCurrencyCode)}
        {summary?.cash_valuation_complete !== false && ` · Разница: ${formatAmount(currencyReserveResult(summary), baseCurrencyCode)}`}
      </div>
      {balances.map((balance) => (
        <div className="pf-pos" key={balance.currency_code}>
          <div className="pf-pos__identity"><div className="pf-pos__copy">
            <div className="pf-pos__title">{currencyName(balance.currency_code)} · {balance.currency_code}</div>
            <div className="pf-pos__sub">{formatAmount(balance.amount, balance.currency_code)}</div>
            <div className="pf-pos__sub">Себестоимость {formatAmount(balance.historical_cost_in_base, balance.base_currency_code)}</div>
            {balance.rate !== null && <div className="pf-pos__sub">
              1 {balance.currency_code} = {formatNumericAmount(balance.rate, 4)} {balance.base_currency_code}
              {balance.fetched_at && ` · обновлено ${new Date(balance.fetched_at).toLocaleDateString('ru-RU')}`}
            </div>}
          </div></div>
          <div className="pf-pos__right">
            <div className="pf-pos__amount">{balance.market_value_in_base === null
              ? 'Нет курса' : formatAmount(balance.market_value_in_base, balance.base_currency_code)}</div>
            {balance.unrealized_result_in_base !== null && <div className="pf-pos__sub">
              {balance.unrealized_result_in_base > 0 ? '+' : ''}{formatAmount(balance.unrealized_result_in_base, balance.base_currency_code)}
            </div>}
          </div>
        </div>
      ))}
    </div>
  );
}
