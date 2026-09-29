import { getLendingMetadata, getLiquidityPoolMetadata, type CryptoProtocolPosition } from '../types';

// Логотипы лежат в public/coins/<символ в нижнем регистре, пробелы → _>.<расширение>.
const LOCAL_COIN_ICONS: Record<string, string> = {
  BTC: 'btc.png', CATI: 'cati.png', DOGS: 'dogs.png', ETH: 'eth.png', EVAA: 'evaa.png',
  HGRAM: 'hgram.svg', HMSTR: 'hmstr.png', HPO: 'hpo.svg', HYDRA: 'hydra.png', JETTON: 'jetton.png',
  MAJOR: 'major.png', NOT: 'not.png', 'PT EUSDT': 'pt_eusdt.png', 'PT STGUSD': 'pt_stgusd.png',
  STGRAM: 'stgram.png', STGUSD: 'stgusd.svg', STON: 'ston.png', STXP: 'stxp.png', TGUSD: 'tgusd.svg',
  'TON-SLP': 'ton-slp.png', TON: 'ton.png', TSTON: 'tston.svg', USDC: 'usdc.png', USDT: 'usdt.png',
  'YT STGUSD': 'yt_stgusd.png',
};

const CRYPTO_ICON_URLS: Record<string, string> = {
  TON: 'https://cdn.simpleicons.org/ton/0088CC',
};

const CRYPTO_ICON_CDN_SYMBOLS = new Set([
  'BTC',
  'ETH',
  'USDT',
  'USDC',
  'BNB',
  'SOL',
  'TRX',
  'DOGE',
  'ADA',
  'XRP',
  'DOT',
  'MATIC',
]);

export function normalizeCryptoSymbol(symbol?: string | null): string | null {
  const normalized = symbol?.trim().toUpperCase() ?? '';
  return normalized || null;
}

export function getCryptoIconUrl(
  symbol?: string | null,
  metadata?: Record<string, unknown> | null,
): string | null {
  const metadataIconUrl = metadata?.icon_url;
  if (typeof metadataIconUrl === 'string' && metadataIconUrl.trim()) {
    return metadataIconUrl.trim();
  }

  const normalized = normalizeCryptoSymbol(symbol);
  if (!normalized) return null;
  const local = LOCAL_COIN_ICONS[normalized];
  if (local) return `/coins/${local}`;
  if (CRYPTO_ICON_URLS[normalized]) return CRYPTO_ICON_URLS[normalized];
  if (CRYPTO_ICON_CDN_SYMBOLS.has(normalized)) {
    return `https://cdn.jsdelivr.net/gh/spothq/cryptocurrency-icons@master/svg/color/${normalized.toLowerCase()}.svg`;
  }
  return null;
}


/** Монеты DeFi-позиции (или группы залога): залог/пул, вторая монета пула, долг. До 3 без повторов. */
export function defiCoinSymbols(members: readonly CryptoProtocolPosition[]): string[] {
  const out: string[] = [];
  const add = (symbol?: string | null) => {
    const s = symbol?.trim();
    if (s && !out.some((x) => x.toUpperCase() === s.toUpperCase())) out.push(s);
  };
  for (const p of members) {
    add(p.asset_symbol);
    if (p.position_type === 'liquidity_pool') add(getLiquidityPoolMetadata(p).token1_symbol);
    if (p.position_type === 'lending') {
      const lend = getLendingMetadata(p);
      if ((lend.borrowed_quantity ?? 0) > 0) add(lend.borrowed_asset_symbol);
    }
  }
  return out.slice(0, 3);
}
