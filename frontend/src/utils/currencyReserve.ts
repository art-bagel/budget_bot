import type { PortfolioSummaryItem } from '../types';

// Keep historical cost separate from the (possibly incomplete) current valuation.
export function portfolioCashValue(summary: PortfolioSummaryItem | undefined): number {
  return summary?.cash_market_value_in_base ?? summary?.cash_balance_in_base ?? 0;
}

export function currencyReserveResult(summary: PortfolioSummaryItem | undefined): number {
  return summary?.investment_asset_type === 'currency' && summary.cash_valuation_complete !== false
    ? portfolioCashValue(summary) - summary.cash_balance_in_base
    : 0;
}
