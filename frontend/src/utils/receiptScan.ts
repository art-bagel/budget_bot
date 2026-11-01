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

/** Σ sign·value, exactly; trailing zeros are trimmed unless keepScale (a total shows cents). */
function sum(values: string[], signs: number[], keepScale = false): string {
  const parsed = values.map(parse);
  const scale = Math.max(0, ...parsed.map((p) => p.scale));
  let units = 0n;
  parsed.forEach((p, index) => {
    units += BigInt(signs[index]) * p.units * 10n ** BigInt(scale - p.scale);
  });
  const negative = units < 0n;
  const digits = (negative ? -units : units).toString().padStart(scale + 1, '0');
  const whole = digits.slice(0, digits.length - scale);
  const fraction = keepScale ? digits.slice(digits.length - scale) : digits.slice(digits.length - scale).replace(/0+$/, '');
  const text = fraction ? `${whole}.${fraction}` : whole;
  return negative && /[1-9]/.test(text) ? `-${text}` : text;
}

function isAmount(value: string): boolean {
  return DECIMAL.test(value.trim());
}

/** Total minus the sum of items: "0" when the receipt adds up. */
export function receiptItemsDiff(total: string, items: Amount[]): string {
  return sum([total, ...items.map((i) => i.amount)], [1, ...items.map(() => -1)]);
}

/** Sum of the rows as they are now (edited, removed, added); rows still being typed are skipped. */
export function receiptRowsTotal(rows: Amount[], minScale = 0): string {
  // A zero of the wanted scale pads the result to it: «300» → «300.00».
  const amounts = [`0${minScale > 0 ? `.${'0'.repeat(minScale)}` : ''}`, ...rows.map((row) => row.amount).filter(isAmount)];
  return sum(amounts, amounts.map(() => 1), true);
}

/** A row amount while typing: at most two decimals, «,5» read as «0.5» (input already sanitized). */
export function rowAmountInput(sanitized: string): string {
  const value = sanitized.startsWith('.') ? `0${sanitized}` : sanitized;
  const [whole, fraction] = value.split('.');
  return fraction === undefined ? value : `${whole}.${fraction.slice(0, 2)}`;
}

/** A finished row amount, as it goes into the comment: no leading zeros, no dangling point. */
export function canonicalRowAmount(value: string): string {
  return value.replace(/\.$/, '').replace(/^0+(?=\d)/, '');
}

/** Every row has a name and a finished amount, so the comment and total can be applied. */
export function receiptRowsReady(rows: NamedAmount[]): boolean {
  return rows.every((row) => row.name_ru.trim() !== '' && isAmount(row.amount));
}

/** What goes into the expense amount: the total if it is above zero. */
export function receiptExpenseAmount(total: string | null): string | null {
  return total !== null && !total.startsWith('-') && /[1-9]/.test(total) ? total : null;
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
