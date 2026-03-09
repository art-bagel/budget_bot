import { useEffect, useState } from 'react';
import Layout from './components/Layout';
import type { Page } from './components/Layout';
import ErrorBoundary from './components/ErrorBoundary';
import Dashboard from './pages/Dashboard';
import Operations from './pages/Operations';
import Exchange from './pages/Exchange';
import Settings from './pages/Settings';
import { useAuth } from './hooks/useAuth';
import { bindTelegramBackButton } from './telegram';

const PAGE_IDS: Page[] = ['dashboard', 'operations', 'exchange', 'settings'];

export default function App() {
  const [page, setPage] = useState<Page>('dashboard');
  const [visited, setVisited] = useState<Set<Page>>(new Set(['dashboard']));
  const { user, loading, error } = useAuth();

  const handleNavigate = (p: Page) => {
    setVisited(prev => new Set(prev).add(p));
    setPage(p);
  };

  useEffect(() => bindTelegramBackButton(page !== 'dashboard', () => handleNavigate('dashboard')), [page]);

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
    <Layout page={page} onNavigate={handleNavigate}>
      {PAGE_IDS.map((id) => visited.has(id) ? (
        <div key={id} style={id !== page ? { display: 'none' } : undefined}>
          <ErrorBoundary>
            {id === 'dashboard' && <Dashboard user={user} />}
            {id === 'operations' && <Operations user={user} />}
            {id === 'exchange' && <Exchange user={user} />}
            {id === 'settings' && <Settings user={user} />}
          </ErrorBoundary>
        </div>
      ) : null)}
    </Layout>
  );
}
