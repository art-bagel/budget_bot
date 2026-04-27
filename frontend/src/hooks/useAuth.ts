import { useEffect, useState } from 'react';
import { register } from '../api';
import { hasTelegramContext } from '../telegram';
import type { UserContext } from '../types';

const DEFAULT_BASE_CURRENCY = 'RUB';

export function useAuth() {
  const [user, setUser] = useState<UserContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!hasTelegramContext()) {
      setError('Нет контекста Telegram WebApp. Открой приложение внутри Telegram или укажи VITE_DEV_TELEGRAM_USER_ID для локальной разработки.');
      setLoading(false);
      return;
    }

    const MIN_SPLASH_MS = 2000;
    const start = Date.now();

    register(DEFAULT_BASE_CURRENCY)
      .then(setUser)
      .catch((e: Error) => setError(e.message))
      .finally(() => {
        const elapsed = Date.now() - start;
        const remaining = MIN_SPLASH_MS - elapsed;
        setTimeout(() => setLoading(false), Math.max(0, remaining));
      });
  }, []);

  return { user, loading, error };
}
