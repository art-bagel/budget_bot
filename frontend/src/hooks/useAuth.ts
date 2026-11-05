import { useCallback, useEffect, useState } from 'react';
import { NoAccountError, getUserContext, isAuthError } from '../api';
import { hasSession } from '../session';
import { type Ticket, cacheIdentity, clearStart, newTicket, readStart } from '../startCache';
import { getTelegramUserId, hasTelegramContext } from '../telegram';
import type { UserContext } from '../types';

// One request for the user context. The ticket is taken before it is sent,
// so a wipe while it is in flight leaves the ticket stale (startCache.ts).
type Attempt = { identity: string | null; ticket: Ticket | null; cachedUserId: number | null };

export function useAuth() {
  const [user, setUser] = useState<UserContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [needsLogin, setNeedsLogin] = useState(false);
  const [needsAccount, setNeedsAccount] = useState(false);
  // Set once the context came from the server: only then may the overview
  // be written to the start cache.
  const [cacheTicket, setCacheTicket] = useState<Ticket | null>(null);
  // The context failed for a network reason or 5xx while the snapshot is on
  // screen: the snapshot stays, the overview shows the error.
  const [contextError, setContextError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState<Attempt | null>(null);

  const fetchContext = useCallback((current: Attempt) => {
    setContextError(null);

    getUserContext()
      .then((fresh) => {
        let ticket = current.ticket;
        if (current.cachedUserId !== null && fresh.user_id !== current.cachedUserId) {
          // Someone else behind the same login: drop their snapshot first,
          // then take a ticket for the new user.
          clearStart();
          ticket = newTicket(current.identity);
        }
        setUser(fresh);
        setCacheTicket(ticket);
      })
      .catch((e: Error) => {
        if (e instanceof NoAccountError || isAuthError(e)) {
          clearStart();
        }

        // Вход валиден, но аккаунта за ним нет — это не ошибка, а развилка:
        // завести новый аккаунт или войти в уже существующий. Раньше здесь
        // молча вызывалась регистрация, из-за чего у пользователя с
        // email-аккаунтом появлялся второй, пустой.
        if (e instanceof NoAccountError) {
          setUser(null);
          setNeedsAccount(true);
          return;
        }

        // Сессия могла протухнуть, пока приложение было закрыто: apiFetch уже
        // удалил токен, и это повод показать экран входа, а не ошибку.
        if (!hasSession() && !hasTelegramContext()) {
          setUser(null);
          setNeedsLogin(true);
          return;
        }

        if (current.cachedUserId !== null && !isAuthError(e)) {
          setContextError(e.message);
          return;
        }

        setUser(null);
        setError(e.message);
      })
      .finally(() => setLoading(false));
  }, []);

  // Тот же загрузчик отдаётся наружу как refresh: после входа или создания
  // аккаунта экран авторизации просто просит перечитать контекст. Снимок
  // обзора берётся только при запуске: после смены входа его уже стёр
  // setSessionToken.
  const load = useCallback((fromCache: boolean) => {
    setCacheTicket(null);
    setContextError(null);

    if (!hasSession() && !hasTelegramContext()) {
      setNeedsLogin(true);
      setNeedsAccount(false);
      setLoading(false);
      return;
    }

    setNeedsLogin(false);
    setNeedsAccount(false);
    setError(null);

    const identity = cacheIdentity(hasSession(), getTelegramUserId());
    const start = fromCache ? readStart(identity) : null;
    const current: Attempt = {
      identity,
      ticket: start?.ticket ?? newTicket(identity),
      cachedUserId: start?.user.user_id ?? null,
    };

    if (start) {
      setUser(start.user);
      setLoading(false);
    } else {
      setLoading(true);
    }

    setAttempt(current);
    fetchContext(current);
  }, [fetchContext]);

  useEffect(() => load(true), [load]);

  const refresh = useCallback(() => load(false), [load]);
  const retryContext = useCallback(() => {
    if (attempt && contextError) fetchContext(attempt);
  }, [attempt, contextError, fetchContext]);

  return { user, loading, error, needsLogin, needsAccount, refresh, cacheTicket, contextError, retryContext };
}
