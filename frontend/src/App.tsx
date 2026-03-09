import { useEffect, useState } from 'react';
import type { ComponentType } from 'react';
import Layout from './components/Layout';
import type { Page } from './components/Layout';
import ErrorBoundary from './components/ErrorBoundary';
import type { UserContext } from './types';
import Dashboard from './pages/Dashboard';
import Operations from './pages/Operations';
import Exchange from './pages/Exchange';
import Settings from './pages/Settings';
import { useAuth } from './hooks/useAuth';
import { bindTelegramBackButton } from './telegram';

const PAGES: Record<Page, ComponentType<{ user: UserContext }>> = {
  dashboard: Dashboard,
  operations: Operations,
  exchange: Exchange,
  settings: Settings,
};

export default function App() {
  const [page, setPage] = useState<Page>('dashboard');
  const { user, loading, error } = useAuth();
  const PageComponent = PAGES[page];

  useEffect(() => bindTelegramBackButton(page !== 'dashboard', () => setPage('dashboard')), [page]);

  useEffect(() => {
    if (user) {
      localStorage.setItem('budget_hints_enabled', String(user.hints_enabled));
    }
  }, [user]);

  if (loading) {
    return (
      <div className="status-screen">
        <h1>Подключение...</h1>
        <p>Регистрируем контекст пользователя</p>
      </div>
    );
  }

  if (error || !user) {
    return (
      <div className="status-screen">
        <h1>Ошибка</h1>
        <p>{error || 'Не удалось получить контекст пользователя'}</p>
      </div>
    );
  }

  return (
    <Layout page={page} onNavigate={setPage}>
      <ErrorBoundary>
        <PageComponent user={user} />
      </ErrorBoundary>
    </Layout>
  );
}
