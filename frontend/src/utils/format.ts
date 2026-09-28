const CURRENCY_SYMBOLS: Record<string, string> = {
  RUB: '₽', USD: '$', EUR: '€', GBP: '£',
  CNY: '¥', JPY: '¥', CHF: '₣', TRY: '₺',
  KZT: '₸', UAH: '₴', BYN: 'Br', AMD: '֏',
  GEL: '₾', AZN: '₼', UZS: 'сум',
};

export function currencySymbol(code: string): string {
  return CURRENCY_SYMBOLS[code] ?? code;
}

export function formatNumericAmount(amount: number, maximumFractionDigits = 2): string {
  return new Intl.NumberFormat('ru-RU', {
    maximumFractionDigits,
  }).format(amount);
}

export function formatAmount(amount: number, currencyCode: string): string {
  return formatNumericAmount(amount) + ' ' + currencySymbol(currencyCode);
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
