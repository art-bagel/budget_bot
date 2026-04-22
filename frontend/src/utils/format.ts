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
