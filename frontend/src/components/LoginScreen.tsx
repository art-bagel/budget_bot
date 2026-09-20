import { useState } from 'react';
import { linkTelegram, logIn, register, signUp } from '../api';
import logo from '../assets/logo.png';
import { getTelegramInitData, hasTelegramContext } from '../telegram';

interface Props {
  /** 'choice' — вход из Telegram, но аккаунта за ним ещё нет. */
  initialMode: 'choice' | 'login';
  onAuthenticated: () => void;
}

type Mode = 'choice' | 'login' | 'signup';

const DEFAULT_BASE_CURRENCY = 'RUB';
const MIN_PASSWORD_LENGTH = 10;

export default function LoginScreen({ initialMode, onAuthenticated }: Props) {
  const [mode, setMode] = useState<Mode>(initialMode);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const inTelegram = hasTelegramContext();
  const isSignup = mode === 'signup';

  const run = async (action: () => Promise<unknown>) => {
    if (busy) {
      return;
    }

    setBusy(true);
    setError(null);

    try {
      await action();
      onAuthenticated();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  const switchTo = (next: Mode) => {
    setMode(next);
    setError(null);
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();

    const canSubmit = Boolean(email.trim())
      && password.length >= (isSignup ? MIN_PASSWORD_LENGTH : 1)
      && (!isSignup || Boolean(inviteCode.trim()));

    if (!canSubmit) {
      return;
    }

    return run(async () => {
      const device = navigator.platform || undefined;

      if (isSignup) {
        await signUp(email.trim(), password, DEFAULT_BASE_CURRENCY, inviteCode.trim(), device);
      } else {
        await logIn(email.trim(), password, device);
      }

      // Вход из Telegram в существующий аккаунт означает "пусть этот Telegram
      // тоже открывает его" — иначе пользователь упирался бы в тот же экран
      // при каждом запуске. Оба доказательства уже на руках: пароль и initData.
      if (getTelegramInitData()) {
        await linkTelegram().catch(() => {
          // Этот Telegram уже занят другим аккаунтом — вход всё равно состоялся.
        });
      }
    });
  };

  const brand = (
    <div className="auth__brand">
      <img src={logo} alt="" className="auth__logo" />
      <div className="auth__name">Budget Bot</div>
    </div>
  );

  if (mode === 'choice') {
    return (
      <div className="auth">
        {brand}

        <div className="auth__card">
          <h1 className="auth__title">Аккаунта ещё нет</h1>
          <p className="auth__sub">За этим Telegram аккаунт не заведён.</p>

          {error && <div className="apf-error">{error}</div>}

          <div className="auth__actions">
            <button
              className="apf-submit"
              type="button"
              onClick={() => run(() => register(DEFAULT_BASE_CURRENCY))}
              disabled={busy}
            >
              {busy ? 'Создаём…' : 'Создать новый аккаунт'}
            </button>
            <button
              className="auth__secondary"
              type="button"
              onClick={() => switchTo('login')}
              disabled={busy}
            >
              У меня уже есть аккаунт
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="auth">
      {brand}

      <div className="auth__card">
        <h1 className="auth__title">{isSignup ? 'Регистрация' : 'Вход'}</h1>

        {initialMode === 'choice' && !isSignup && (
          <p className="auth__sub">После входа этот Telegram будет привязан к вашему аккаунту.</p>
        )}

        <form className="auth__form" onSubmit={handleSubmit}>
          <div className="apf-field">
            <label className="apf-label" htmlFor="auth-email">Email</label>
            <input
              id="auth-email"
              className="apf-input"
              type="email"
              inputMode="email"
              autoComplete="username"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>

          <div className="apf-field">
            <label className="apf-label" htmlFor="auth-password">Пароль</label>
            <input
              id="auth-password"
              className="apf-input"
              type="password"
              autoComplete={isSignup ? 'new-password' : 'current-password'}
              placeholder={isSignup ? `Минимум ${MIN_PASSWORD_LENGTH} символов` : '••••••••'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>

          {isSignup && (
            <div className="apf-field">
              <label className="apf-label" htmlFor="auth-invite">Код приглашения</label>
              <input
                id="auth-invite"
                className="apf-input"
                type="text"
                autoComplete="off"
                value={inviteCode}
                onChange={(e) => setInviteCode(e.target.value)}
              />
            </div>
          )}

          {error && <div className="apf-error">{error}</div>}

          <button className="apf-submit" type="submit" disabled={busy}>
            {busy ? 'Подождите…' : isSignup ? 'Создать аккаунт' : 'Войти'}
          </button>
        </form>

        {initialMode === 'choice' ? (
          <button
            className="auth__secondary"
            type="button"
            onClick={() => switchTo('choice')}
            disabled={busy}
          >
            Назад
          </button>
        ) : (
          // Внутри Telegram аккаунт заводится без кода приглашения — эта кнопка
          // нужна только тем, кто пришёл не из Telegram.
          !inTelegram && (
            <button
              className="auth__secondary"
              type="button"
              onClick={() => switchTo(isSignup ? 'login' : 'signup')}
              disabled={busy}
            >
              {isSignup ? 'У меня уже есть аккаунт' : 'Создать аккаунт по приглашению'}
            </button>
          )
        )}
      </div>
    </div>
  );
}
