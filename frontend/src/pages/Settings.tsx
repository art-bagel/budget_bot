import type { ComponentType } from 'react';
import { useEffect, useState } from 'react';

import { useTheme } from '../hooks/useTheme';
import type { Theme } from '../hooks/useTheme';
import { useHints } from '../hooks/useHints';
import { IconSun, IconMoon, IconMonitor } from '../components/Icons';
import { deleteAccount, fetchMyFamily } from '../api';
import Family from './Family';
import type { FamilyInfo, UserContext } from '../types';

const THEME_OPTIONS: { value: Theme; label: string; icon: ComponentType }[] = [
  { value: 'system', label: 'Системная', icon: IconMonitor },
  { value: 'light', label: 'Светлая', icon: IconSun },
  { value: 'dark', label: 'Тёмная', icon: IconMoon },
];
export default function Settings({
  user,
  onFamilyBadgeUpdate,
}: {
  user: UserContext;
  onFamilyBadgeUpdate: (count: number) => void;
}) {
  const { theme, setTheme } = useTheme();
  const { hintsEnabled, toggle: toggleHints } = useHints();
  const [family, setFamily] = useState<FamilyInfo | null>(null);
  const [deleteInProgress, setDeleteInProgress] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    void fetchMyFamily()
      .then((result) => setFamily(result))
      .catch(() => setFamily(null));
  }, []);

  const handleDeleteAccount = async () => {
    const isConfirmed = window.confirm(
      'Удалить аккаунт и все данные? Это действие необратимо: будут удалены категории, операции, группы, банк и история обменов.',
    );

    if (!isConfirmed) {
      return;
    }

    setDeleteInProgress(true);
    setDeleteError(null);

    try {
      await deleteAccount();
      window.location.reload();
    } catch (reason: unknown) {
      setDeleteError(reason instanceof Error ? reason.message : String(reason));
      setDeleteInProgress(false);
    }
  };

  return (
    <>
      <h1 className="page-title">Настройки</h1>

      {/* Theme */}
      <section className="settings-section">
        <h2 className="settings-section__title">Оформление</h2>
        <div className="panel">
          <p className="settings-label">Тема интерфейса</p>
          <div className="theme-picker">
            {THEME_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                className={`theme-picker__option${theme === opt.value ? ' theme-picker__option--active' : ''}`}
                onClick={() => setTheme(opt.value)}
              >
                <span className="theme-picker__icon"><opt.icon /></span>
                {opt.label}
              </button>
            ))}
          </div>
          <div className="settings-row settings-row--first">
            <div>
              <div className="settings-row__title">Подсказки жестов</div>
              <div className="settings-row__sub">Показывать подсказки по свайпам в категориях</div>
            </div>
            <button
              className={`toggle${hintsEnabled ? ' toggle--on' : ''}`}
              type="button"
              role="switch"
              aria-checked={hintsEnabled}
              onClick={toggleHints}
            />
          </div>
        </div>
      </section>

      {/* Account */}
      <section className="settings-section">
        <h2 className="settings-section__title">Аккаунт</h2>
        <div className="panel">
          <ul>
            <li className="settings-row">
              <div>
                <div className="settings-row__title">Личная базовая валюта</div>
                <div className="settings-row__sub">Все личные категории ведутся в этой валюте</div>
              </div>
              <span className="pill">{user.base_currency_code}</span>
            </li>
            {family && (
              <>
                <li className="settings-row">
                  <div>
                    <div className="settings-row__title">Семья</div>
                    <div className="settings-row__sub">Семейный бюджет подключён</div>
                  </div>
                  <span className="tag tag--neutral">{family.name}</span>
                </li>
                <li className="settings-row">
                  <div>
                    <div className="settings-row__title">Семейная базовая валюта</div>
                    <div className="settings-row__sub">Все семейные категории ведутся в этой валюте</div>
                  </div>
                  <span className="pill">{family.base_currency_code}</span>
                </li>
              </>
            )}
            <li className="settings-row">
              <div>
                <div className="settings-row__title">Банковский счёт</div>
                <div className="settings-row__sub">Основной счёт для операций</div>
              </div>
              <span className="tag tag--neutral">Main #{user.bank_account_id}</span>
            </li>
          </ul>
        </div>
      </section>

      {/* Data */}
      <section className="settings-section">
        <h2 className="settings-section__title">Данные</h2>
        <div className="panel">
          <ul>
            <li className="settings-row">
              <div>
                <div className="settings-row__title">Экспорт операций</div>
                <div className="settings-row__sub">Скачать историю в CSV</div>
              </div>
              <button className="btn" type="button">Скачать</button>
            </li>
            <li className="settings-row">
              <div>
                <div className="settings-row__title">Курсы валют</div>
                <div className="settings-row__sub">Источник и время последнего обновления</div>
              </div>
              <span className="tag tag--neutral">CBR</span>
            </li>
          </ul>
        </div>
      </section>

      <section className="settings-section">
        <h2 className="settings-section__title">Семья</h2>
        <Family user={user} onBadgeUpdate={onFamilyBadgeUpdate} onFamilyChange={setFamily} embedded />
      </section>

      <section className="settings-section">
        <h2 className="settings-section__title">Опасная зона</h2>
        <div className="panel">
          <div className="settings-danger">
            <div>
              <div className="settings-row__title">Удалить аккаунт</div>
              <div className="settings-row__sub">
                Полностью очистить все данные пользователя: банк, операции, категории, группы и историю обменов.
              </div>
              {deleteError ? (
                <div className="settings-danger__error">{deleteError}</div>
              ) : null}
            </div>
            <button
              className="btn btn--danger"
              type="button"
              onClick={handleDeleteAccount}
              disabled={deleteInProgress}
            >
              {deleteInProgress ? 'Удаляем...' : 'Удалить аккаунт'}
            </button>
          </div>
        </div>
      </section>
    </>
  );
}
