import { useEffect, useState } from 'react';

import { connectTinkoff, fetchBankAccounts, getTinkoffAccounts } from '../api';
import { useModalOpen } from '../hooks/useModalOpen';
import type { BankAccount, TinkoffBrokerAccount } from '../types';


interface Props {
  onClose: () => void;
  onSuccess: () => void;
}

type Step = 'enter_token' | 'select_account' | 'saving' | 'done' | 'error';


export default function TinkoffConnectDialog({ onClose, onSuccess }: Props) {
  useModalOpen();

  const [step, setStep] = useState<Step>('enter_token');
  const [token, setToken] = useState('');
  const [tinkoffAccounts, setTinkoffAccounts] = useState<TinkoffBrokerAccount[]>([]);
  const [ourAccounts, setOurAccounts] = useState<BankAccount[]>([]);
  const [selections, setSelections] = useState<Record<string, string>>({}); // provider_account_id → our account id
  const [skipped, setSkipped] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleTokenSubmit = async () => {
    if (!token.trim()) return;
    setLoading(true);
    setError(null);

    try {
      const [accounts, ours] = await Promise.all([
        getTinkoffAccounts(token.trim()),
        fetchBankAccounts('investment'),
      ]);

      setTinkoffAccounts(accounts);
      setOurAccounts(ours);

      // Pre-select first investment account for each Tinkoff account
      const sel: Record<string, string> = {};
      for (const acc of accounts) {
        sel[acc.provider_account_id] = ours[0] ? String(ours[0].id) : '';
      }
      setSelections(sel);
      setStep('select_account');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    setStep('saving');
    setError(null);

    try {
      for (const tAcc of tinkoffAccounts) {
        if (skipped[tAcc.provider_account_id]) continue;
        const linkedId = selections[tAcc.provider_account_id];
        if (!linkedId) continue;
        await connectTinkoff(token.trim(), tAcc.provider_account_id, Number(linkedId));
      }
      setStep('done');
      onSuccess();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
      setStep('error');
    }
  };

  const canSave = tinkoffAccounts.some(
    (acc) => !skipped[acc.provider_account_id] && !!selections[acc.provider_account_id],
  );

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <div className="dialog__header">
          <h2 className="dialog__title">Подключить Тинькофф</h2>
          <button className="dialog__close" onClick={onClose} type="button">✕</button>
        </div>

        <div className="dialog__body">
          {step === 'enter_token' && (
            <div className="tinkoff-connect__step">
              <p className="tinkoff-connect__hint">
                Шаг 1: Введи API-токен из Тинькофф Инвестиции → Настройки → Токен API
              </p>
              <input
                className="input"
                placeholder="t.xxxxxxxxxxxxxxxxxx"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                autoComplete="off"
                spellCheck={false}
              />
              {error && <p className="form-error">{error}</p>}
            </div>
          )}

          {step === 'select_account' && (
            <div className="tinkoff-connect__step">
              <p className="tinkoff-connect__hint">
                Шаг 2: Найдены счета Тинькофф. Привяжи каждый к инвест-счёту в боте.
              </p>
              {tinkoffAccounts.map((tAcc) => (
                <div key={tAcc.provider_account_id} className="tinkoff-connect__account-row">
                  <div className="tinkoff-connect__account-info">
                    <strong>{tAcc.name}</strong>
                    <span className="tinkoff-connect__account-id">{tAcc.provider_account_id}</span>
                  </div>

                  {!skipped[tAcc.provider_account_id] ? (
                    <select
                      className="tinkoff-connect__select"
                      value={selections[tAcc.provider_account_id] ?? ''}
                      onChange={(e) =>
                        setSelections((prev) => ({ ...prev, [tAcc.provider_account_id]: e.target.value }))
                      }
                    >
                      <option value="">— Выберите счёт —</option>
                      {ourAccounts.map((acc) => (
                        <option key={acc.id} value={String(acc.id)}>
                          {acc.name}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span className="tinkoff-connect__skipped-label">Не подключать</span>
                  )}

                  <label className="tinkoff-connect__skip-label">
                    <input
                      type="checkbox"
                      checked={!!skipped[tAcc.provider_account_id]}
                      onChange={(e) =>
                        setSkipped((prev) => ({ ...prev, [tAcc.provider_account_id]: e.target.checked }))
                      }
                    />
                    <span>Пропустить</span>
                  </label>
                </div>
              ))}

              {error && <p className="form-error">{error}</p>}
            </div>
          )}

          {step === 'saving' && (
            <p className="tinkoff-connect__status">Сохраняем подключение…</p>
          )}

          {step === 'done' && (
            <p className="tinkoff-connect__status">Подключение сохранено!</p>
          )}

          {step === 'error' && (
            <p className="form-error">{error ?? 'Неизвестная ошибка'}</p>
          )}
        </div>

        <div className="dialog__footer">
          <button className="btn btn--secondary" onClick={onClose} type="button">
            Отмена
          </button>

          {step === 'enter_token' && (
            <button
              className="btn btn--primary"
              onClick={handleTokenSubmit}
              disabled={!token.trim() || loading}
              type="button"
            >
              {loading ? 'Проверяем…' : 'Далее'}
            </button>
          )}

          {step === 'select_account' && (
            <button
              className="btn btn--primary"
              onClick={handleSave}
              disabled={!canSave}
              type="button"
            >
              Сохранить
            </button>
          )}

          {(step === 'done' || step === 'error') && (
            <button className="btn btn--primary" onClick={onClose} type="button">
              Закрыть
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
