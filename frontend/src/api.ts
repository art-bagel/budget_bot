import type {
  UserContext,
  Category,
  Currency,
  IncomeSource,
  RecordIncomeRequest,
  RecordIncomeResponse,
} from './types';

const API_BASE = '/api/v1';

function getTelegramUserId(): string {
  // Telegram WebApp — будет window.Telegram.WebApp.initDataUnsafe.user.id
  // Локальная разработка — фиксированный тестовый id
  return '1';
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Telegram-User-Id': getTelegramUserId(),
    ...(init?.headers as Record<string, string> || {}),
  };

  const response = await fetch(`${API_BASE}${path}`, { ...init, headers });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `API error: ${response.status}`);
  }
  return response.json();
}

export async function register(baseCurrencyCode: string): Promise<UserContext> {
  return apiFetch<UserContext>('/auth/register', {
    method: 'POST',
    body: JSON.stringify({ base_currency_code: baseCurrencyCode }),
  });
}

export async function fetchCurrencies(): Promise<Currency[]> {
  return apiFetch<Currency[]>('/currencies');
}

export async function fetchCategories(): Promise<Category[]> {
  return apiFetch<Category[]>('/categories');
}

export async function createCategory(name: string, kind: string): Promise<{ id: number }> {
  return apiFetch<{ id: number }>('/categories', {
    method: 'POST',
    body: JSON.stringify({ name, kind }),
  });
}

export async function fetchIncomeSources(): Promise<IncomeSource[]> {
  return apiFetch<IncomeSource[]>('/income-sources');
}

export async function createIncomeSource(name: string): Promise<{ id: number }> {
  return apiFetch<{ id: number }>('/income-sources', {
    method: 'POST',
    body: JSON.stringify({ name }),
  });
}

export async function recordIncome(data: RecordIncomeRequest): Promise<RecordIncomeResponse> {
  return apiFetch<RecordIncomeResponse>('/operations/income', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}
