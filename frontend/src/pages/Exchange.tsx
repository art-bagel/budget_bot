import { IconExchange } from '../components/Icons';
import type { UserContext } from '../types';

export default function Exchange(_props: { user: UserContext }) {
  return (
    <div className="placeholder-page">
      <span className="placeholder-page__icon"><IconExchange /></span>
      <h2>Обмен валют</h2>
      <p>Здесь будет калькулятор обмена между валютами.</p>
    </div>
  );
}
