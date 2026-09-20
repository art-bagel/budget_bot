import { useCallback, useEffect, useState } from 'react';
import {
  linkTelegram,
  listAuthMethods,
  listSessions,
  logOut,
  revokeSession,
  setPassword,
} from '../api';
import { IconKey, IconShield } from './Icons';
import { hasTelegramContext } from '../telegram';
import type { AuthMethod, SessionInfo } from '../types';

interface Props {
  /** Вызывается после выхода, чтобы приложение вернулось к экрану входа. */
  onSignedOut: () => void;
}

const MIN_PASSWORD_LENGTH = 10;

function formatMoment(value: string): string {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return '—';
  }

  return date.toLocaleString('ru-RU', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function SecuritySection({ onSignedOut }: Props) {
  const [methods, setMethods] = useState<AuthMethod[]>([]);
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [passwordFormOpen, setPasswordFormOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');

  const passwordMethod = methods.find((method) => method.provider === 'password');
  const telegramMethod = methods.find((method) => method.provider === 'telegram');

  const load = useCallback(async () => {
    try {
      const [loadedMethods, loadedSessions] = await Promise.all([listAuthMethods(), listSessions()]);
      setMethods(loadedMethods);
      setSessions(loadedSessions);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const run = async (action: () => Promise<void>, successNotice: string) => {
    if (busy) {
      return;
    }

    setBusy(true);
    setError(null);
    setNotice(null);

    try {
      await action();
      setNotice(successNotice);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleSavePassword = () => run(async () => {
    await setPassword(email.trim(), newPassword, currentPassword || undefined);
    setPasswordFormOpen(false);
    setNewPassword('');
    setCurrentPassword('');
  }, passwordMethod ? 'Пароль изменён, остальные устройства отключены' : 'Вход по email добавлен');

  const handleLinkTelegram = () => run(
    () => linkTelegram().then(() => undefined),
    'Telegram привязан к аккаунту',
  );

  const handleRevoke = (sessionId: string) => run(
    () => revokeSession(sessionId).then(() => undefined),
    'Устройство отключено',
  );

  const handleSignOut = async () => {
    if (busy) {
      return;
    }

    setBusy(true);

    try {
      await logOut();
      onSignedOut();
    } finally {
      setBusy(false);
    }
  };

  const canSavePassword = Boolean(email.trim())
    && newPassword.length >= MIN_PASSWORD_LENGTH
    && (!passwordMethod || Boolean(currentPassword));

  return (
    <>
      <section className="st-card-sec">
        <header className="st-card-sec__head">
          <div className="st-card-sec__title-row">
            <span className="st-card-sec__ico"><IconKey /></span>
            <div className="st-card-sec__title-meta">
              <h3 className="st-card-sec__title">Способы входа</h3>
              <span className="st-card-sec__sub">Все ведут в один и тот же аккаунт</span>
            </div>
          </div>
        </header>

        <ul className="rows">
          <li className="row">
            <div className="row__main">
              <div className="row__title">Telegram</div>
              <div className="row__sub">
                {telegramMethod ? `ID ${telegramMethod.provider_uid}` : 'Не привязан'}
              </div>
            </div>
            {telegramMethod
              ? <span className="st-tag">Привязан</span>
              : hasTelegramContext()
                ? (
                  <button className="st-btn" type="button" onClick={handleLinkTelegram} disabled={busy}>
                    Привязать
                  </button>
                )
                : <span className="row__sub">Откройте в Telegram</span>}
          </li>

          <li className="row">
            <div className="row__main">
              <div className="row__title">Email и пароль</div>
              <div className="row__sub">
                {passwordMethod ? passwordMethod.provider_uid : 'Не настроен'}
              </div>
            </div>
            <button
              className="st-btn"
              type="button"
              onClick={() => {
                setPasswordFormOpen((open) => !open);
                setEmail(passwordMethod?.provider_uid ?? '');
                setNotice(null);
              }}
              disabled={busy}
            >
              {passwordFormOpen ? 'Отмена' : passwordMethod ? 'Сменить пароль' : 'Добавить'}
            </button>
          </li>
        </ul>

        {passwordFormOpen && (
          <div className="field field--col">
            <input
              className="input"
              type="email"
              inputMode="email"
              autoComplete="username"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            {passwordMethod && (
              <input
                className="input"
                type="password"
                autoComplete="current-password"
                placeholder="Текущий пароль"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
              />
            )}
            <input
              className="input"
              type="password"
              autoComplete="new-password"
              placeholder={`Новый пароль, минимум ${MIN_PASSWORD_LENGTH} символов`}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
            <button
              className="st-btn st-btn--primary"
              type="button"
              onClick={handleSavePassword}
              disabled={!canSavePassword || busy}
            >
              Сохранить
            </button>
            {passwordMethod && (
              <div className="row__sub">Смена пароля отключит все остальные устройства.</div>
            )}
          </div>
        )}
      </section>

      <section className="st-card-sec">
        <header className="st-card-sec__head">
          <div className="st-card-sec__title-row">
            <span className="st-card-sec__ico"><IconShield /></span>
            <div className="st-card-sec__title-meta">
              <h3 className="st-card-sec__title">Входы и устройства</h3>
              <span className="st-card-sec__sub">
                {sessions.length ? `Активных сессий: ${sessions.length}` : 'Активных сессий нет'}
              </span>
            </div>
          </div>
        </header>

        <ul className="rows">
          {sessions.map((session) => (
            <li className="row" key={session.session_id}>
              <div className="row__main">
                <div className="row__title">
                  {session.device || 'Неизвестное устройство'}
                  {session.is_current && ' · это устройство'}
                </div>
                <div className="row__sub">
                  Последний вход {formatMoment(session.last_seen_at)} · до {formatMoment(session.expires_at)}
                </div>
              </div>
              {!session.is_current && (
                <button
                  className="st-btn st-btn--danger"
                  type="button"
                  onClick={() => handleRevoke(session.session_id)}
                  disabled={busy}
                >
                  Отключить
                </button>
              )}
            </li>
          ))}
          {!sessions.length && (
            <li className="row">
              <div className="row__main">
                <div className="row__sub">
                  Вход выполнен через Telegram — отдельная сессия не создаётся.
                </div>
              </div>
            </li>
          )}
        </ul>

        {error && <div className="form-error">{error}</div>}
        {notice && <div className="row__sub">{notice}</div>}

        {sessions.some((session) => session.is_current) && (
          <div className="field field--col">
            <button className="st-btn" type="button" onClick={handleSignOut} disabled={busy}>
              Выйти из аккаунта
            </button>
          </div>
        )}
      </section>
    </>
  );
}
