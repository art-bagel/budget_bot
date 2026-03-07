import { useTheme } from '../hooks/useTheme';
import type { Theme } from '../hooks/useTheme';
import { IconSun, IconMoon, IconMonitor } from '../components/Icons';

const THEME_OPTIONS: { value: Theme; label: string; icon: () => JSX.Element }[] = [
  { value: 'system', label: 'Системная', icon: IconMonitor },
  { value: 'light', label: 'Светлая', icon: IconSun },
  { value: 'dark', label: 'Тёмная', icon: IconMoon },
];

import type { UserContext } from '../types';

export default function Settings(_props: { user: UserContext }) {
  const { theme, setTheme } = useTheme();

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
                <span className="theme-picker__icon">{opt.icon()}</span>
                {opt.label}
              </button>
            ))}
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
                <div className="settings-row__title">Базовая валюта</div>
                <div className="settings-row__sub">Все бюджетные категории ведутся в этой валюте</div>
              </div>
              <span className="pill">RUB</span>
            </li>
            <li className="settings-row">
              <div>
                <div className="settings-row__title">Банковский счёт</div>
                <div className="settings-row__sub">Основной счёт для операций</div>
              </div>
              <span className="tag tag--neutral">Основной</span>
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
    </>
  );
}
