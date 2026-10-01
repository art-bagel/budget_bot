// Item kinds of a collection account and the text fields each one records.
// The database checks only the kind, an https link and short text values.
type CollectibleKind = { value: string; label: string; fields: { key: string; label: string; placeholder?: string }[] };

export const COLLECTIBLE_KINDS: CollectibleKind[] = [
  {
    value: 'telegram_gift',
    label: 'Подарок Telegram',
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
    fields: [
      { key: 'collection', label: 'Пак' },
      { key: 'number', label: 'Номер' },
    ],
  },
  { value: 'nft', label: 'Другое NFT', fields: [
    { key: 'collection', label: 'Коллекция' }, { key: 'network', label: 'Сеть' },
    { key: 'contract', label: 'Контракт' }, { key: 'token_id', label: 'Token ID' },
  ] },
  {
    value: 'cs2_skin',
    label: 'Скин CS2',
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
    fields: [
      { key: 'category', label: 'Категория', placeholder: 'Монеты, карточки, часы' },
      { key: 'year', label: 'Год' },
      { key: 'condition', label: 'Состояние' },
      { key: 'storage', label: 'Где хранится' },
    ],
  },
  { value: 'other', label: 'Другое', fields: [] },
];

export function getCollectibleKind(value: unknown): CollectibleKind | null {
  return COLLECTIBLE_KINDS.find((kind) => kind.value === value) ?? null;
}

// Filled fields of the item's kind, in form order.
export function collectibleAttributeRows(metadata: Record<string, unknown> | undefined): { label: string; value: string }[] {
  const attributes = (metadata?.item_attributes ?? {}) as Record<string, unknown>;
  return (getCollectibleKind(metadata?.item_kind)?.fields ?? [])
    .filter((field) => typeof attributes[field.key] === 'string' && attributes[field.key])
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
