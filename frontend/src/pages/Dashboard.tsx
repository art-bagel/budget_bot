import { useEffect, useState } from 'react';

import { fetchDashboardOverview } from '../api';
import type { UserContext } from '../types';
import type { DashboardOverview as DashboardOverviewType } from '../types';


function formatAmount(amount: number, currencyCode: string): string {
  return new Intl.NumberFormat('ru-RU', {
    maximumFractionDigits: 2,
  }).format(amount) + ' ' + currencyCode;
}

export default function Dashboard({ user }: { user: UserContext }) {
  const [overview, setOverview] = useState<DashboardOverviewType | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchDashboardOverview(user.bank_account_id)
      .then(setOverview)
      .catch((reason: Error) => setError(reason.message))
      .finally(() => setLoading(false));
  }, [user.bank_account_id]);

  if (loading) {
    return (
      <div className="status-screen">
        <h1>Загрузка...</h1>
        <p>Собираем реальные остатки банка и бюджетов.</p>
      </div>
    );
  }

  if (error || !overview) {
    return (
      <div className="status-screen">
        <h1>Не удалось загрузить обзор</h1>
        <p>{error || 'Нет данных для отображения.'}</p>
      </div>
    );
  }

  return (
    <>
      <h1 className="page-title">Обзор</h1>

      <section className="metrics">
        <article className="metric-card">
          <span className="metric-card__label">Банк по себестоимости</span>
          <strong className="metric-card__value">
            {formatAmount(overview.total_bank_historical_in_base, overview.base_currency_code)}
          </strong>
        </article>
        <article className="metric-card metric-card--accent">
          <span className="metric-card__label">Бюджет по категориям</span>
          <strong className="metric-card__value">
            {formatAmount(overview.total_budget_in_base, overview.base_currency_code)}
          </strong>
        </article>
      </section>

      <section className="section">
        <div className="section__header">
          <div>
            <div className="section__eyebrow">Банк</div>
            <h2 className="section__title">Сколько денег лежит по валютам</h2>
          </div>
        </div>
        <div className="balance-scroll">
          {overview.bank_balances.map((balance) => (
            <article className="balance-card" key={balance.currency_code}>
              <div className="balance-card__head">
                <span className="pill">{balance.currency_code}</span>
              </div>
              <strong className="balance-card__amount">
                {formatAmount(balance.amount, balance.currency_code)}
              </strong>
              <div className="balance-card__sub">
                Себестоимость: {formatAmount(balance.historical_cost_in_base, overview.base_currency_code)}
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="section">
        <div className="section__header">
          <div>
            <div className="section__eyebrow">Бюджет</div>
            <h2 className="section__title">Как распределены деньги по категориям</h2>
          </div>
          <span className="tag tag--neutral">
            Свободный остаток: {formatAmount(overview.free_budget_in_base, overview.base_currency_code)}
          </span>
        </div>
        <div className="panel">
          <ul>
            {overview.budget_categories.map((category) => (
              <li className="list-row" key={category.category_id}>
                <div>
                  <div className="list-row__title">{category.name}</div>
                  <div className="list-row__sub">Тип: {category.kind}</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div className="list-row__value">
                    {formatAmount(category.balance, category.currency_code)}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </>
  );
}
