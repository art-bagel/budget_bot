const CURRENCY_SYMBOLS: Record<string, string> = {
  RUB: '₽', USD: '$', EUR: '€', GBP: '£',
  CNY: '¥', JPY: '¥', CHF: '₣', TRY: '₺',
  KZT: '₸', UAH: '₴', BYN: 'Br', AMD: '֏',
  GEL: '₾', AZN: '₼', UZS: 'сум',
};

export function currencySymbol(code: string): string {
  return CURRENCY_SYMBOLS[code] ?? code;
}

export function formatAmount(amount: number, currencyCode: string): string {
  return new Intl.NumberFormat('ru-RU', {
    maximumFractionDigits: 2,
  }).format(amount) + ' ' + currencySymbol(currencyCode);
}
