// Pure helpers for Telegram gifts, kept import-free so node runs their tests.

// The t.me/nft slug of a collection: its name without spaces, dashes and apostrophes ("Durov’s Cap" is DurovsCap).
export function telegramGiftSlug(collection: string): string | null {
  const slug = collection.replace(/[\s’'_-]/g, '');
  return /^[A-Za-z0-9]{1,64}$/.test(slug) ? slug : null;
}

// The gift's public page; null without a usable collection and number.
export function telegramGiftLink(attributes: Record<string, unknown>): string | null {
  const slug = typeof attributes.collection === 'string' ? telegramGiftSlug(attributes.collection.trim()) : null;
  const number = typeof attributes.number === 'string' ? attributes.number.trim() : '';
  return slug && /^\d{1,9}$/.test(number) ? `https://t.me/nft/${slug}-${number}` : null;
}

// Telegram's own naming, "Vice Cream #12323"; a gift without a number is just its collection.
// Without a collection the title stays as it was: older items were named by hand.
export function telegramGiftTitle(attributes: Record<string, unknown>, fallback: string): string {
  const collection = typeof attributes.collection === 'string' ? attributes.collection.trim() : '';
  const number = typeof attributes.number === 'string' ? attributes.number.trim() : '';
  if (!collection) return fallback;
  return number ? `${collection} #${number}` : collection;
}

// Lookup key of a gift, "plushpepe-7"; empty until both parts are usable.
export function telegramGiftKey(collection: string, number: string): string {
  const slug = telegramGiftSlug(collection.trim());
  return slug && /^\d{1,9}$/.test(number.trim()) ? `${slug.toLowerCase()}-${number.trim()}` : '';
}

// Attributes a lookup writes into a form; null is a gift found earlier that is lost again,
// so its traits do not travel to a number that was not found.
export function telegramGiftTraits(
  gift: { collection: string; number: string; model: string | null; backdrop: string | null; symbol: string | null } | null,
): Record<string, string> {
  if (!gift) return { model: '', backdrop: '', symbol: '', upgraded: '' };
  return { collection: gift.collection, number: gift.number, upgraded: 'yes', model: gift.model ?? '', backdrop: gift.backdrop ?? '', symbol: gift.symbol ?? '' };
}
