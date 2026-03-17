import { useEffect, useMemo, useState } from 'react';

import { fetchBankAccountSnapshot, fetchBankAccounts } from '../api';
import type { BankAccount, DashboardBankBalance, UserContext } from '../types';
import { formatAmount } from '../utils/format';


type AccountWithBalances = {
  account: BankAccount;
  balances: DashboardBankBalance[];
};


export default function Portfolio({ user }: { user: UserContext }) {
  const [accounts, setAccounts] = useState<AccountWithBalances[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadPortfolio = async () => {
    setLoading(true);
    setError(null);

    try {
      const investmentAccounts = await fetchBankAccounts('investment');
      const snapshots = await Promise.all(
        investmentAccounts.map(async (account) => ({
          account,
          balances: await fetchBankAccountSnapshot(account.id),
        })),
      );
      setAccounts(snapshots);
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadPortfolio();
  }, [user.user_id]);

  const totalHistoricalInBase = useMemo(
    () => accounts.reduce(
      (sum, item) => sum + item.balances.reduce((accountSum, balance) => accountSum + balance.historical_cost_in_base, 0),
      0,
    ),
    [accounts],
  );

  if (loading) {
    return (
      <div className="status-screen">
        <h1>Загрузка...</h1>
        <p>Собираем инвестиционные счета</p>
      </div>
    );
  }

  return (
    <>
      <h1 className="page-title">Портфель</h1>

      <section className="section">
        <div className="section__header">
          <h2 className="section__title">Сводка</h2>
        </div>
        <div className="panel">
          {error && (
            <p style={{ color: 'var(--tag-out-fg)', fontSize: '0.85rem', marginBottom: 12 }}>
              {error}
            </p>
          )}

          <div className="balance-scroll">
            <article className="balance-card">
              <div className="balance-card__head">
                <span className="pill">BASE</span>
                <span className="tag tag--neutral">{accounts.length} счетов</span>
              </div>
              <span className="balance-card__amount">
                {formatAmount(totalHistoricalInBase, user.base_currency_code)}
              </span>
              <span className="balance-card__sub">Историческая стоимость investment-счетов</span>
            </article>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="section__header">
          <h2 className="section__title">Инвестиционные счета</h2>
        </div>
        <div className="panel">
          {accounts.length === 0 ? (
            <p className="list-row__sub">Инвестиционных счетов пока нет. Создай счет в настройках и переведи на него деньги с дашборда.</p>
          ) : (
            <div className="dashboard-budget-sections">
              {accounts.map(({ account, balances }) => (
                <div className="dashboard-budget-section" key={account.id}>
                  <div className="dashboard-budget-section__header">
                    <div>
                      <div className="section__eyebrow">
                        {account.owner_type === 'family' ? 'Семейный investment' : 'Личный investment'}
                      </div>
                      <div className="section__title" style={{ fontSize: '1rem' }}>{account.name}</div>
                    </div>
                    <span className="tag tag--neutral">
                      {account.provider_name || `Счет #${account.id}`}
                    </span>
                  </div>

                  {balances.length === 0 ? (
                    <p className="list-row__sub">На этом счете пока нет валютных остатков.</p>
                  ) : (
                    <ul className="bank-detail-list">
                      {balances.map((balance) => (
                        <li className="bank-detail-row" key={`${account.id}-${balance.currency_code}`}>
                          <div className="bank-detail-row__main">
                            <span className="pill">{balance.currency_code}</span>
                            <strong className="bank-detail-row__amount">
                              {formatAmount(balance.amount, balance.currency_code)}
                            </strong>
                          </div>
                          <div className="bank-detail-row__sub">
                            Себестоимость: {formatAmount(balance.historical_cost_in_base, balance.base_currency_code)}
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      <section className="section">
        <div className="section__header">
          <h2 className="section__title">Следующий шаг</h2>
        </div>
        <div className="panel">
          <p className="list-row__sub">
            Foundation для investment-счетов готов. Следующим этапом сюда добавим ручные позиции `security`, `deposit`, `crypto`
            и историю событий по ним.
          </p>
        </div>
      </section>
    </>
  );
}
