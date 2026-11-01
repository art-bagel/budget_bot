// Default currency of collection forms. No imports: `node --test` loads this file directly.
// Select values are a fiat code ('RUB') or a coin of the account ('crypto:<asset id>').

// ponytail: one constant covers today's collections; switch to the coin of the account's
// last purchase if collections paid in other coins appear.
export const DEFAULT_COLLECTIBLE_COIN = 'GRAM';

type Coin = { crypto_asset_id?: number | null; symbol?: string | null; amount?: number };
type Option = { value: string; symbol?: string | null };

const isDefaultCoin = (symbol: string | null | undefined) => symbol?.toUpperCase() === DEFAULT_COLLECTIBLE_COIN;

// Buying an item: the account's GRAM, else its only coin, else the base currency.
export function defaultPurchaseCurrency(coins: Coin[], baseCurrency: string): string {
  const held = coins.filter((coin) => coin.crypto_asset_id && (coin.amount ?? 0) > 0);
  const pick = held.find((coin) => isDefaultCoin(coin.symbol)) ?? (held.length === 1 ? held[0] : undefined);
  return pick ? `crypto:${pick.crypto_asset_id}` : baseCurrency;
}

// Selling, investing in or charging an item: the coin it was bought with, when the form
// offers it; an item received free or at an unknown price starts with GRAM when offered.
export function defaultPositionCurrency(
  position: { currency_code: string; metadata?: Record<string, unknown> },
  options: Option[],
): string {
  const paid = position.metadata?.paid_crypto as { crypto_asset_id?: number } | undefined;
  const paidValue = paid?.crypto_asset_id ? `crypto:${paid.crypto_asset_id}` : null;
  if (paidValue && options.some((option) => option.value === paidValue)) return paidValue;
  const kind = position.metadata?.acquisition_kind;
  const gram = options.find((option) => isDefaultCoin(option.symbol));
  if (!paidValue && (kind === 'free' || kind === 'unknown') && gram) return gram.value;
  return position.currency_code;
}
