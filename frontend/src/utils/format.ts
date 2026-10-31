const CURRENCY_SYMBOLS: Record<string, string> = {
  RUB: '₽', USD: '$', EUR: '€', GBP: '£',
  CNY: '¥', JPY: '¥', CHF: '₣', TRY: '₺',
  KZT: '₸', UAH: '₴', BYN: 'Br', AMD: '֏',
  GEL: '₾', AZN: '₼', UZS: 'сум', EGP: 'E£',
  VND: '₫',
};

const CURRENCY_NAME: Record<string, string> = {
  RUB: 'Рубли', USD: 'Доллары', EUR: 'Евро', GBP: 'Фунты',
  CNY: 'Юани', JPY: 'Иены', CHF: 'Франки', TRY: 'Турецкие лиры',
  KZT: 'Тенге', UAH: 'Гривны', BYN: 'Бел. рубли', AMD: 'Драмы',
  GEL: 'Лари', AZN: 'Манаты', UZS: 'Сумы', EGP: 'Египетские фунты',
  VND: 'Донги',
};

export function currencyName(code: string): string {
  return CURRENCY_NAME[code] ?? code;
}

export function currencySymbol(code: string): string {
  return CURRENCY_SYMBOLS[code] ?? code;
}

// ISO 4217 minor units, which match currencies.scale (VND has none). Codes
// Intl rejects, such as USDT, keep the old two digits.
export function currencyFractionDigits(code: string): number {
  try {
    return new Intl.NumberFormat('ru-RU', { style: 'currency', currency: code }).resolvedOptions().maximumFractionDigits ?? 2;
  } catch {
    return 2;
  }
}

export function formatNumericAmount(amount: number, maximumFractionDigits = 2): string {
  // An amount that rounds to zero prints "0", not "-0".
  const value = Math.abs(amount) < 0.5 / 10 ** maximumFractionDigits ? 0 : amount;
  return new Intl.NumberFormat('ru-RU', {
    maximumFractionDigits,
  }).format(value);
}

export function formatAmount(amount: number, currencyCode: string): string {
  return formatNumericAmount(amount, currencyFractionDigits(currencyCode)) + ' ' + currencySymbol(currencyCode);
}

// A ruble in dong is 0.0031: rates below one keep significant digits instead.
export function formatRate(rate: number, fractionDigits: number): string {
  return rate >= 1
    ? formatNumericAmount(rate, fractionDigits)
    : new Intl.NumberFormat('ru-RU', { maximumSignificantDigits: 4 }).format(rate);
}

export function pluralRu(value: number, forms: [string, string, string]): string {
  const absValue = Math.abs(value);
  const mod100 = absValue % 100;
  const mod10 = absValue % 10;
  if (mod100 >= 11 && mod100 <= 14) return forms[2];
  if (mod10 === 1) return forms[0];
  if (mod10 >= 2 && mod10 <= 4) return forms[1];
  return forms[2];
}
