/**
 * Хранение сессионного токена на клиенте.
 *
 * В вебе это localStorage. В нативной обёртке место хранения другое
 * (Keychain), поэтому весь доступ к токену идёт через эти функции —
 * заменить хранилище потом можно в одном месте.
 */

import { clearStart } from './startCache';

const TOKEN_KEY = 'budget_session_token';

let cachedToken: string | null | undefined;

export function getSessionToken(): string | null {
  if (cachedToken !== undefined) {
    return cachedToken;
  }

  try {
    cachedToken = localStorage.getItem(TOKEN_KEY);
  } catch {
    // Приватный режим или заблокированные куки — работаем без сохранения.
    cachedToken = null;
  }

  return cachedToken;
}

export function setSessionToken(token: string | null): void {
  // Login, logout and a 401 all land here: the overview snapshot of the
  // previous login must not outlive it.
  clearStart();
  cachedToken = token;

  try {
    if (token) {
      localStorage.setItem(TOKEN_KEY, token);
    } else {
      localStorage.removeItem(TOKEN_KEY);
    }
  } catch {
    // Сессия проживёт до перезагрузки страницы — это лучше, чем падение.
  }
}

export function hasSession(): boolean {
  return Boolean(getSessionToken());
}
