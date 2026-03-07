import type { UserContext } from './types';

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
