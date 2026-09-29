import type { CryptoAsset } from '../types';

function identityLabel(asset: CryptoAsset): string {
  const address = asset.contract_address?.trim();
  if (!address) return 'без адреса';
  if (address.startsWith('service:')) return address.slice('service:'.length);
  return address.length > 22 ? `${address.slice(0, 10)}…${address.slice(-8)}` : address;
}

/** Keep distinct asset IDs distinguishable even when abbreviated addresses collide. */
export function cryptoAssetLabel(asset: CryptoAsset, assets: readonly CryptoAsset[]): string {
  const base = [asset.symbol, cryptoNetworkLabel(asset.network_code)].filter(Boolean).join(' · ');
  const peers = assets.filter((other) => other.symbol === asset.symbol && other.network_code === asset.network_code);
  if (peers.length < 2) return base;
  const identity = identityLabel(asset);
  const collision = peers.filter((other) => identityLabel(other) === identity).length > 1;
  return `${base} · ${identity}${collision ? ` · #${asset.id}` : ''}`;
}

const NETWORK_LABELS: Record<string, string> = {
  ton: 'TON', telegram: 'Telegram', ethereum: 'Ethereum', arbitrum: 'Arbitrum', bitcoin: 'Bitcoin',
  bsc: 'BNB Chain', tron: 'Tron', solana: 'Solana', polygon: 'Polygon',
};

export function cryptoNetworkLabel(code?: string | null): string | null {
  const normalized = code?.trim();
  if (!normalized) return null;
  return NETWORK_LABELS[normalized.toLowerCase()] ?? normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

/** Network is noise when it only repeats the coin symbol (TON · TON). */
export function cryptoNetworkSuffix(code: string | null | undefined, symbol: string | null | undefined): string {
  const label = cryptoNetworkLabel(code);
  const sym = symbol?.trim().toUpperCase();
  const native = sym === 'GRAM' && label?.toUpperCase() === 'TON'; // native coin of the TON network
  return label && label.toUpperCase() !== sym && !native ? ` · ${label}` : '';
}

const PRICE_SOURCE_LABELS: Record<string, string> = { coingecko: 'CoinGecko', tonapi: 'TonAPI' };

export function cryptoPriceSourceLabel(source: string): string {
  const base = source.replace(/_stale$/, '');
  return PRICE_SOURCE_LABELS[base] ?? base;
}

export function cryptoQuoteTime(fetchedAt: string): string {
  return new Date(fetchedAt).toLocaleString('ru-RU', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  });
}
