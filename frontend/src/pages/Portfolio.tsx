import { type FormEvent, useEffect, useMemo, useState } from 'react';

import {
  closePortfolioPosition,
  createPortfolioPosition,
  fetchBankAccountSnapshot,
  fetchBankAccounts,
  fetchCurrencies,
  fetchPortfolioEvents,
  fetchPortfolioPositions,
  recordPortfolioIncome,
} from '../api';
import type {
  BankAccount,
  Currency,
  DashboardBankBalance,
  PortfolioEvent,
  PortfolioPosition,
  UserContext,
} from '../types';
import { formatAmount } from '../utils/format';


type AccountWithBalances = {
  account: BankAccount;
  balances: DashboardBankBalance[];
};

type CloseDraft = {
  amount: string;
  currencyCode: string;
  baseAmount: string;
  closedAt: string;
  comment: string;
};

type IncomeDraft = {
  amount: string;
  currencyCode: string;
  baseAmount: string;
  incomeKind: string;
  receivedAt: string;
  comment: string;
};

const ASSET_TYPE_OPTIONS = [
  { value: 'security', label: 'Ценные бумаги' },
  { value: 'deposit', label: 'Депозит' },
  { value: 'crypto', label: 'Криптовалюта' },
] as const;


function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function formatDateLabel(value: string): string {
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date(value));
}

function assetTypeLabel(assetTypeCode: string): string {
  return ASSET_TYPE_OPTIONS.find((item) => item.value === assetTypeCode)?.label ?? assetTypeCode;
}

function createInitialCloseDraft(position: PortfolioPosition): CloseDraft {
  return {
    amount: '',
    currencyCode: position.currency_code,
    baseAmount: '',
    closedAt: todayIso(),
    comment: '',
  };
}

function createInitialIncomeDraft(position: PortfolioPosition): IncomeDraft {
  return {
    amount: '',
    currencyCode: position.currency_code,
    baseAmount: '',
    incomeKind: position.asset_type_code === 'deposit' ? 'interest' : 'dividend',
    receivedAt: todayIso(),
    comment: '',
  };
}

function canRecordPositionIncome(position: PortfolioPosition): boolean {
  return position.asset_type_code === 'security' || position.asset_type_code === 'deposit';
}

function getEventLabel(item: PortfolioEvent): string {
  if (item.event_type === 'income') {
    const incomeKind = typeof item.metadata?.income_kind === 'string' ? item.metadata.income_kind : 'income';
    if (incomeKind === 'dividend') return 'DIVIDEND';
    if (incomeKind === 'interest') return 'INTEREST';
    return 'INCOME';
  }

  return item.event_type.toUpperCase();
}


