import { useMemo, useState } from 'react';
import {
  AlertCircle,
  ArrowRight,
  Check,
  Eye,
  EyeOff,
  Key,
  Landmark,
  Loader2,
  SkipForward,
} from 'lucide-react';

import { connectTinkoff, fetchBankAccounts, getTinkoffAccounts } from '../api';
import { useModalOpen } from '../hooks/useModalOpen';
import BottomSheet from './BottomSheet';
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
  const [showToken, setShowToken] = useState(false);
  const [tinkoffAccounts, setTinkoffAccounts] = useState<TinkoffBrokerAccount[]>([]);
  const [ourAccounts, setOurAccounts] = useState<BankAccount[]>([]);
  const [selections, setSelections] = useState<Record<string, string>>({});
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

  const stepIndex = useMemo<1 | 2 | 3>(() => {
    if (step === 'enter_token') return 1;
    if (step === 'select_account' || step === 'saving') return 2;
    return 3;
  }, [step]);

  const renderStepper = () => (
    <ol className="tk-steps" aria-label="Шаги подключения">
      {([1, 2, 3] as const).map((n) => {
        const cls = n === stepIndex ? 'is-active' : n < stepIndex ? 'is-done' : '';
        const label = n === 1 ? 'Токен' : n === 2 ? 'Счета' : 'Готово';
        return (
          <li key={n} className={`tk-steps__item ${cls}`.trim()}>
            <span className="tk-steps__num">{n < stepIndex ? <Check size={14} strokeWidth={2.5} /> : n}</span>
            <span className="tk-steps__label">{label}</span>
          </li>
        );
      })}
    </ol>
  );

  const renderActions = () => {
    if (step === 'enter_token') {
      return (
        <div className="tk-foot__row">
          <button className="btn btn--ghost" onClick={onClose} type="button">Отмена</button>
          <button
            className="btn btn--primary"
            onClick={handleTokenSubmit}
            disabled={!token.trim() || loading}
            type="button"
          >
            {loading ? (
              <>
                <Loader2 size={16} strokeWidth={2.5} className="tk-spin" />
                Проверяем…
              </>
            ) : (
              <>
                Далее
                <ArrowRight size={16} strokeWidth={2.5} />
              </>
            )}
          </button>
        </div>
      );
    }
    if (step === 'select_account') {
      return (
        <div className="tk-foot__row">
          <button className="btn btn--ghost" onClick={() => setStep('enter_token')} type="button">Назад</button>
          <button
            className="btn btn--primary"
            onClick={handleSave}
            disabled={!canSave}
            type="button"
          >
            Сохранить
          </button>
        </div>
      );
    }
    if (step === 'saving') {
      return (
        <div className="tk-foot__row">
          <button className="btn btn--ghost" disabled type="button">Сохраняем…</button>
        </div>
      );
    }
    return (
      <div className="tk-foot__row">
        <button className="btn btn--primary" onClick={onClose} type="button">Закрыть</button>
      </div>
    );
  };

  return (
    <BottomSheet
      open
      tag="Интеграция · Тинькофф"
      title="Подключить брокера"
      onClose={onClose}
      actions={
        <div className="tk-foot pf-sheet-actions">
          {renderActions()}
        </div>
      }
    >
      {renderStepper()}

      {step === 'enter_token' && (
        <>
          <div className="tk-lead">
            <span className="tk-lead__ico">
              <Key size={18} strokeWidth={2} />
            </span>
            <div className="tk-lead__text">
              <h4>Введите API-токен Тинькофф Инвестиции</h4>
              <p>
                Создайте токен в приложении: <em>Инвестиции → Настройки → Токены API</em>.
                Нужен readonly-токен — мы только читаем операции, ничего не изменяем.
              </p>
            </div>
          </div>

          <div className="field">
            <span className="fl">API-токен</span>
            <div className="tk-token">
              <span className="tk-token__pfx">t.</span>
              <input
                className="tk-token__field"
                type={showToken ? 'text' : 'password'}
                placeholder="••••••••••••••••••••••••"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                autoComplete="off"
                spellCheck={false}
              />
              <button
                type="button"
                className="tk-token__eye"
                onClick={() => setShowToken((s) => !s)}
                aria-label={showToken ? 'Скрыть токен' : 'Показать токен'}
              >
                {showToken
                  ? <EyeOff size={18} strokeWidth={2} />
                  : <Eye size={18} strokeWidth={2} />}
              </button>
            </div>
            <span className="amt__hint">
              Токен хранится зашифрованным. Доступ — только чтение операций.
            </span>
          </div>

          <ul className="tk-checks">
            <li className="tk-checks__item">
              <Check className="tk-checks__ico" strokeWidth={2.5} />
              Не совершаем сделки
            </li>
            <li className="tk-checks__item">
              <Check className="tk-checks__ico" strokeWidth={2.5} />
              Нет доступа к выводу средств
            </li>
            <li className="tk-checks__item">
              <Check className="tk-checks__ico" strokeWidth={2.5} />
              Можно отозвать токен в любой момент
            </li>
          </ul>

          {error && (
            <div className="tk-error">
              <AlertCircle strokeWidth={2} />
              <span>{error}</span>
            </div>
          )}
        </>
      )}

      {step === 'select_account' && (
        <>
          <div className="tk-lead">
            <span className="tk-lead__ico tk-lead__ico--ok">
              <Landmark size={18} strokeWidth={2} />
            </span>
            <div className="tk-lead__text">
              <h4>
                {tinkoffAccounts.length === 1
                  ? 'Найден 1 счёт в Тинькофф'
                  : `Найдено ${tinkoffAccounts.length} счетов в Тинькофф`}
              </h4>
              <p>Свяжите каждый с инвест-счётом в боте. Можно пропустить, если не хотите подтягивать.</p>
            </div>
          </div>

          <ul className="tk-link-list">
            {tinkoffAccounts.map((tAcc) => {
              const isSkipped = !!skipped[tAcc.provider_account_id];
              return (
                <li
                  key={tAcc.provider_account_id}
                  className={`tk-link-row${isSkipped ? ' is-skipped' : ''}`}
                >
                  <div className="tk-link-row__head">
                    <span className="tk-link-row__brand">T</span>
                    <div>
                      <div className="tk-link-row__name">{tAcc.name}</div>
                      <div className="tk-link-row__id">{tAcc.provider_account_id}</div>
                    </div>
                  </div>

                  {!isSkipped ? (
                    <label className="tk-link-row__pick">
                      <span className="tk-link-row__pick-label">Привязать к</span>
                      <select
                        className="picker-v2"
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
                    </label>
                  ) : (
                    <span className="tk-link-row__skipped-label">Этот счёт не подключаем</span>
                  )}

                  <button
                    type="button"
                    className="tk-link-row__skip"
                    aria-pressed={isSkipped}
                    onClick={() =>
                      setSkipped((prev) => ({ ...prev, [tAcc.provider_account_id]: !isSkipped }))
                    }
                  >
                    <SkipForward strokeWidth={2} />
                    {isSkipped ? 'Подключить' : 'Пропустить'}
                  </button>
                </li>
              );
            })}
          </ul>

          {error && (
            <div className="tk-error">
              <AlertCircle strokeWidth={2} />
              <span>{error}</span>
            </div>
          )}
        </>
      )}

      {step === 'saving' && (
        <div className="tk-state">
          <div className="tk-state__spinner" />
          <div className="tk-state__title">Сохраняем подключение…</div>
          <div className="tk-state__sub">Привязываем выбранные счета и проверяем доступ.</div>
        </div>
      )}

      {step === 'done' && (
        <div className="tk-done">
          <div className="tk-done__seal">
            <Check size={34} strokeWidth={3} />
          </div>
          <h3 className="tk-done__title">Готово</h3>
          <p className="tk-done__sub">
            Подключили Тинькофф. Теперь можно <strong>подтягивать операции</strong> из карточки счёта.
          </p>
          <ul className="tk-done__list">
            {tinkoffAccounts
              .filter((t) => !skipped[t.provider_account_id] && !!selections[t.provider_account_id])
              .map((t) => {
                const linked = ourAccounts.find((a) => String(a.id) === selections[t.provider_account_id]);
                return (
                  <li key={t.provider_account_id}>
                    <span>{t.name} → {linked?.name ?? '—'}</span>
                    <span className="tk-done__ok">привязан</span>
                  </li>
                );
              })}
          </ul>
        </div>
      )}

      {step === 'error' && (
        <div className="tk-state tk-state--error">
          <div className="tk-state__seal--err">
            <AlertCircle size={26} strokeWidth={2} />
          </div>
          <div className="tk-state__title">Не получилось подключить</div>
          <div className="tk-state__sub">{error ?? 'Неизвестная ошибка'}</div>
        </div>
      )}
    </BottomSheet>
  );
}
