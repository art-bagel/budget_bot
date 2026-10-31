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
 * Whole-unit currencies: "2.435.060" and "45,000" group thousands, "45000.00"
 * drops a zero fraction, anything else ("12.5") is refused. Currencies with
 * kopecks keep their text unless it has several separators, which only a
 * whole-unit entry left behind after a currency switch.
 */
export function normalizeAmountInput(text: string, fractionDigits: number): string | null {
  if (fractionDigits > 0) return (text.match(/[.,]/g) ?? []).length > 1 ? null : text.replace(',', '.');
  if (/^\d{1,3}([.,]\d{3})+$/.test(text)) return text.replace(/[.,]/g, '');
  return /^(\d+)([.,]0*)?$/.exec(text)?.[1] ?? null;
}

/** normalizeAmountInput as a number; NaN when the text is ambiguous. */
export function parseAmountInput(text: string, fractionDigits: number): number {
  return parseFloat(normalizeAmountInput(text, fractionDigits) ?? '');
}

