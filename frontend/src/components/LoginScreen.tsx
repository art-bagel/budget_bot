import { useState } from 'react';
import { linkTelegram, logIn, register, signUp } from '../api';
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

  const handleCreateWithTelegram = () => run(() => register(DEFAULT_BASE_CURRENCY));

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

  if (mode === 'choice') {
    return (
      <div className="status-screen">
        <h1>Budget</h1>
        <p>Аккаунта за этим Telegram ещё нет.</p>

        {error && <p className="form-error">{error}</p>}

        <div className="field field--col">
          <button
            className="btn btn--primary"
            type="button"
            onClick={handleCreateWithTelegram}
            disabled={busy}
          >
            {busy ? 'Создаём…' : 'Создать новый аккаунт'}
          </button>
          <button
            className="btn"
            type="button"
            onClick={() => { setMode('login'); setError(null); }}
            disabled={busy}
          >
            У меня уже есть аккаунт
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="status-screen">
      <h1>{isSignup ? 'Регистрация' : 'Вход'}</h1>

      {initialMode === 'choice' && !isSignup && (
        <p>После входа этот Telegram будет привязан к вашему аккаунту.</p>
      )}

      <form className="field field--col" onSubmit={handleSubmit}>
        <input
          className="input"
          type="email"
          inputMode="email"
          autoComplete="username"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />

        <input
          className="input"
          type="password"
          autoComplete={isSignup ? 'new-password' : 'current-password'}
          placeholder={isSignup ? `Пароль, минимум ${MIN_PASSWORD_LENGTH} символов` : 'Пароль'}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />

        {isSignup && (
          <input
            className="input"
            type="text"
            autoComplete="off"
            placeholder="Код приглашения"
            value={inviteCode}
            onChange={(e) => setInviteCode(e.target.value)}
          />
        )}

        {error && <p className="form-error">{error}</p>}

        <button className="btn btn--primary" type="submit" disabled={busy}>
          {busy ? 'Подождите…' : isSignup ? 'Создать аккаунт' : 'Войти'}
        </button>
      </form>

      {initialMode === 'choice' ? (
        <button
          className="btn"
          type="button"
          onClick={() => { setMode('choice'); setError(null); }}
          disabled={busy}
        >
          Назад
        </button>
      ) : (
        // Внутри Telegram аккаунт заводится без кода приглашения — эта кнопка
        // нужна только тем, кто пришёл не из Telegram.
        !inTelegram && (
          <button
            className="btn"
            type="button"
            onClick={() => { setMode(isSignup ? 'login' : 'signup'); setError(null); }}
            disabled={busy}
          >
            {isSignup ? 'У меня уже есть аккаунт' : 'Создать аккаунт по приглашению'}
          </button>
        )
      )}
    </div>
  );
}
