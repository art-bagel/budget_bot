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
  if (CRYPTO_ICON_URLS[normalized]) return CRYPTO_ICON_URLS[normalized];
  if (CRYPTO_ICON_CDN_SYMBOLS.has(normalized)) {
    return `https://cdn.jsdelivr.net/gh/spothq/cryptocurrency-icons@master/svg/color/${normalized.toLowerCase()}.svg`;
  }
  return null;
}

