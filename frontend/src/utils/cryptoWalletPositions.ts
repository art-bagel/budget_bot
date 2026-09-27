import type { PortfolioPosition } from '../types';

// Wallet assets outlive individual acquisition/disposal lots. Identity includes the
// account and canonical asset ID (never merge unrelated contracts by ticker).
export function walletPositions(positions: PortfolioPosition[]): PortfolioPosition[] {
  const result = positions.filter((p) => p.asset_type_code !== 'crypto' && p.status === 'open');
  const groups = new Map<string, PortfolioPosition[]>();
  for (const p of positions.filter((item) => item.asset_type_code === 'crypto')) {
    const asset = p.metadata?.crypto_asset_id;
    const key = `${p.investment_account_id}:${asset ?? `position:${p.id}`}`;
    groups.set(key, [...(groups.get(key) ?? []), p]);
  }
  for (const bucket of groups.values()) {
    const active = bucket.filter((p) => p.status === 'open');
    const representative = active[0] ?? bucket[0];
    result.push({ ...representative, status: 'open', closed_at: null,
      quantity: active.reduce((total, p) => total + Number(p.quantity ?? 0), 0),
      amount_in_currency: active.reduce((total, p) => total + Number(p.amount_in_currency ?? 0), 0),
      metadata: { ...representative.metadata, grouped_position_ids: bucket.map((p) => p.id) },
    });
  }
  return result;
}
