import { useRef } from 'react';
import type { ReactNode } from 'react';
import {
  IconCredit,
  IconDashboard,
  IconPortfolio,
  IconSettings,
} from './Icons';
import { usePageSwipe } from '../hooks/usePageSwipe';
import { usePullToRefresh } from '../hooks/usePullToRefresh';
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

function getTelegramAvatarData(): { initials: string; photoUrl: string | null; firstName: string } {
  const tgUser = getTelegramWebApp()?.initDataUnsafe?.user;
  if (!tgUser) return { initials: 'БТ', photoUrl: null, firstName: 'Бюджет' };
  const f = tgUser.first_name?.[0] ?? '';
  const l = tgUser.last_name?.[0] ?? '';
  return {
    initials: (f + l).toUpperCase() || 'БТ',
    photoUrl: tgUser.photo_url ?? null,
    firstName: tgUser.first_name || tgUser.username || 'Бюджет',
  };
}

const NAV_ITEMS: { id: Page; label: string; icon: () => ReactNode }[] = [
  { id: 'dashboard', label: 'Обзор', icon: IconDashboard },
  { id: 'portfolio', label: 'Портфель', icon: IconPortfolio },
  { id: 'credits', label: 'Кредиты', icon: IconCredit },
  { id: 'settings', label: 'Настройки', icon: IconSettings },
];

export default function Layout({ page, onNavigate, onRefresh, badges, children }: Props) {
  const mainRef = useRef<HTMLElement>(null);
  const enableTelegramTouchShell = Boolean(getTelegramWebApp());
  usePageSwipe(mainRef, page, onNavigate, enableTelegramTouchShell);
  usePullToRefresh(mainRef, onRefresh, enableTelegramTouchShell);

  const avatar = getTelegramAvatarData();

  return (
    <div className="app">
      {/* Top header bar */}
      <header className="bar">
        <div className="bar__left">
          <div className="ava">
            {avatar.photoUrl
              ? <img src={avatar.photoUrl} alt="" />
              : avatar.initials
            }
          </div>
          <div className="bar__meta">
            <span className="bar__hello">{getGreeting()}</span>
            <h1 className="bar__title">{avatar.firstName}</h1>
          </div>
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
