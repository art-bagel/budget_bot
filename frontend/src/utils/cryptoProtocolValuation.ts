import type { CryptoLivePrice, CryptoProtocolPosition } from '../types';

export type ProtocolValuation = {
  value: number | null;
  reason: string | null;
  quotes: CryptoLivePrice[];
};

/** Historical deposits are not a current snapshot of the LP's underlying reserves. */
export function protocolMarketValue(
  position: CryptoProtocolPosition,
  prices: ReadonlyMap<number, CryptoLivePrice>,
  currency: string,
): ProtocolValuation {
  const unavailable = (reason: string): ProtocolValuation => ({ value: null, reason, quotes: [] });
  if (position.position_type === 'liquidity_pool') {
    return unavailable('Нет актуального состава пула. Количество монет показано по учётной истории, рыночная оценка недоступна.');
  }
  const quotes: CryptoLivePrice[] = [];
  const priceFor = (id: number | null | undefined): number | null => {
    const quote = id == null ? undefined : prices.get(id);
    if (!quote || quote.is_stale || !Number.isFinite(quote.price) || quote.price <= 0
      || quote.vs_currency.toUpperCase() !== currency.toUpperCase()) return null;
    if (!quotes.some((item) => item.crypto_asset_id === quote.crypto_asset_id)) quotes.push(quote);
    return quote.price;
  };
  const quantity = Number(position.current_quantity ?? position.quantity ?? 0);
  const price = quantity === 0 ? 0 : priceFor(position.crypto_asset_id);
  if (price === null) return unavailable('Нет актуальной рыночной цены заложенной или размещённой монеты.');
  let value = quantity * price;
  if (position.position_type === 'lending') {
    const debt = Number(position.metadata.borrowed_quantity ?? 0);
    if (debt > 0) {
      const debtPrice = priceFor(Number(position.metadata.borrowed_crypto_asset_id));
      if (debtPrice === null) return unavailable('Нет актуальной цены монеты долга. Чистая рыночная оценка недоступна.');
      value -= debt * debtPrice;
    }
  }
  return { value, reason: null, quotes };
}

/** Do not label a partially valued group as its total market value. */
export function sumProtocolValues(values: ProtocolValuation[]): number | null {
  return values.some((item) => item.value === null)
    ? null
    : values.reduce((sum, item) => sum + (item.value ?? 0), 0);
}

/** An empty account can retain its history without occupying the open-position list. */
export function isEmptyProtocolPosition(position: CryptoProtocolPosition): boolean {
  const amounts = [position.current_quantity ?? position.quantity, position.cost_basis_in_base,
    position.rewards_unclaimed_in_base, position.metadata.borrowed_quantity, position.metadata.token1_quantity];
  if (position.cost_basis_in_base === null || amounts.some((value) => value != null && Number(value) !== 0)) return false;
  return ![position.metadata.funding_units0, position.metadata.funding_units1].some((units) =>
    units && typeof units === 'object' && Object.values(units).some((value) => Number(value) !== 0));
}
