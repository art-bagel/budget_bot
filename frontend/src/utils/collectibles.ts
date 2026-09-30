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
