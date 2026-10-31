/**
 * Filters input to only allow valid decimal number characters.
 * Returns the sanitized value suitable for amount inputs.
 */
export function sanitizeDecimalInput(value: string, fractionDigits?: number): string {
  // Whole-unit currencies (VND) keep separators as typed: "45.0" may still
  // become "45.000", so normalizeAmountInput resolves them on blur and submit.
  if (fractionDigits === 0) return value.replace(/[^0-9.,]/g, '');
  // Allow digits, one dot or comma as decimal separator
  let sanitized = value.replace(/[^0-9.,]/g, '');
  // Normalize comma to dot
  sanitized = sanitized.replace(',', '.');
  // Allow only one dot
  const parts = sanitized.split('.');
  if (parts.length > 2) {
    sanitized = parts[0] + '.' + parts.slice(1).join('');
  }
  return sanitized;
}

/**
 * Resolves an amount field's text for its currency, or null when ambiguous.
 * Whole-unit currencies: "2.435.060" and "45,000" group thousands with one
 * separator, "45000.00" drops a zero fraction of up to two digits, anything
 * else ("12.5", "1000.000", "1.000000") is refused. Currencies with
 * kopecks keep their text unless it has several separators, which only a
 * whole-unit entry left behind after a currency switch.
 */
export function normalizeAmountInput(text: string, fractionDigits: number): string | null {
  if (fractionDigits > 0) return (text.match(/[.,]/g) ?? []).length > 1 ? null : text.replace(',', '.');
  if (/^\d{1,3}([.,])\d{3}(\1\d{3})*$/.test(text)) return text.replace(/[.,]/g, '');
  return /^(\d+)([.,]0{0,2})?$/.exec(text)?.[1] ?? null;
}

/** Blur fixes a whole-unit entry to plain digits ("45.000" → "45000") before any currency switch. */
export function canonicalAmountInput(text: string, fractionDigits: number | undefined): string {
  return fractionDigits === 0 ? normalizeAmountInput(text, 0) ?? text : text;
}

/**
 * One reading of an amount field for previews, checks and the request.
 * Undefined digits (crypto) keep the plain decimal text.
 */
export function readAmountField(text: string, fractionDigits: number | undefined, currencyCode: string) {
  const normalized = fractionDigits === undefined ? text : normalizeAmountInput(text, fractionDigits);
  let error: string | null = null;
  if (text !== '' && normalized === null && fractionDigits !== undefined) {
    error = fractionDigits === 0
      ? `Сумма в ${currencyCode} — без дробной части, например 45000`
      : 'Проверьте сумму: лишние точки или запятые';
  }
  return { text: normalized, value: parseFloat(normalized ?? ''), error };
}
