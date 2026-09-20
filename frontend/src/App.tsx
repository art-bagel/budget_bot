import { useEffect, useState } from 'react';
import SplashScreen from './components/SplashScreen';
import Layout from './components/Layout';
import type { Page } from './components/Layout';
import ErrorBoundary from './components/ErrorBoundary';
import LoginScreen from './components/LoginScreen';
import Credits from './pages/Credits';
import Dashboard from './pages/Dashboard';
import Exchange from './pages/Exchange';
import Portfolio from './pages/Portfolio';
import Settings from './pages/Settings';
import { useAuth } from './hooks/useAuth';
import { useTheme } from './hooks/useTheme';
import type { Theme } from './hooks/useTheme';
import { bindTelegramBackButton, getTelegramInitData } from './telegram';

const PAGE_IDS: Page[] = ['dashboard', 'exchange', 'portfolio', 'credits', 'settings'];

export default function App() {
  const [page, setPage] = useState<Page>('dashboard');
  const [visited, setVisited] = useState<Set<Page>>(new Set(['dashboard']));
  const [refreshKeys, setRefreshKeys] = useState<Record<Page, number>>({
    dashboard: 0, exchange: 0, portfolio: 0, credits: 0, settings: 0,
  });
  const [familyBadge, setFamilyBadge] = useState(0);
  const { user, loading, error, needsLogin, needsAccount, refresh } = useAuth();
  const { syncFromServer } = useTheme();

  // refreshKeys — это больше не ключ ремонта, а токен обновления данных.
  // Раньше он стоял в key у ErrorBoundary, и любое переключение вкладки
  // пересоздавало страницу целиком: терялся скролл и открытые шиты, а
  // соседняя механика visited + display:none, которая ровно для того и
  // существует, чтобы страницу сохранять, становилась бессмысленной.
  const handleNavigate = (p: Page) => {
    setVisited(prev => new Set(prev).add(p));
    setPage(p);
    setRefreshKeys(prev => ({ ...prev, [p]: prev[p] + 1 }));
  };

  const handleRefresh = () => {
    setRefreshKeys(prev => ({ ...prev, [page]: prev[page] + 1 }));
  };

  useEffect(() => bindTelegramBackButton(page !== 'dashboard', () => handleNavigate('dashboard')), [page]);

  // Вне Telegram кнопки "назад" нет, а её роль играет системный жест. Без
  // записи в history свайп назад уводил бы из приложения целиком — на
  // домашнем экране и в нативной обёртке это выглядит как вылет.
  useEffect(() => {
    if (getTelegramInitData() || page === 'dashboard') {
      return;
    }

    // Одна запись на весь заход вглубь: иначе каждая вкладка добавляла бы
    // свою и до выхода пришлось бы жать "назад" столько же раз.
    if (!(window.history.state as { budgetDeep?: boolean } | null)?.budgetDeep) {
      window.history.pushState({ budgetDeep: true }, '');
    }

    const handlePopState = () => setPage('dashboard');
    window.addEventListener('popstate', handlePopState);

    return () => window.removeEventListener('popstate', handlePopState);
  }, [page]);

  useEffect(() => {
    if (user) {
      localStorage.setItem('budget_hints_enabled', String(user.hints_enabled));
      syncFromServer(user.theme as Theme);
    }
  }, [user]);

  if (loading) {
    return <SplashScreen />;
  }

  if (needsLogin || needsAccount) {
    return (
      <LoginScreen
        initialMode={needsAccount ? 'choice' : 'login'}
        onAuthenticated={refresh}
      />
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
    <Layout page={page} onNavigate={handleNavigate} onRefresh={handleRefresh} badges={{ settings: familyBadge }}>
      {PAGE_IDS.map((id) => visited.has(id) ? (
        <div key={id} className="page-wrap" style={id !== page ? { display: 'none' } : undefined}>
          <ErrorBoundary>
            {id === 'dashboard' && <Dashboard user={user} onNavigate={handleNavigate} refreshToken={refreshKeys[id]} />}
            {id === 'exchange' && <Exchange user={user} refreshToken={refreshKeys[id]} />}
            {id === 'portfolio' && <Portfolio user={user} refreshToken={refreshKeys[id]} />}
            {id === 'credits' && <Credits user={user} refreshToken={refreshKeys[id]} />}
            {id === 'settings' && (
              <Settings
                user={user}
                onFamilyBadgeUpdate={setFamilyBadge}
                onSignedOut={refresh}
                refreshToken={refreshKeys[id]}
              />
            )}
          </ErrorBoundary>
        </div>
      ) : null)}
    </Layout>
  );
}
