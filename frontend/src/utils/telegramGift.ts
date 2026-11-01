// Pure helpers for Telegram gifts, kept import-free so node runs their tests.

// The t.me/nft slug of a collection: its name without spaces and dashes, Latin letters and digits only.
export function telegramGiftSlug(collection: string): string | null {
  const slug = collection.replace(/[ -]/g, '');
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
