import { IconDashboard } from '../components/Icons';
import type { UserContext } from '../types';

export default function Dashboard(_props: { user: UserContext }) {
  return (
    <div className="placeholder-page">
      <span className="placeholder-page__icon"><IconDashboard /></span>
      <h2>Обзор</h2>
      <p>Здесь будет сводка по банку и бюджету.</p>
    </div>
  );
}