export default function Portfolio({ user }: { user: UserContext }) {
  const [accounts, setAccounts] = useState<AccountWithBalances[]>([]);
  const [currencies, setCurrencies] = useState<Currency[]>([]);
  const [positions, setPositions] = useState<PortfolioPosition[]>([]);
  const [loading, setLoading] = useState(true);
  const [submittingCreate, setSubmittingCreate] = useState(false);
  const [submittingCloseId, setSubmittingCloseId] = useState<number | null>(null);
  const [submittingIncomeId, setSubmittingIncomeId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [closeError, setCloseError] = useState<string | null>(null);
  const [incomeError, setIncomeError] = useState<string | null>(null);
  const [selectedPositionId, setSelectedPositionId] = useState<number | null>(null);
  const [eventsByPosition, setEventsByPosition] = useState<Record<number, PortfolioEvent[]>>({});
  const [eventsLoadingId, setEventsLoadingId] = useState<number | null>(null);
  const [eventsError, setEventsError] = useState<string | null>(null);
  const [closeDrafts, setCloseDrafts] = useState<Record<number, CloseDraft>>({});
  const [incomeDrafts, setIncomeDrafts] = useState<Record<number, IncomeDraft>>({});
  const [newInvestmentAccountId, setNewInvestmentAccountId] = useState('');
  const [newAssetTypeCode, setNewAssetTypeCode] = useState<(typeof ASSET_TYPE_OPTIONS)[number]['value']>('security');
  const [newTitle, setNewTitle] = useState('');
  const [newQuantity, setNewQuantity] = useState('');
  const [newAmount, setNewAmount] = useState('');
  const [newCurrencyCode, setNewCurrencyCode] = useState(user.base_currency_code);
  const [newOpenedAt, setNewOpenedAt] = useState(todayIso());
  const [newComment, setNewComment] = useState('');

  const loadPortfolio = async () => {
    setLoading(true);
    setError(null);

    try {
      const [investmentAccounts, loadedPositions, loadedCurrencies] = await Promise.all([
        fetchBankAccounts('investment'),
        fetchPortfolioPositions(),
        fetchCurrencies(),
      ]);
      const snapshots = await Promise.all(
        investmentAccounts.map(async (account) => ({
          account,
          balances: await fetchBankAccountSnapshot(account.id),
        })),
      );

      setAccounts(snapshots);
      setPositions(loadedPositions);
      setCurrencies(loadedCurrencies);
      setNewInvestmentAccountId((currentValue) => {
        if (currentValue && investmentAccounts.some((account) => String(account.id) === currentValue)) {
          return currentValue;
        }
        return investmentAccounts[0] ? String(investmentAccounts[0].id) : '';
      });
      setNewCurrencyCode((currentValue) => (
        loadedCurrencies.some((currency) => currency.code === currentValue)
          ? currentValue
          : (loadedCurrencies[0]?.code ?? user.base_currency_code)
      ));
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

  const openPositions = useMemo(
    () => positions.filter((position) => position.status === 'open'),
    [positions],
  );

  const closedPositions = useMemo(
    () => positions.filter((position) => position.status === 'closed'),
    [positions],
  );

  const selectedAccountBalances = useMemo(
    () => accounts.find(({ account }) => String(account.id) === newInvestmentAccountId)?.balances ?? [],
    [accounts, newInvestmentAccountId],
  );

  const selectedCurrencyBalance = useMemo(
    () => selectedAccountBalances.find((balance) => balance.currency_code === newCurrencyCode)?.amount ?? 0,
    [selectedAccountBalances, newCurrencyCode],
  );

  const loadEventsForPosition = async (positionId: number) => {
    setEventsLoadingId(positionId);
    setEventsError(null);

    try {
      const loadedEvents = await fetchPortfolioEvents(positionId);
      setEventsByPosition((prev) => ({ ...prev, [positionId]: loadedEvents }));
    } catch (reason: unknown) {
      setEventsError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setEventsLoadingId(null);
    }
  };

  const handleToggleEvents = async (positionId: number) => {
    if (selectedPositionId === positionId) {
      setSelectedPositionId(null);
      return;
    }

    setSelectedPositionId(positionId);
    if (!eventsByPosition[positionId]) {
      await loadEventsForPosition(positionId);
    }
  };

  const handleCreatePosition = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!newInvestmentAccountId || !newTitle.trim() || !newAmount.trim() || submittingCreate) {
      return;
    }

    if (Number(newAmount) > selectedCurrencyBalance) {
      setCreateError('Недостаточно денег на инвестиционном счете для открытия позиции.');
      return;
    }

    setSubmittingCreate(true);
    setCreateError(null);

    try {
      await createPortfolioPosition({
        investment_account_id: Number(newInvestmentAccountId),
        asset_type_code: newAssetTypeCode,
        title: newTitle.trim(),
        quantity: newQuantity.trim() ? Number(newQuantity) : undefined,
        amount_in_currency: Number(newAmount),
        currency_code: newCurrencyCode,
        opened_at: newOpenedAt || undefined,
        comment: newComment.trim() || undefined,
      });
      setNewAssetTypeCode('security');
      setNewTitle('');
      setNewQuantity('');
      setNewAmount('');
      setNewOpenedAt(todayIso());
      setNewComment('');
      await loadPortfolio();
    } catch (reason: unknown) {
      setCreateError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSubmittingCreate(false);
    }
  };

  const handleClosePosition = async (positionId: number, event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const draft = closeDrafts[positionId];

    if (!draft || !draft.amount.trim() || submittingCloseId === positionId) {
      return;
    }

    setSubmittingCloseId(positionId);
    setCloseError(null);

    try {
      await closePortfolioPosition(positionId, {
        close_amount_in_currency: Number(draft.amount),
        close_currency_code: draft.currencyCode,
        close_amount_in_base: draft.currencyCode === user.base_currency_code || !draft.baseAmount.trim()
          ? undefined
          : Number(draft.baseAmount),
        closed_at: draft.closedAt || undefined,
        comment: draft.comment.trim() || undefined,
      });
      setCloseDrafts((prev) => {
        const nextDrafts = { ...prev };
        delete nextDrafts[positionId];
        return nextDrafts;
      });
      if (selectedPositionId === positionId) {
        await loadEventsForPosition(positionId);
      }
      await loadPortfolio();
    } catch (reason: unknown) {
      setCloseError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSubmittingCloseId(null);
    }
  };

  const handleOpenCloseForm = (position: PortfolioPosition) => {
    setCloseError(null);
    setCloseDrafts((prev) => (
      prev[position.id]
        ? prev
        : { ...prev, [position.id]: createInitialCloseDraft(position) }
    ));
  };

  const handleOpenIncomeForm = (position: PortfolioPosition) => {
    setIncomeError(null);
    setIncomeDrafts((prev) => (
      prev[position.id]
        ? prev
        : { ...prev, [position.id]: createInitialIncomeDraft(position) }
    ));
  };

  const handleCloseDraftChange = (
    positionId: number,
    patch: Partial<CloseDraft>,
  ) => {
    setCloseDrafts((prev) => ({
      ...prev,
      [positionId]: {
        ...(prev[positionId] ?? {
          amount: '',
          currencyCode: positions.find((position) => position.id === positionId)?.currency_code ?? user.base_currency_code,
          baseAmount: '',
          closedAt: todayIso(),
          comment: '',
        }),
        ...patch,
      },
    }));
  };

  const handleIncomeDraftChange = (
    positionId: number,
    patch: Partial<IncomeDraft>,
  ) => {
    setIncomeDrafts((prev) => ({
      ...prev,
      [positionId]: {
        ...(prev[positionId] ?? createInitialIncomeDraft(
          positions.find((position) => position.id === positionId) ?? {
            id: positionId,
            investment_account_id: 0,
            investment_account_name: '',
            investment_account_owner_type: 'user',
            investment_account_owner_name: '',
            asset_type_code: 'security',
            title: '',
            status: 'open',
            amount_in_currency: 0,
            currency_code: user.base_currency_code,
            opened_at: todayIso(),
            metadata: {},
            created_by_user_id: user.user_id,
            created_at: '',
          },
        )),
        ...patch,
      },
    }));
  };

  const handleRecordIncome = async (position: PortfolioPosition, event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const draft = incomeDrafts[position.id];

    if (!draft || !draft.amount.trim() || submittingIncomeId === position.id) {
      return;
    }

    setSubmittingIncomeId(position.id);
    setIncomeError(null);

    try {
      await recordPortfolioIncome(position.id, {
        amount: Number(draft.amount),
        currency_code: draft.currencyCode,
        amount_in_base: draft.currencyCode === user.base_currency_code || !draft.baseAmount.trim()
          ? undefined
          : Number(draft.baseAmount),
        income_kind: draft.incomeKind,
        received_at: draft.receivedAt || undefined,
        comment: draft.comment.trim() || undefined,
      });
      setIncomeDrafts((prev) => {
        const nextDrafts = { ...prev };
        delete nextDrafts[position.id];
        return nextDrafts;
      });
      if (selectedPositionId === position.id) {
        await loadEventsForPosition(position.id);
      }
      await loadPortfolio();
    } catch (reason: unknown) {
      setIncomeError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSubmittingIncomeId(null);
    }
  };

  if (loading) {
    return (
      <div className="status-screen">
        <h1>Загрузка...</h1>
        <p>Собираем инвестиционные счета и позиции</p>
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
            <article className="balance-card">
              <div className="balance-card__head">
                <span className="pill">OPEN</span>
                <span className="tag tag--neutral">{openPositions.length} позиций</span>
              </div>
              <span className="balance-card__amount">{openPositions.length}</span>
              <span className="balance-card__sub">Открытых ручных позиций в портфеле</span>
            </article>
            <article className="balance-card">
              <div className="balance-card__head">
                <span className="pill">CLOSED</span>
                <span className="tag tag--neutral">{closedPositions.length} позиций</span>
              </div>
              <span className="balance-card__amount">{closedPositions.length}</span>
              <span className="balance-card__sub">Закрытых позиций с сохраненной историей</span>
            </article>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="section__header">
          <h2 className="section__title">Новая позиция</h2>
        </div>
        <div className="panel">
          {accounts.length === 0 ? (
            <p className="list-row__sub">
              Сначала создай инвестиционный счет в настройках и переведи на него деньги с главного экрана.
            </p>
          ) : (
            <form onSubmit={(event) => void handleCreatePosition(event)}>
              <div className="form-row">
                <select
                  className="input"
                  value={newInvestmentAccountId}
                  onChange={(event) => setNewInvestmentAccountId(event.target.value)}
                  disabled={submittingCreate}
                >
                  {accounts.map(({ account }) => (
                    <option key={account.id} value={account.id}>
                      {account.name} · {account.owner_type === 'family' ? 'семейный' : 'личный'}
                    </option>
                  ))}
                </select>

                <select
                  className="input"
                  value={newAssetTypeCode}
                  onChange={(event) => setNewAssetTypeCode(event.target.value as (typeof ASSET_TYPE_OPTIONS)[number]['value'])}
                  disabled={submittingCreate}
                >
                  {ASSET_TYPE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-row">
                <input
                  className="input"
                  type="text"
                  placeholder="Название позиции"
                  value={newTitle}
                  onChange={(event) => setNewTitle(event.target.value)}
                  disabled={submittingCreate}
                  style={{ flex: '1 1 280px' }}
                />
                <input
                  className="input"
                  type="text"
                  inputMode="decimal"
                  placeholder="Количество, если есть"
                  value={newQuantity}
                  onChange={(event) => setNewQuantity(event.target.value)}
                  disabled={submittingCreate}
                  style={{ width: 180 }}
                />
              </div>

              <div className="form-row">
                <input
                  className="input"
                  type="text"
                  inputMode="decimal"
                  placeholder="Сумма входа"
                  value={newAmount}
                  onChange={(event) => setNewAmount(event.target.value)}
                  disabled={submittingCreate}
                  style={{ width: 180 }}
                />
                <select
                  className="input"
                  value={newCurrencyCode}
                  onChange={(event) => setNewCurrencyCode(event.target.value)}
                  disabled={submittingCreate}
                >
                  {currencies.map((currency) => (
                    <option key={currency.code} value={currency.code}>
                      {currency.code}
                    </option>
                  ))}
                </select>
                <input
                  className="input"
                  type="date"
                  value={newOpenedAt}
                  onChange={(event) => setNewOpenedAt(event.target.value)}
                  disabled={submittingCreate}
                />
                <span className="list-row__sub">
                  Доступно: {formatAmount(selectedCurrencyBalance, newCurrencyCode)}
                </span>
              </div>

              <div className="form-row">
                <input
                  className="input"
                  type="text"
                  placeholder="Комментарий"
                  value={newComment}
                  onChange={(event) => setNewComment(event.target.value)}
                  disabled={submittingCreate}
                  style={{ flex: '1 1 320px' }}
                />
                <button className="btn btn--primary" type="submit" disabled={submittingCreate}>
                  {submittingCreate ? 'Сохраняем...' : 'Добавить позицию'}
                </button>
              </div>

              {createError && (
                <p style={{ color: 'var(--tag-out-fg)', fontSize: '0.85rem' }}>
                  {createError}
                </p>
              )}
            </form>
          )}
        </div>
      </section>

      <section className="section">
        <div className="section__header">
          <h2 className="section__title">Инвестиционные счета</h2>
        </div>
        <div className="panel">
          {accounts.length === 0 ? (
            <p className="list-row__sub">Инвестиционных счетов пока нет.</p>
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
          <h2 className="section__title">Открытые позиции</h2>
        </div>
        <div className="panel">
          {openPositions.length === 0 ? (
            <p className="list-row__sub">Открытых позиций пока нет.</p>
          ) : (
            <div className="dashboard-budget-sections">
              {openPositions.map((position) => {
                const closeDraft = closeDrafts[position.id];
                const incomeDraft = incomeDrafts[position.id];
                const events = eventsByPosition[position.id] ?? [];

                return (
                  <div className="dashboard-budget-section" key={position.id}>
                    <div className="dashboard-budget-section__header">
                      <div>
                        <div className="section__eyebrow">
                          {assetTypeLabel(position.asset_type_code)} · {position.investment_account_name}
                        </div>
                        <div className="section__title" style={{ fontSize: '1rem' }}>{position.title}</div>
                      </div>
                      <span className="tag tag--neutral">{position.investment_account_owner_name}</span>
                    </div>

                    <div className="bank-detail-list">
                      <div className="bank-detail-row">
                        <div className="bank-detail-row__main">
                          <span className="pill">{position.currency_code}</span>
                          <strong className="bank-detail-row__amount">
                            {formatAmount(position.amount_in_currency, position.currency_code)}
                          </strong>
                        </div>
                        <div className="bank-detail-row__sub">
                          Дата входа: {formatDateLabel(position.opened_at)}
                          {position.quantity ? ` · Количество: ${position.quantity}` : ''}
                        </div>
                      </div>
                    </div>

                    {position.comment && (
                      <p className="list-row__sub" style={{ marginTop: 12 }}>
                        {position.comment}
                      </p>
                    )}

                    <div className="form-row">
                      <button
                        className="btn btn--primary"
                        type="button"
                        onClick={() => handleOpenCloseForm(position)}
                      >
                        Закрыть позицию
                      </button>
                      {canRecordPositionIncome(position) && (
                        <button
                          className="btn"
                          type="button"
                          onClick={() => handleOpenIncomeForm(position)}
                        >
                          Начислить доход
                        </button>
                      )}
                      <button
                        className="btn"
                        type="button"
                        onClick={() => void handleToggleEvents(position.id)}
                      >
                        {selectedPositionId === position.id ? 'Скрыть события' : 'Показать события'}
                      </button>
                    </div>

                    {closeDraft && (
                      <form onSubmit={(event) => void handleClosePosition(position.id, event)}>
                        <div className="form-row">
                          <input
                            className="input"
                            type="text"
                            inputMode="decimal"
                            placeholder="Сумма выхода"
                            value={closeDraft.amount}
                            onChange={(event) => handleCloseDraftChange(position.id, { amount: event.target.value })}
                            disabled={submittingCloseId === position.id}
                            style={{ width: 180 }}
                          />
                          <select
                            className="input"
                            value={closeDraft.currencyCode}
                            onChange={(event) => handleCloseDraftChange(position.id, { currencyCode: event.target.value })}
                            disabled={submittingCloseId === position.id}
                          >
                            {currencies.map((currency) => (
                              <option key={currency.code} value={currency.code}>
                                {currency.code}
                              </option>
                            ))}
                          </select>
                          <input
                            className="input"
                            type="date"
                            value={closeDraft.closedAt}
                            onChange={(event) => handleCloseDraftChange(position.id, { closedAt: event.target.value })}
                            disabled={submittingCloseId === position.id}
                          />
                        </div>
                        {closeDraft.currencyCode !== user.base_currency_code && (
                          <div className="form-row">
                            <input
                              className="input"
                              type="text"
                              inputMode="decimal"
                              placeholder={`Историческая стоимость в ${user.base_currency_code}`}
                              value={closeDraft.baseAmount}
                              onChange={(event) => handleCloseDraftChange(position.id, { baseAmount: event.target.value })}
                              disabled={submittingCloseId === position.id}
                              style={{ width: 260 }}
                            />
                            <span className="list-row__sub">
                              Нужна, чтобы вернуть валюту на счет с корректной себестоимостью.
                            </span>
                          </div>
                        )}
                        <div className="form-row">
                          <input
                            className="input"
                            type="text"
                            placeholder="Комментарий к закрытию"
                            value={closeDraft.comment}
                            onChange={(event) => handleCloseDraftChange(position.id, { comment: event.target.value })}
                            disabled={submittingCloseId === position.id}
                            style={{ flex: '1 1 280px' }}
                          />
                          <button
                            className="btn btn--primary"
                            type="submit"
                            disabled={submittingCloseId === position.id}
                          >
                            {submittingCloseId === position.id ? 'Закрываем...' : 'Подтвердить закрытие'}
                          </button>
                        </div>
                      </form>
                    )}

                    {incomeDraft && (
                      <form onSubmit={(event) => void handleRecordIncome(position, event)}>
                        <div className="form-row">
                          <input
                            className="input"
                            type="text"
                            inputMode="decimal"
                            placeholder={position.asset_type_code === 'deposit' ? 'Сумма процентов' : 'Сумма дивидендов'}
                            value={incomeDraft.amount}
                            onChange={(event) => handleIncomeDraftChange(position.id, { amount: event.target.value })}
                            disabled={submittingIncomeId === position.id}
                            style={{ width: 180 }}
                          />
                          <select
                            className="input"
                            value={incomeDraft.currencyCode}
                            onChange={(event) => handleIncomeDraftChange(position.id, { currencyCode: event.target.value })}
                            disabled={submittingIncomeId === position.id}
                          >
                            {currencies.map((currency) => (
                              <option key={currency.code} value={currency.code}>
                                {currency.code}
                              </option>
                            ))}
                          </select>
                          <select
                            className="input"
                            value={incomeDraft.incomeKind}
                            onChange={(event) => handleIncomeDraftChange(position.id, { incomeKind: event.target.value })}
                            disabled={submittingIncomeId === position.id}
                          >
                            {position.asset_type_code === 'deposit' ? (
                              <>
                                <option value="interest">Проценты</option>
                                <option value="other">Другой доход</option>
                              </>
                            ) : (
                              <>
                                <option value="dividend">Дивиденды</option>
                                <option value="coupon">Купон</option>
                                <option value="other">Другой доход</option>
                              </>
                            )}
                          </select>
                          <input
                            className="input"
                            type="date"
                            value={incomeDraft.receivedAt}
                            onChange={(event) => handleIncomeDraftChange(position.id, { receivedAt: event.target.value })}
                            disabled={submittingIncomeId === position.id}
                          />
                        </div>
                        {incomeDraft.currencyCode !== user.base_currency_code && (
                          <div className="form-row">
                            <input
                              className="input"
                              type="text"
                              inputMode="decimal"
                              placeholder={`Историческая стоимость в ${user.base_currency_code}`}
                              value={incomeDraft.baseAmount}
                              onChange={(event) => handleIncomeDraftChange(position.id, { baseAmount: event.target.value })}
                              disabled={submittingIncomeId === position.id}
                              style={{ width: 260 }}
                            />
                            <span className="list-row__sub">
                              Нужна для сохранения себестоимости дохода в базовой валюте.
                            </span>
                          </div>
                        )}
                        <div className="form-row">
                          <input
                            className="input"
                            type="text"
                            placeholder="Комментарий к доходу"
                            value={incomeDraft.comment}
                            onChange={(event) => handleIncomeDraftChange(position.id, { comment: event.target.value })}
                            disabled={submittingIncomeId === position.id}
                            style={{ flex: '1 1 280px' }}
                          />
                          <button
                            className="btn btn--primary"
                            type="submit"
                            disabled={submittingIncomeId === position.id}
                          >
                            {submittingIncomeId === position.id ? 'Начисляем...' : 'Подтвердить доход'}
                          </button>
                        </div>
                      </form>
                    )}

                    {selectedPositionId === position.id && (
                      <div style={{ marginTop: 12 }}>
                        {eventsError && (
                          <p style={{ color: 'var(--tag-out-fg)', fontSize: '0.85rem' }}>
                            {eventsError}
                          </p>
                        )}
                        {eventsLoadingId === position.id ? (
                          <p className="list-row__sub">Загружаем события...</p>
                        ) : (
                          <ul className="bank-detail-list">
                            {events.map((item) => (
                              <li className="bank-detail-row" key={item.id}>
                                <div className="bank-detail-row__main">
                                  <span className="pill">{getEventLabel(item)}</span>
                                  <strong className="bank-detail-row__amount">
                                    {item.amount && item.currency_code
                                      ? formatAmount(item.amount, item.currency_code)
                                      : 'Без суммы'}
                                  </strong>
                                </div>
                                <div className="bank-detail-row__sub">
                                  {formatDateLabel(item.event_at)}
                                  {item.quantity ? ` · Количество: ${item.quantity}` : ''}
                                  {item.linked_operation_id ? ` · Операция #${item.linked_operation_id}` : ''}
                                  {item.comment ? ` · ${item.comment}` : ''}
                                </div>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {closeError && (
            <p style={{ color: 'var(--tag-out-fg)', fontSize: '0.85rem', marginTop: 12 }}>
              {closeError}
            </p>
          )}

          {incomeError && (
            <p style={{ color: 'var(--tag-out-fg)', fontSize: '0.85rem', marginTop: 12 }}>
              {incomeError}
            </p>
          )}
        </div>
      </section>

      <section className="section">
        <div className="section__header">
          <h2 className="section__title">Закрытые позиции</h2>
        </div>
        <div className="panel">
          {closedPositions.length === 0 ? (
            <p className="list-row__sub">Закрытых позиций пока нет.</p>
          ) : (
            <ul className="bank-detail-list">
              {closedPositions.map((position) => (
                <li className="bank-detail-row" key={position.id}>
                  <div className="bank-detail-row__main">
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <span className="pill">{position.currency_code}</span>
                        <strong className="bank-detail-row__amount">{position.title}</strong>
                        <span className="tag tag--neutral">{assetTypeLabel(position.asset_type_code)}</span>
                      </div>
                      <div className="bank-detail-row__sub">
                        {position.investment_account_name} · вход {formatAmount(position.amount_in_currency, position.currency_code)}
                        {position.close_amount_in_currency && position.close_currency_code
                          ? ` · выход ${formatAmount(position.close_amount_in_currency, position.close_currency_code)}`
                          : ''}
                        {position.closed_at ? ` · закрыта ${formatDateLabel(position.closed_at)}` : ''}
                      </div>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section className="section">
        <div className="section__header">
          <h2 className="section__title">Следующий шаг</h2>
        </div>
        <div className="panel">
          <p className="list-row__sub">
            Базовые ручные позиции, закрытие и начисление дохода уже готовы. Следом логично добавить
            пополнение позиции без закрытия и отдельную инвестиционную вкладку в истории операций.
          </p>
        </div>
      </section>
    </>
  );
}
