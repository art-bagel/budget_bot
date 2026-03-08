/**
 * Filters input to only allow valid decimal number characters.
 * Returns the sanitized value suitable for amount inputs.
 */
export function sanitizeDecimalInput(value: string): string {
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
