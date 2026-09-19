import { useState } from 'react';
import { logIn, signUp } from '../api';

interface Props {
  onAuthenticated: () => void;
}

type Mode = 'login' | 'signup';

const DEFAULT_BASE_CURRENCY = 'RUB';
const MIN_PASSWORD_LENGTH = 10;

export default function LoginScreen({ onAuthenticated }: Props) {
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isSignup = mode === 'signup';
  const canSubmit = Boolean(email.trim())
    && password.length >= (isSignup ? MIN_PASSWORD_LENGTH : 1)
    && (!isSignup || Boolean(inviteCode.trim()));

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();

    if (!canSubmit || busy) {
      return;
    }

    setBusy(true);
    setError(null);

    try {
      if (isSignup) {
        await signUp(email.trim(), password, DEFAULT_BASE_CURRENCY, inviteCode.trim(), navigator.platform || undefined);
      } else {
        await logIn(email.trim(), password, navigator.platform || undefined);
      }
      onAuthenticated();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="status-screen">
      <h1>{isSignup ? 'Регистрация' : 'Вход'}</h1>

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

        <button className="btn btn--primary" type="submit" disabled={!canSubmit || busy}>
          {busy ? 'Подождите…' : isSignup ? 'Создать аккаунт' : 'Войти'}
        </button>
      </form>

      <button
        className="btn"
        type="button"
        onClick={() => {
          setMode(isSignup ? 'login' : 'signup');
          setError(null);
        }}
      >
        {isSignup ? 'У меня уже есть аккаунт' : 'Создать аккаунт по приглашению'}
      </button>
    </div>
  );
}
