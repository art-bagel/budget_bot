import { useState } from 'react';
import Layout from './components/Layout';
import type { Page } from './components/Layout';
import type { UserContext } from './types';
import Dashboard from './pages/Dashboard';
import Operations from './pages/Operations';
import Categories from './pages/Categories';
import Exchange from './pages/Exchange';
import Settings from './pages/Settings';
import { useAuth } from './hooks/useAuth';

const PAGES: Record<Page, (props: { user: UserContext }) => JSX.Element> = {
  dashboard: Dashboard,
  operations: Operations,
  categories: Categories,
  exchange: Exchange,
  settings: Settings,
};

export default function App() {
  const [page, setPage] = useState<Page>('dashboard');
  const { user, loading, error } = useAuth();
  const PageComponent = PAGES[page];

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
      <PageComponent user={user} />
    </Layout>
  );
}
