import type { BankAccount, PortfolioPosition } from '../types';


export function getPositionMetadataNumber(position: PortfolioPosition, key: string): number | null {
  const value = position.metadata?.[key];
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}


export function getPositionMetadataText(position: PortfolioPosition, key: string): string | null {
  const value = position.metadata?.[key];
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized !== '' ? normalized : null;
}


export function getCryptoAssetId(position: PortfolioPosition): number | null {
  return getPositionMetadataNumber(position, 'crypto_asset_id');
}


export function isSameAccountOwner(account: BankAccount, position: PortfolioPosition): boolean {
  return account.owner_type === position.investment_account_owner_type;
}


// Same as isoDate() in ./format, repeated because node --test loads this module
// without a bundler and cannot resolve an extensionless relative import.
export function todayIso(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}


export function formatDraftDecimal(value: number, fractionDigits = 8): string {
  return value.toFixed(fractionDigits).replace(/\.?0+$/, '');
}


/** Exact decimal strings come padded with zeros (24.815282191000); the value stays exact. */
export function trimDecimal(value: string): string {
  return /^[-+]?\d+\.\d+$/.test(value) ? value.replace(/\.?0+$/, '') : value;
}
