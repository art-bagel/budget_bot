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

    register(DEFAULT_BASE_CURRENCY)
      .then(setUser)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  return { user, loading, error };
}
