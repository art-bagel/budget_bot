import { useRef } from 'react';
import type { ReactNode } from 'react';
import {
  IconCredit,
  IconDashboard,
  IconExchange,
  IconPortfolio,
  IconSettings,
} from './Icons';
import { usePageSwipe } from '../hooks/usePageSwipe';
import { usePullToRefresh } from '../hooks/usePullToRefresh';

export type Page = 'dashboard' | 'exchange' | 'portfolio' | 'credits' | 'settings';

interface Props {
  page: Page;
  onNavigate: (page: Page) => void;
  onRefresh: () => void;
  badges?: Partial<Record<Page, number>>;
  children: ReactNode;
}

const NAV_ITEMS: { id: Page; label: string; icon: () => ReactNode }[] = [
  { id: 'dashboard', label: 'Обзор', icon: IconDashboard },
  { id: 'exchange', label: 'Обмен', icon: IconExchange },
  { id: 'portfolio', label: 'Портфель', icon: IconPortfolio },
  { id: 'credits', label: 'Кредиты', icon: IconCredit },
  { id: 'settings', label: 'Настройки', icon: IconSettings },
];

export default function Layout({ page, onNavigate, onRefresh, badges, children }: Props) {
  const mainRef = useRef<HTMLElement>(null);
  usePageSwipe(mainRef, page, onNavigate);
  usePullToRefresh(mainRef, onRefresh);

  return (
    <div className="app">
      {/* Desktop sidebar */}
      <aside className="sidebar">
        <div className="sidebar__logo">Budget</div>
        <nav className="sidebar__nav">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.id}
              className={`nav-item${page === item.id ? ' nav-item--active' : ''}`}
              onClick={() => onNavigate(item.id)}
            >
              <span className="nav-icon-wrap">
                <span className="nav-icon">{item.icon()}</span>
                {badges?.[item.id] ? <span className="nav-badge" /> : null}
              </span>
              {item.label}
            </button>
          ))}
        </nav>
      </aside>

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
            {item.label}
          </button>
        ))}
      </nav>
    </div>
  );
}
