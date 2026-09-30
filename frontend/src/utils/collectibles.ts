// Item kinds of a collection account and the text fields each one records.
// The database checks only the kind, an https link and short text values.
export type CollectibleField = { key: string; label: string; placeholder?: string };

export const COLLECTIBLE_KINDS = [
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
] as const satisfies readonly { value: string; label: string; fields: readonly CollectibleField[] }[];

export type CollectibleKind = (typeof COLLECTIBLE_KINDS)[number]['value'];

type CollectibleKindInfo = { value: CollectibleKind; label: string; fields: readonly CollectibleField[] };

export function getCollectibleKind(value: unknown): CollectibleKindInfo | null {
  return COLLECTIBLE_KINDS.find((kind) => kind.value === value) ?? null;
}

// Known fields in form order, then any other stored keys; empty values are skipped.
export function collectibleAttributeRows(metadata: Record<string, unknown> | undefined): { label: string; value: string }[] {
  const raw = metadata?.item_attributes;
  const attributes = (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  const fields = getCollectibleKind(metadata?.item_kind)?.fields ?? [];
  const keys = [...fields.map((field) => field.key), ...Object.keys(attributes).filter((key) => !fields.some((field) => field.key === key))];
  return keys
    .filter((key) => typeof attributes[key] === 'string' && attributes[key])
    .map((key) => ({ label: fields.find((field) => field.key === key)?.label ?? key, value: attributes[key] as string }));
}

// Only https links are rendered as links: anything else could run script in the WebApp.
export function safeItemLink(value: unknown): { href: string; host: string } | null {
  if (typeof value !== 'string' || !/^https:\/\/\S+$/.test(value)) return null;
  try {
    const url = new URL(value);
    return { href: url.href, host: url.host };
  } catch {
    return null;
  }
}
