// MOEX ISS API — public, no auth required

const ISS_BASE = 'https://iss.moex.com/iss';

export type MoexMarket = 'shares' | 'bonds';

export interface MoexSecurityInfo {
  ticker: string;
  shortName: string;
  name: string;
  isin: string;
  group: string;
  market: MoexMarket;
}

export interface MoexPrice {
  ticker: string;
  last: number | null;       // last trade price (null when market closed)
  prevClose: number | null;  // previous session close
  currency: string;
}

// ISS returns tables as { columns: string[], data: unknown[][] }
function parseIssRows<T extends Record<string, unknown>>(
  table: { columns: string[]; data: unknown[][] },
): T[] {
  return table.data.map((row) => {
    const obj: Record<string, unknown> = {};
    table.columns.forEach((col, i) => { obj[col] = row[i]; });
    return obj as T;
  });
}

function groupToMarket(group: string): MoexMarket | null {
  if (group === 'stock_shares' || group === 'stock_etf' || group === 'stock_ppif') return 'shares';
  if (group === 'stock_bonds') return 'bonds';
  return null;
}

export function groupToSecurityKind(group: string): 'stock' | 'bond' | 'fund' {
  if (group === 'stock_bonds') return 'bond';
  if (group === 'stock_etf' || group === 'stock_ppif') return 'fund';
  return 'stock';
}

export async function searchMoexSecurities(query: string): Promise<MoexSecurityInfo[]> {
  const params = new URLSearchParams({
    q: query,
    is_trading: '1',
    limit: '10',
    'iss.meta': 'off',
    'securities.columns': 'secid,shortname,name,isin,group',
  });
  const res = await fetch(`${ISS_BASE}/securities.json?${params}`);
  if (!res.ok) throw new Error('Ошибка поиска MOEX');
  const json = await res.json() as { securities: { columns: string[]; data: unknown[][] } };

  type Row = { secid: string; shortname: string; name: string; isin: string; group: string };
  const rows = parseIssRows<Row>(json.securities);

  return rows
    .filter((r) => r.secid && groupToMarket(r.group) !== null)
    .map((r) => ({
      ticker: r.secid,
      shortName: r.shortname,
      name: r.name,
      isin: r.isin ?? '',
      group: r.group,
      market: groupToMarket(r.group)!,
    }));
}

// Fetch current prices for a batch of tickers on the same market (1 request)
export async function fetchMoexPrices(
  tickers: string[],
  market: MoexMarket,
): Promise<Map<string, MoexPrice>> {
  if (tickers.length === 0) return new Map();

  const params = new URLSearchParams({
    securities: tickers.join(','),
    'iss.meta': 'off',
    'iss.only': 'marketdata',
    'marketdata.columns': 'SECID,LAST,LCLOSEPRICE,CURRENCYID',
  });
  const url = `${ISS_BASE}/engines/stock/markets/${market}/securities.json?${params}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Ошибка получения котировок MOEX (${market})`);
  const json = await res.json() as { marketdata: { columns: string[]; data: unknown[][] } };

  type Row = { SECID: string; LAST: number | null; LCLOSEPRICE: number | null; CURRENCYID: string };
  const rows = parseIssRows<Row>(json.marketdata);

  const map = new Map<string, MoexPrice>();
  for (const row of rows) {
    if (row.SECID) {
      map.set(row.SECID, {
        ticker: row.SECID,
        last: row.LAST,
        prevClose: row.LCLOSEPRICE,
        currency: row.CURRENCYID ?? 'RUB',
      });
    }
  }
  return map;
}
