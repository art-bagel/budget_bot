// Pure helpers for the receipt sheet. Amounts arrive from the API as exact
// decimal strings ("54.90", "-10", "1250000") and are added as BigInt, never
// as floats, so a rounding difference on the receipt is shown as it is.

interface Amount {
  amount: string;
}

interface NamedAmount extends Amount {
  name_ru: string;
}

const DECIMAL = /^(-?)(\d+)(?:\.(\d+))?$/;
const COMMENT_LIMIT = 1000;
const SEPARATOR = ' · ';

function parse(value: string): { units: bigint; scale: number } {
  const match = DECIMAL.exec(value.trim());
  if (!match) throw new Error(`Not a decimal amount: ${value}`);
  const [, sign, whole, fraction = ''] = match;
  return { units: BigInt(sign + whole + fraction), scale: fraction.length };
}

/** a + Σ sign·b over the values, exactly, as a plain decimal without trailing zeros. */
function sum(values: string[], signs: number[]): string {
  const parsed = values.map(parse);
  const scale = Math.max(0, ...parsed.map((p) => p.scale));
  let units = 0n;
  parsed.forEach((p, index) => {
    units += BigInt(signs[index]) * p.units * 10n ** BigInt(scale - p.scale);
  });
  const negative = units < 0n;
  const digits = (negative ? -units : units).toString().padStart(scale + 1, '0');
  const whole = digits.slice(0, digits.length - scale);
  const fraction = digits.slice(digits.length - scale).replace(/0+$/, '');
  const text = fraction ? `${whole}.${fraction}` : whole;
  return negative && text !== '0' ? `-${text}` : text;
}

/** Total minus the sum of items: "0" when the receipt adds up. */
export function receiptItemsDiff(total: string, items: Amount[]): string {
  return sum([total, ...items.map((i) => i.amount)], [1, ...items.map(() => -1)]);
}

/** What goes into the expense amount: the total minus removed rows, or null when there is nothing to fill. */
export function receiptExpenseAmount(total: string | null, removed: Amount[]): string | null {
  if (total === null) return null;
  if (removed.length === 0) return total;
  const rest = receiptItemsDiff(total, removed);
  return rest.startsWith('-') || rest === '0' ? null : rest;
}

/** 1250000 → "1 250 000", -10 → "−10", 54.90 → "54,90" (digits as printed). */
export function displayReceiptAmount(value: string): string {
  const match = DECIMAL.exec(value.trim());
  if (!match) return value;
  const [, sign, whole, fraction] = match;
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${sign ? '−' : ''}${grouped}${fraction ? `,${fraction}` : ''}`;
}

/** "Лавка: Хлеб 54,90; Молоко 89,9", cut on a whole item to fit 1000 characters. */
export function buildReceiptComment(merchant: string | null, items: NamedAmount[]): string {
  if (items.length === 0) return '';
  const prefix = merchant ? `${merchant}: ` : '';
  const parts = items.map((item) => `${item.name_ru} ${displayReceiptAmount(item.amount)}`);
  const full = prefix + parts.join('; ');
  if (full.length <= COMMENT_LIMIT) return full;

  let kept = prefix;
  for (const [index, part] of parts.entries()) {
    const next = kept + (index === 0 ? '' : '; ') + part;
    if (next.length + '; …'.length > COMMENT_LIMIT) break;
    kept = next;
  }
  return `${kept}; …`;
}

/** Puts the receipt block into the comment, replacing the one inserted before and keeping the user's own text. */
export function replaceReceiptBlock(comment: string, previousBlock: string | null, nextBlock: string): string {
  let base = comment.trim();
  if (previousBlock && base.includes(previousBlock)) {
    // The block may sit between the user's own parts: rejoin them with one separator.
    base = base
      .replace(previousBlock, '')
      .split(/\s*·\s*/)
      .filter((part) => part.trim() !== '')
      .join(SEPARATOR);
  }
  if (!nextBlock) return base;
  return base ? `${base}${SEPARATOR}${nextBlock}` : nextBlock;
}

/** The receipt date if it is not in the future and not older than 31 days; null keeps the form's date. */
export function receiptDateForExpense(date: string | null, todayLocal: string): string | null {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date) || date > todayLocal) return null;
  const earliest = new Date(`${todayLocal}T00:00:00Z`);
  earliest.setUTCDate(earliest.getUTCDate() - 31);
  return date >= earliest.toISOString().slice(0, 10) ? date : null;
}

/** Local calendar date as YYYY-MM-DD (toISOString would give the UTC date). */
export function localToday(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}
