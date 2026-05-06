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


export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}


export function formatDraftDecimal(value: number, fractionDigits = 8): string {
  return value.toFixed(fractionDigits).replace(/\.?0+$/, '');
}
