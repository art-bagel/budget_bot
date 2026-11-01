import type { PortfolioPosition } from '../types';
import giftOriginals from '../data/telegramGiftOriginals.json';
import { currencySymbol, formatNumericAmount } from './format';
import { telegramGiftSlug } from './telegramGift';
import { collectibleCostsLabel as costsLabelWithFees } from './collectibleCosts';

export { collectibleFeesInBase } from './collectibleCosts';

const normalizedGiftName = (name: string) => name.toLowerCase().replace(/[\s’'_-]/g, '');
const giftOriginalIds = new Map(giftOriginals.flatMap((gift) =>
  [gift.id, gift.name, ...gift.aliases].filter(Boolean).map((name) => [normalizedGiftName(name), gift.id] as const)));

// Item kinds of a collection account and the text fields each one records.
// The database checks only the kind, an https link and short text values.
// A `flag` field is a checkbox stored as 'yes' or 'no'; see collectibleFlag for a missing value.
type CollectibleField = { key: string; label: string; placeholder?: string; flag?: boolean };
type CollectibleKind = { value: string; label: string; plural: string; fields: CollectibleField[] };

export const COLLECTIBLE_KINDS: CollectibleKind[] = [
  {
    value: 'telegram_gift',
    label: 'Подарок Telegram',
    plural: 'Подарки',
    fields: [
      { key: 'collection', label: 'Коллекция', placeholder: 'Plush Pepe' },
      { key: 'number', label: 'Номер', placeholder: '1234' },
      { key: 'model', label: 'Модель' },
      { key: 'backdrop', label: 'Фон' },
      { key: 'symbol', label: 'Узор' },
      { key: 'upgraded', label: 'Улучшенный', flag: true },
      { key: 'nft', label: 'Выпущен как NFT', flag: true },
    ],
  },
  {
    value: 'sticker',
    label: 'Стикер',
    plural: 'Стикеры',
    fields: [
      { key: 'collection', label: 'Коллекция' },
      { key: 'number', label: 'Номер' },
      // A bought pack whose sticker is not revealed yet.
      { key: 'sealed', label: 'Пак ещё не открыт', flag: true },
      { key: 'nft', label: 'Выпущен как NFT', flag: true },
    ],
  },
  { value: 'nft', label: 'Другое NFT', plural: 'NFT', fields: [
    { key: 'collection', label: 'Коллекция' }, { key: 'network', label: 'Сеть' },
    { key: 'contract', label: 'Контракт' }, { key: 'token_id', label: 'Token ID' },
  ] },
  {
    value: 'cs2_skin',
    label: 'Скин CS2',
    plural: 'Скины',
    fields: [
      { key: 'weapon', label: 'Оружие', placeholder: 'AK-47' },
      { key: 'skin', label: 'Скин', placeholder: 'Redline' },
      { key: 'wear', label: 'Износ', placeholder: 'Field-Tested · 0.18' },
      { key: 'pattern', label: 'Паттерн' },
      { key: 'quality', label: 'Качество', placeholder: 'StatTrak™, Souvenir' },
      { key: 'stickers', label: 'Наклейки' },
    ],
  },
  {
    value: 'physical',
    label: 'Физический предмет',
    plural: 'Предметы',
    fields: [
      { key: 'category', label: 'Категория', placeholder: 'Монеты, карточки, часы' },
      { key: 'year', label: 'Год' },
      { key: 'condition', label: 'Состояние' },
      { key: 'storage', label: 'Где хранится' },
    ],
  },
  { value: 'other', label: 'Другое', plural: 'Другое', fields: [] },
];

export function getCollectibleKind(value: unknown): CollectibleKind | null {
  return COLLECTIBLE_KINDS.find((kind) => kind.value === value) ?? null;
}

// Filled fields of the item's kind, in form order.
export function collectibleAttributeRows(metadata: Record<string, unknown> | undefined): { label: string; value: string }[] {
  const attributes = (metadata?.item_attributes ?? {}) as Record<string, unknown>;
  return (getCollectibleKind(metadata?.item_kind)?.fields ?? [])
    .filter((field) => !field.flag && typeof attributes[field.key] === 'string' && attributes[field.key])
    .map((field) => ({ label: field.label, value: attributes[field.key] as string }));
}

// Only https links are rendered as links: anything else could run script in the WebApp.
export function safeItemLink(value: unknown): URL | null {
  if (typeof value !== 'string' || !/^https:\/\/\S+$/.test(value)) return null;
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

// Candidate pictures, best first; the component falls through on a load error.
// Fragment's 640px render beats the 160px preview t.me pages carry, so a stored preview
// is only a fallback for collections fragment does not list (yet).
export function collectibleImageUrls(metadata: Record<string, unknown> | undefined): string[] {
  const urls: string[] = [];
  const explicit = safeItemLink(metadata?.image_url);
  const preview = explicit?.hostname.endsWith('.telesco.pe') ?? false;
  if (explicit && !explicit.username && !explicit.password && !preview) urls.push(explicit.href);
  // Prefer a canonical item link to guessing names with punctuation or aliases.
  const link = safeItemLink(metadata?.item_link);
  const linked = link && ['t.me', 'telegram.me'].includes(link.hostname) ? link.pathname.match(/^\/nft\/([a-zA-Z0-9]+-\d+)\/?$/) : null;
  const attrs = metadata?.item_attributes as Record<string, unknown> | undefined;
  if (linked) {
    urls.push(`https://nft.fragment.com/gift/${linked[1].toLowerCase()}.large.jpg`);
  } else if (isPlainGift(metadata) && typeof attrs?.collection === 'string') {
    const id = giftOriginalIds.get(normalizedGiftName(attrs.collection));
    if (id) urls.push(`/gifts/originals/${id}.webp`);
  } else if (metadata?.item_kind === 'telegram_gift' && typeof attrs?.collection === 'string' && /^\d+$/.test(String(attrs.number ?? ''))) {
    const slug = telegramGiftSlug(attrs.collection);
    if (slug) urls.push(`https://nft.fragment.com/gift/${slug.toLowerCase()}-${attrs.number}.large.jpg`);
  }
  if (explicit && preview) urls.push(explicit.href);
  return urls;
}

function attributes(metadata: Record<string, unknown> | undefined): Record<string, unknown> {
  return (metadata?.item_attributes ?? {}) as Record<string, unknown>;
}

// A gift recorded before the `upgraded` flag existed counts as upgraded when it has a number:
// only upgraded gifts were imported with one.
export function collectibleFlag(metadata: Record<string, unknown> | undefined, key: string): boolean {
  const value = attributes(metadata)[key];
  if (key === 'upgraded' && value === undefined) return metadata?.item_kind === 'telegram_gift' && collectibleNumber(metadata) !== null;
  return value === 'yes';
}

export function isSealedPack(metadata: Record<string, unknown> | undefined): boolean {
  return metadata?.item_kind === 'sticker' && collectibleFlag(metadata, 'sealed');
}

export function isPlainGift(metadata: Record<string, unknown> | undefined): boolean {
  return metadata?.item_kind === 'telegram_gift' && !collectibleFlag(metadata, 'upgraded');
}

// The shelf an item sits on: its collection, or the closest thing its kind records.
export function collectibleShelf(metadata: Record<string, unknown> | undefined, title: string): string {
  const attrs = attributes(metadata);
  const name = [attrs.collection, attrs.category, attrs.weapon].find((value) => typeof value === 'string' && value.trim());
  return typeof name === 'string' ? name.trim() : title;
}

export function collectibleNumber(metadata: Record<string, unknown> | undefined): string | null {
  const number = attributes(metadata).number;
  return typeof number === 'string' && number.trim() ? number.trim() : null;
}

// Telegram writes trait rarity into the value: "Bronze (3%)", or typed by hand as "Bronze 3%".
export function splitRarity(value: string): { name: string; percent: number | null } {
  const match = value.match(/^(.*\S)\s+\(?(\d+(?:[.,]\d+)?)\s*%\)?$/);
  const percent = match ? Number(match[2].replace(',', '.')) : Number.NaN;
  return match && percent > 0 && percent <= 100 ? { name: match[1], percent } : { name: value, percent: null };
}

// Colour tier of a rarity: only a visual cue next to the percent.
export function rarityTier(percent: number): 'common' | 'rare' | 'epic' | 'legendary' {
  return percent <= 0.1 ? 'legendary' : percent <= 0.5 ? 'epic' : percent <= 2 ? 'rare' : 'common';
}

// Keep payment proceeds separate from the historical cost carried into received coins.
export function collectibleSaleLabel(position: PortfolioPosition): string {
  const coins = position.metadata?.sold_for_crypto as { quantity?: string; symbol?: string } | undefined;
  if (coins?.quantity && coins.symbol) return `${formatNumericAmount(Number(coins.quantity), 8)} ${coins.symbol}`;
  return position.close_amount_in_currency != null && position.close_currency_code
    ? `${formatNumericAmount(position.close_amount_in_currency)} ${currencySymbol(position.close_currency_code)}` : '—';
}

export function collectibleUnits(items: PortfolioPosition[]): number {
  return items.reduce((sum, item) => sum + Number(item.quantity ?? 1), 0);
}

// Costs with fees, per currency; see collectibleCosts.ts for the rules.
export function collectibleCostsLabel(items: PortfolioPosition[], baseCurrency: string): string {
  return costsLabelWithFees(items, baseCurrency, (amount, currency) => `${formatNumericAmount(amount)} ${currencySymbol(currency)}`);
}
