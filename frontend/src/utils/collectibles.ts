// Item kinds of a collection account and the text fields each one records.
// The database checks only the kind, an https link and short text values.
// A `flag` field is a checkbox stored as 'yes' or omitted.
type CollectibleField = { key: string; label: string; placeholder?: string; flag?: boolean };
type CollectibleKind = { value: string; label: string; plural: string; fields: CollectibleField[] };

export const COLLECTIBLE_KINDS: CollectibleKind[] = [
  {
    value: 'telegram_gift',
    label: 'Подарок Telegram',
    plural: 'Подарки',
    fields: [
      { key: 'collection', label: 'Коллекция', placeholder: 'Plush Pepe' },
      { key: 'model', label: 'Модель' },
      { key: 'backdrop', label: 'Фон' },
      { key: 'symbol', label: 'Узор' },
      { key: 'number', label: 'Номер', placeholder: '1234' },
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

// Prefer a canonical item link to guessing names with punctuation or aliases.
export function collectibleImageUrl(metadata: Record<string, unknown> | undefined): string | null {
  const explicit = safeItemLink(metadata?.image_url);
  if (explicit && !explicit.username && !explicit.password) return explicit.href;
  const link = safeItemLink(metadata?.item_link);
  if (link && ['t.me', 'telegram.me'].includes(link.hostname)) {
    const match = link.pathname.match(/^\/nft\/([a-zA-Z0-9]+-\d+)\/?$/);
    if (match) return `https://nft.fragment.com/gift/${match[1].toLowerCase()}.medium.jpg`;
  }
  const attrs = metadata?.item_attributes as Record<string, unknown> | undefined;
  if (metadata?.item_kind === 'telegram_gift' && typeof attrs?.collection === 'string' && /^\d+$/.test(String(attrs.number ?? ''))) {
    const slug = attrs.collection.replace(/[ -]/g, '').toLowerCase();
    if (/^[a-z0-9]+$/.test(slug)) return `https://nft.fragment.com/gift/${slug}-${attrs.number}.medium.jpg`;
  }
  return null;
}

function attributes(metadata: Record<string, unknown> | undefined): Record<string, unknown> {
  return (metadata?.item_attributes ?? {}) as Record<string, unknown>;
}

export function isSealedPack(metadata: Record<string, unknown> | undefined): boolean {
  return metadata?.item_kind === 'sticker' && attributes(metadata).sealed === 'yes';
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

// Telegram writes trait rarity into the value: "Bronze (3%)".
export function splitRarity(value: string): { name: string; rarity: string | null } {
  const match = value.match(/^(.*\S)\s*\((\d+(?:[.,]\d+)?\s*%)\)$/);
  return match ? { name: match[1], rarity: match[2].replace(/\s/g, '') } : { name: value, rarity: null };
}
