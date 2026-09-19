import { useCallback, useEffect, useState } from 'react';
import { getUserContext, register } from '../api';
import { hasSession } from '../session';
import { hasTelegramContext } from '../telegram';
import type { UserContext } from '../types';

const DEFAULT_BASE_CURRENCY = 'RUB';
const MIN_SPLASH_MS = 2000;

export function useAuth() {
  const [user, setUser] = useState<UserContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [needsLogin, setNeedsLogin] = useState(false);

  // Тот же самый загрузчик отдаётся наружу как refresh: после входа экран
  // логина просто просит перечитать контекст.
  const load = useCallback(() => {
    // Сессия приоритетнее: пользователь, вошедший по паролю внутри Telegram,
    // должен попадать в свой аккаунт, а не в привязанный к этому telegram id.
    const request = hasSession()
      ? getUserContext()
      : hasTelegramContext()
        ? register(DEFAULT_BASE_CURRENCY)
        : null;

    if (!request) {
      setNeedsLogin(true);
      setLoading(false);
      return;
    }

    setLoading(true);
    setNeedsLogin(false);
    setError(null);

    const start = Date.now();

    request
      .then(setUser)
      .catch((e: Error) => {
        // Сессия могла протухнуть, пока приложение было закрыто: apiFetch уже
        // удалил токен, и это не ошибка, а повод показать экран входа.
        if (!hasSession() && !hasTelegramContext()) {
          setNeedsLogin(true);
        } else {
          setError(e.message);
        }
      })
      .finally(() => {
        const remaining = MIN_SPLASH_MS - (Date.now() - start);
        setTimeout(() => setLoading(false), Math.max(0, remaining));
      });
  }, []);

  useEffect(load, [load]);

  return { user, loading, error, needsLogin, refresh: load };
}
