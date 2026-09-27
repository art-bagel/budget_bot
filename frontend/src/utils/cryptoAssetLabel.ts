import type { CryptoAsset } from '../types';

function identityLabel(asset: CryptoAsset): string {
  const address = asset.contract_address?.trim();
  if (!address) return 'без адреса';
  if (address.startsWith('service:')) return address.slice('service:'.length);
  return address.length > 22 ? `${address.slice(0, 10)}…${address.slice(-8)}` : address;
}

/** Keep distinct asset IDs distinguishable even when abbreviated addresses collide. */
export function cryptoAssetLabel(asset: CryptoAsset, assets: readonly CryptoAsset[]): string {
  const base = [asset.symbol, asset.network_code].filter(Boolean).join(' · ');
  const peers = assets.filter((other) => other.symbol === asset.symbol && other.network_code === asset.network_code);
  if (peers.length < 2) return base;
  const identity = identityLabel(asset);
  const collision = peers.filter((other) => identityLabel(other) === identity).length > 1;
  return `${base} · ${identity}${collision ? ` · #${asset.id}` : ''}`;
}
