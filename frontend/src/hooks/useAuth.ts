import { useCallback, useEffect, useState } from 'react';
import { NoAccountError, getUserContext } from '../api';
import { hasSession } from '../session';
import { hasTelegramContext } from '../telegram';
import type { UserContext } from '../types';

const MIN_SPLASH_MS = 2000;

export function useAuth() {
  const [user, setUser] = useState<UserContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [needsLogin, setNeedsLogin] = useState(false);
  const [needsAccount, setNeedsAccount] = useState(false);

  // Тот же загрузчик отдаётся наружу как refresh: после входа или создания
  // аккаунта экран авторизации просто просит перечитать контекст.
  const load = useCallback(() => {
    if (!hasSession() && !hasTelegramContext()) {
      setNeedsLogin(true);
      setNeedsAccount(false);
      setLoading(false);
      return;
    }

    setLoading(true);
    setNeedsLogin(false);
    setNeedsAccount(false);
    setError(null);

    const start = Date.now();

    getUserContext()
      .then(setUser)
      .catch((e: Error) => {
        // Вход валиден, но аккаунта за ним нет — это не ошибка, а развилка:
        // завести новый аккаунт или войти в уже существующий. Раньше здесь
        // молча вызывалась регистрация, из-за чего у пользователя с
        // email-аккаунтом появлялся второй, пустой.
        if (e instanceof NoAccountError) {
          setNeedsAccount(true);
          return;
        }

        // Сессия могла протухнуть, пока приложение было закрыто: apiFetch уже
        // удалил токен, и это повод показать экран входа, а не ошибку.
        if (!hasSession() && !hasTelegramContext()) {
          setNeedsLogin(true);
          return;
        }

        setError(e.message);
      })
      .finally(() => {
        const remaining = MIN_SPLASH_MS - (Date.now() - start);
        setTimeout(() => setLoading(false), Math.max(0, remaining));
      });
  }, []);

  useEffect(load, [load]);

  return { user, loading, error, needsLogin, needsAccount, refresh: load };
}
