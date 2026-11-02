// Costs of collection items with their fees. No imports: `node --test` loads this file directly.

type CostItem = {
  currency_code: string;
  amount_in_currency: number | string;
  metadata?: Record<string, unknown>;
};

export function positionFeesInBase(item: Pick<CostItem, 'metadata'>): number {
  return Number(item.metadata?.fees_in_base ?? 0) || 0;
}

// Cost per currency; fees are kept in the base currency, so they join the base total
// or stand as their own summand next to a foreign-currency price.
export function collectibleCostTotals(items: CostItem[], baseCurrency: string): [string, number][] {
  const totals = new Map<string, number>();
  for (const item of items) {
    totals.set(item.currency_code, (totals.get(item.currency_code) ?? 0) + Number(item.amount_in_currency));
    const fees = positionFeesInBase(item);
    if (fees) totals.set(baseCurrency, (totals.get(baseCurrency) ?? 0) + fees);
  }
  return [...totals].filter(([, amount]) => amount !== 0);
}

// Different currencies are shown separately; unknown purchases retain their known costs.
export function collectibleCostsLabel(items: CostItem[], baseCurrency: string, format: (amount: number, currency: string) => string): string {
  const totals = collectibleCostTotals(items, baseCurrency);
  const unknown = items.some((item) => item.metadata?.acquisition_kind === 'unknown');
  const free = items.every((item) => item.metadata?.acquisition_kind === 'free');
  const amounts = totals.map(([currency, amount]) => format(amount, currency)).join(' + ');
  if (unknown) return amounts ? `известно ${amounts} · цена неизвестна` : 'цена неизвестна';
  if (free) return amounts ? `бесплатно · затраты ${amounts}` : 'бесплатно';
  return amounts || format(0, items[0]?.currency_code ?? baseCurrency);
}
