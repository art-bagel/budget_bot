import { useRef } from 'react';
import type { ReactNode } from 'react';
import {
  IconCredit,
  IconDashboard,
  IconMoon,
  IconPortfolio,
  IconSettings,
  IconSun,
} from './Icons';
import { usePageSwipe } from '../hooks/usePageSwipe';
import { usePullToRefresh } from '../hooks/usePullToRefresh';
import { useTheme } from '../hooks/useTheme';
import { getTelegramWebApp } from '../telegram';

export type Page = 'dashboard' | 'exchange' | 'portfolio' | 'credits' | 'settings';

interface Props {
  page: Page;
  onNavigate: (page: Page) => void;
  onRefresh: () => void;
  badges?: Partial<Record<Page, number>>;
  children: ReactNode;
}

function getGreeting(): string {
  const h = new Date().getHours();
  if (h >= 5 && h < 12) return 'Доброе утро';
  if (h >= 12 && h < 17) return 'Добрый день';
  if (h >= 17 && h < 22) return 'Добрый вечер';
  return 'Добрый вечер';
}

function getUserInitials(): string {
  const tgUser = getTelegramWebApp()?.initDataUnsafe?.user;
  if (!tgUser) return 'БТ';
  const f = tgUser.first_name?.[0] ?? '';
  const l = tgUser.last_name?.[0] ?? '';
  return (f + l).toUpperCase() || 'БТ';
}

const NAV_ITEMS: { id: Page; label: string; icon: () => ReactNode }[] = [
  { id: 'dashboard', label: 'Обзор', icon: IconDashboard },
  { id: 'portfolio', label: 'Портфель', icon: IconPortfolio },
  { id: 'credits', label: 'Кредиты', icon: IconCredit },
  { id: 'settings', label: 'Настройки', icon: IconSettings },
];

export default function Layout({ page, onNavigate, onRefresh, badges, children }: Props) {
  const mainRef = useRef<HTMLElement>(null);
  const { resolved, setTheme } = useTheme();
  usePageSwipe(mainRef, page, onNavigate);
  usePullToRefresh(mainRef, onRefresh);

  const toggleTheme = () => setTheme(resolved === 'dark' ? 'light' : 'dark');

  return (
    <div className="app">
      {/* Top header bar */}
      <header className="bar">
        <div className="bar__left">
          <div className="ava">{getUserInitials()}</div>
          <div className="bar__meta">
            <span className="bar__hello">{getGreeting()}</span>
            <h1 className="bar__title">Бюджет</h1>
          </div>
        </div>
        <div className="bar__right">
          <button
            className="icon-btn icon-btn--sm"
            type="button"
            id="themeToggle"
            aria-label="Переключить тему"
            onClick={toggleTheme}
          >
            <span className={`tg__sun${resolved === 'dark' ? ' tg__sun--hidden' : ''}`}>
              <IconSun />
            </span>
            <span className={`tg__moon${resolved !== 'dark' ? ' tg__moon--hidden' : ''}`}>
              <IconMoon />
            </span>
          </button>
        </div>
      </header>

      {/* Page content */}
      <main ref={mainRef} className="main">{children}</main>

      {/* Mobile bottom nav */}
      <nav className="bottom-nav">
        {NAV_ITEMS.map((item) => (
          <button
            key={item.id}
            className={`bottom-nav__item${page === item.id ? ' bottom-nav__item--active' : ''}`}
            onClick={() => onNavigate(item.id)}
          >
            <span className="nav-icon-wrap">
              <span className="bottom-nav__icon">{item.icon()}</span>
              {badges?.[item.id] ? <span className="nav-badge" /> : null}
            </span>
            <span className="bottom-nav__item-label">{item.label}</span>
          </button>
        ))}
      </nav>
      <div className="nav-spacer" />
    </div>
  );
}
