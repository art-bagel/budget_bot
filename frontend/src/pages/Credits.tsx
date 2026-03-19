import { type FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import {
  createCreditAccount,
  fetchBankAccountSnapshot,
  fetchBankAccounts,
  fetchCurrencies,
  transferBetweenAccounts,
} from '../api';
import type {
  BankAccount,
  Currency,
  DashboardBankBalance,
  UserContext,
} from '../types';
import { formatAmount } from '../utils/format';

type CreditKind = 'loan' | 'credit_card' | 'mortgage';

const CREDIT_KIND_OPTIONS: { value: CreditKind; label: string }[] = [
  { value: 'mortgage', label: 'Ипотека' },
  { value: 'loan', label: 'Кредит' },
  { value: 'credit_card', label: 'Кредитная карта' },
];

function creditKindLabel(kind: CreditKind | null | undefined): string {
  return CREDIT_KIND_OPTIONS.find((o) => o.value === kind)?.label ?? '—';
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

interface CreditWithBalances {
  account: BankAccount;
  balances: DashboardBankBalance[];
}

interface RepayDraft {
  amount: string;
  currencyCode: string;
  fromAccountId: string;
  comment: string;
}

// Balances are negative for credit accounts (debt = negative balance)
function accountDebt(balances: { historical_cost_in_base: number }[]): number {
  return Math.max(0, -balances.reduce((s, b) => s + b.historical_cost_in_base, 0));
}

function totalDebtInBase(credits: CreditWithBalances[]): number {
  return credits.reduce((sum, { balances }) => sum + accountDebt(balances), 0);
}

function debtByKind(credits: CreditWithBalances[], kind: CreditKind): number {
  return credits
    .filter(({ account }) => account.credit_kind === kind)
    .reduce((sum, { balances }) => sum + accountDebt(balances), 0);
}

export default function Credits({ user }: { user: UserContext }) {
  const [credits, setCredits] = useState<CreditWithBalances[]>([]);
  const [cashAccounts, setCashAccounts] = useState<BankAccount[]>([]);
  const [currencies, setCurrencies] = useState<Currency[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Selected credit for detail panel
  const [selectedId, setSelectedId] = useState<number | null>(null);

  // Repay form
  const [repayDrafts, setRepayDrafts] = useState<Record<number, RepayDraft>>({});
  const [submittingRepayId, setSubmittingRepayId] = useState<number | null>(null);
  const [repayError, setRepayError] = useState<string | null>(null);

  // New credit form
  const [showNewForm, setShowNewForm] = useState(false);
  const [newName, setNewName] = useState('');
  const [newKind, setNewKind] = useState<CreditKind>('loan');
  const [newCurrency, setNewCurrency] = useState(user.base_currency_code);
  const [newInitialDebt, setNewInitialDebt] = useState('');
  const [newOwnerType, setNewOwnerType] = useState<'user' | 'family'>('user');
  const [newInterestRate, setNewInterestRate] = useState('');
  const [newPaymentDay, setNewPaymentDay] = useState('');
  const [newStartedAt, setNewStartedAt] = useState('');
  const [newEndsAt, setNewEndsAt] = useState('');
  const [newCreditLimit, setNewCreditLimit] = useState('');
  const [newTargetAccountId, setNewTargetAccountId] = useState('');
  const [newProvider, setNewProvider] = useState('');
  const [submittingNew, setSubmittingNew] = useState(false);
  const [newError, setNewError] = useState<string | null>(null);

  const modalRef = useRef<HTMLDivElement>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [loadedCredits, loadedCash, loadedCurrencies] = await Promise.all([
        fetchBankAccounts('credit'),
        fetchBankAccounts('cash'),
        fetchCurrencies(),
      ]);
      const snapshots = await Promise.all(
        loadedCredits.map(async (account) => ({
          account,
          balances: await fetchBankAccountSnapshot(account.id),
        })),
      );
      setCredits(snapshots);
      setCashAccounts(loadedCash);
      setCurrencies(loadedCurrencies);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка загрузки');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const selectedCredit = useMemo(
    () => credits.find(({ account }) => account.id === selectedId) ?? null,
    [credits, selectedId],
  );

  const handleOpenDetail = (id: number) => {
    setRepayError(null);
    setSelectedId(id);
    setRepayDrafts((prev) => {
      if (prev[id]) return prev;
      const credit = credits.find(({ account }) => account.id === id);
      const currency = credit?.account.provider_name
        ? credit.balances[0]?.currency_code ?? user.base_currency_code
        : user.base_currency_code;
      return {
        ...prev,
        [id]: { amount: '', currencyCode: currency, fromAccountId: String(cashAccounts[0]?.id ?? ''), comment: '' },
      };
    });
  };

  const handleCloseDetail = () => setSelectedId(null);

  const handleRepay = async (e: FormEvent, creditId: number) => {
    e.preventDefault();
    const draft = repayDrafts[creditId];
    if (!draft || !draft.amount.trim() || !draft.fromAccountId || submittingRepayId === creditId) return;

    setSubmittingRepayId(creditId);
    setRepayError(null);
    try {
      await transferBetweenAccounts({
        from_account_id: Number(draft.fromAccountId),
        to_account_id: creditId,
        currency_code: draft.currencyCode,
        amount: Number(draft.amount),
        comment: draft.comment.trim() || undefined,
      });
      setRepayDrafts((prev) => {
        const next = { ...prev };
        delete next[creditId];
        return next;
      });
      await load();
    } catch (err) {
      setRepayError(err instanceof Error ? err.message : 'Ошибка погашения');
    } finally {
      setSubmittingRepayId(null);
    }
  };

  const handleCreateCredit = async () => {
    if (!newName.trim() || submittingNew) return;
    setSubmittingNew(true);
    setNewError(null);
    try {
      await createCreditAccount({
        name: newName.trim(),
        credit_kind: newKind,
        currency_code: newCurrency,
        initial_debt: newInitialDebt.trim() ? Number(newInitialDebt) : undefined,
        target_account_id: newTargetAccountId ? Number(newTargetAccountId) : undefined,
        owner_type: newOwnerType,
        interest_rate: newInterestRate.trim() ? Number(newInterestRate) : undefined,
        payment_day: newPaymentDay.trim() ? Number(newPaymentDay) : undefined,
        credit_started_at: newStartedAt.trim() || undefined,
        credit_ends_at: newEndsAt.trim() || undefined,
        credit_limit: newCreditLimit.trim() ? Number(newCreditLimit) : undefined,
        provider_name: newProvider.trim() || undefined,
      });
      setShowNewForm(false);
      setNewName('');
      setNewKind('loan');
      setNewCurrency(user.base_currency_code);
      setNewInitialDebt('');
      setNewInterestRate('');
      setNewPaymentDay('');
      setNewStartedAt('');
      setNewEndsAt('');
      setNewCreditLimit('');
      setNewTargetAccountId('');
      setNewProvider('');
      await load();
    } catch (err) {
      setNewError(err instanceof Error ? err.message : 'Ошибка создания');
    } finally {
      setSubmittingNew(false);
    }
  };

  const totalDebt = totalDebtInBase(credits);
  const mortgageDebt = debtByKind(credits, 'mortgage');
  const loanDebt = debtByKind(credits, 'loan');
  const cardDebt = debtByKind(credits, 'credit_card');

  const hasMortgage = credits.some(({ account }) => account.credit_kind === 'mortgage');
  const hasLoans = credits.some(({ account }) => account.credit_kind === 'loan');
  const hasCards = credits.some(({ account }) => account.credit_kind === 'credit_card');

  const hasTerm = (kind: CreditKind) => kind === 'loan' || kind === 'mortgage';

  const getCreditDebt = ({ balances }: CreditWithBalances) => accountDebt(balances);

  if (loading) {
    return (
      <div className="status-screen">
        <h1>Загрузка...</h1>
        <p>Загружаем кредитные счета</p>
      </div>
    );
  }

  return (
    <>
      <h1 className="page-title">Кредиты</h1>

      {/* Hero card */}
      <article className="hero-card">
        <span className="hero-card__label">Общий долг</span>
        <strong className="hero-card__value">
          {formatAmount(totalDebt, user.base_currency_code)}
        </strong>
        {credits.length > 0 && (
          <div className="hero-card__breakdown">
            {hasMortgage && (
              <div className="hero-card__breakdown-row">
                <span>Ипотека</span>
                <strong>{formatAmount(mortgageDebt, user.base_currency_code)}</strong>
              </div>
            )}
            {hasLoans && (
              <div className="hero-card__breakdown-row">
                <span>Кредиты</span>
                <strong>{formatAmount(loanDebt, user.base_currency_code)}</strong>
              </div>
            )}
            {hasCards && (
              <div className="hero-card__breakdown-row">
                <span>Кредитные карты</span>
                <strong>{formatAmount(cardDebt, user.base_currency_code)}</strong>
              </div>
            )}
          </div>
        )}
      </article>

      {error && <p style={{ color: 'var(--tag-out-fg)', marginBottom: 12 }}>{error}</p>}

      {/* Credit list */}
      <section className="dashboard-section">
        <div className="section__header">
          <div className="section__eyebrow">Счета</div>
          <button
            className="btn btn--icon btn--primary"
            type="button"
            onClick={() => setShowNewForm(true)}
          >
            +
          </button>
        </div>

        {credits.length === 0 ? (
          <p className="list-row__sub">Кредитных счетов пока нет.</p>
        ) : (
          <div className="dashboard-budget-sections">
            {(['mortgage', 'loan', 'credit_card'] as CreditKind[])
              .filter((kind) => credits.some(({ account }) => account.credit_kind === kind))
              .map((kind) => (
                <div className="dashboard-budget-section" key={kind}>
                  <div className="portfolio-position-section-title">{creditKindLabel(kind)}</div>
                  <div className="portfolio-position-grid">
                    {credits
                      .filter(({ account }) => account.credit_kind === kind)
                      .map((item) => {
                        const debt = getCreditDebt(item);
                        return (
                          <button
                            key={item.account.id}
                            className="portfolio-position-card"
                            type="button"
                            onClick={() => handleOpenDetail(item.account.id)}
                          >
                            <div className="portfolio-position-card__head">
                              <div className="portfolio-position-card__left">
                                {item.account.provider_name && (
                                  <span className="portfolio-position-card__ticker">
                                    {item.account.provider_name}
                                  </span>
                                )}
                                <div className="portfolio-position-card__title">{item.account.name}</div>
                              </div>
                              <div className="portfolio-position-card__right">
                                <div className="portfolio-position-card__amount portfolio-position-card__pnl--neg">
                                  −{formatAmount(debt, user.base_currency_code)}
                                </div>
                              </div>
                            </div>
                            <div className="portfolio-position-card__sub-row">
                              <span>
                                {item.account.interest_rate != null
                                  ? `${item.account.interest_rate}% годовых`
                                  : null}
                                {item.account.interest_rate != null && (item.account.credit_ends_at || item.account.payment_day != null)
                                  ? ' · '
                                  : null}
                                {item.account.payment_day != null
                                  ? `платёж ${item.account.payment_day}-го`
                                  : null}
                                {item.account.payment_day != null && item.account.credit_ends_at
                                  ? ' · '
                                  : null}
                                {item.account.credit_ends_at
                                  ? `до ${new Date(item.account.credit_ends_at).toLocaleDateString('ru-RU', { month: 'short', year: 'numeric' })}`
                                  : null}
                              </span>
                            </div>
                          </button>
                        );
                      })}
                  </div>
                </div>
              ))}
          </div>
        )}
      </section>

      {/* Detail modal */}
      {selectedCredit && (
        <div className="modal-backdrop" onClick={handleCloseDetail}>
          <div
            ref={modalRef}
            className="modal-card"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <div>
                <div className="section__eyebrow">{creditKindLabel(selectedCredit.account.credit_kind)}</div>
                <div className="section__title">{selectedCredit.account.name}</div>
              </div>
            </div>
            <div className="modal-body">
              <div className="portfolio-position-detail">

                {/* Debt info */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
                  {selectedCredit.balances.map((b) => (
                    <div key={b.currency_code} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
                      <span className="settings-row__sub">Остаток долга <span className="pill">{b.currency_code}</span></span>
                      <strong style={{ color: 'var(--tag-out-fg)' }}>
                        −{formatAmount(Math.abs(b.amount), b.currency_code)}
                      </strong>
                    </div>
                  ))}
                  {selectedCredit.account.credit_kind === 'credit_card' && selectedCredit.account.credit_limit != null && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                      <span className="settings-row__sub">Использовано</span>
                      <span>
                        {formatAmount(getCreditDebt(selectedCredit), user.base_currency_code)}
                        {' из '}
                        {formatAmount(selectedCredit.account.credit_limit, user.base_currency_code)}
                      </span>
                    </div>
                  )}
                  {selectedCredit.account.interest_rate != null && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                      <span className="settings-row__sub">Ставка</span>
                      <span>{selectedCredit.account.interest_rate}% годовых</span>
                    </div>
                  )}
                  {selectedCredit.account.payment_day != null && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                      <span className="settings-row__sub">Дата платежа</span>
                      <span>{selectedCredit.account.payment_day}-е число каждого месяца</span>
                    </div>
                  )}
                  {selectedCredit.account.credit_started_at && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                      <span className="settings-row__sub">Срок</span>
                      <span>
                        {new Date(selectedCredit.account.credit_started_at).toLocaleDateString('ru-RU', { day: '2-digit', month: 'short', year: 'numeric' })}
                        {selectedCredit.account.credit_ends_at
                          ? ` — ${new Date(selectedCredit.account.credit_ends_at).toLocaleDateString('ru-RU', { day: '2-digit', month: 'short', year: 'numeric' })}`
                          : null}
                      </span>
                    </div>
                  )}
                </div>

                <hr style={{ opacity: 0.15, marginBottom: 16 }} />

                {/* Repay form */}
                <div className="section__header" style={{ marginBottom: 8 }}>
                  <div className="section__eyebrow">Погашение</div>
                </div>
                <form onSubmit={(e) => void handleRepay(e, selectedCredit.account.id)}>
                  <div className="form-row">
                    <input
                      className="input"
                      type="text"
                      inputMode="decimal"
                      placeholder="Сумма погашения"
                      value={repayDrafts[selectedCredit.account.id]?.amount ?? ''}
                      onChange={(e) => setRepayDrafts((prev) => ({
                        ...prev,
                        [selectedCredit.account.id]: { ...prev[selectedCredit.account.id], amount: e.target.value },
                      }))}
                      disabled={submittingRepayId === selectedCredit.account.id}
                      style={{ width: 160 }}
                    />
                    <select
                      className="input"
                      value={repayDrafts[selectedCredit.account.id]?.currencyCode ?? user.base_currency_code}
                      onChange={(e) => setRepayDrafts((prev) => ({
                        ...prev,
                        [selectedCredit.account.id]: { ...prev[selectedCredit.account.id], currencyCode: e.target.value },
                      }))}
                      disabled={submittingRepayId === selectedCredit.account.id}
                    >
                      {currencies.map((c) => (
                        <option key={c.code} value={c.code}>{c.code}</option>
                      ))}
                    </select>
                  </div>
                  <div className="form-row" style={{ marginTop: 8 }}>
                    <select
                      className="input"
                      value={repayDrafts[selectedCredit.account.id]?.fromAccountId ?? ''}
                      onChange={(e) => setRepayDrafts((prev) => ({
                        ...prev,
                        [selectedCredit.account.id]: { ...prev[selectedCredit.account.id], fromAccountId: e.target.value },
                      }))}
                      disabled={submittingRepayId === selectedCredit.account.id}
                      style={{ flex: '1 1 220px' }}
                    >
                      <option value="">Выберите счёт для списания</option>
                      {cashAccounts.map((acc) => (
                        <option key={acc.id} value={acc.id}>{acc.name}</option>
                      ))}
                    </select>
                  </div>
                  <div className="form-row" style={{ marginTop: 8 }}>
                    <input
                      className="input"
                      type="text"
                      placeholder="Комментарий"
                      value={repayDrafts[selectedCredit.account.id]?.comment ?? ''}
                      onChange={(e) => setRepayDrafts((prev) => ({
                        ...prev,
                        [selectedCredit.account.id]: { ...prev[selectedCredit.account.id], comment: e.target.value },
                      }))}
                      disabled={submittingRepayId === selectedCredit.account.id}
                      style={{ flex: '1 1 220px' }}
                    />
                    <button
                      className="btn btn--primary"
                      type="submit"
                      disabled={submittingRepayId === selectedCredit.account.id}
                    >
                      {submittingRepayId === selectedCredit.account.id ? 'Погашаем...' : 'Погасить'}
                    </button>
                  </div>
                  {repayError && (
                    <p style={{ color: 'var(--tag-out-fg)', fontSize: '0.85rem', marginTop: 8 }}>{repayError}</p>
                  )}
                </form>
              </div>
            </div>
            <div className="modal-actions">
              <div className="action-pill">
                <button className="action-pill__cancel" type="button" onClick={handleCloseDetail}>
                  Закрыть
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* New credit modal */}
      {showNewForm && (
        <div className="modal-backdrop" onClick={() => !submittingNew && setShowNewForm(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="section__title">Новый кредитный счёт</div>
            </div>
            <div className="modal-body">
              <form onSubmit={(e) => { e.preventDefault(); void handleCreateCredit(); }}>
                <div className="form-row">
                  <select
                    className="input"
                    value={newKind}
                    onChange={(e) => setNewKind(e.target.value as CreditKind)}
                    disabled={submittingNew}
                  >
                    {CREDIT_KIND_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </div>
                <div className="form-row" style={{ marginTop: 8 }}>
                  <input
                    className="input"
                    type="text"
                    placeholder="Название (например, Ипотека Сбербанк)"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    disabled={submittingNew}
                    style={{ flex: '1 1 260px' }}
                    autoFocus
                  />
                </div>
                <div className="form-row" style={{ marginTop: 8 }}>
                  <input
                    className="input"
                    type="text"
                    inputMode="decimal"
                    placeholder="Сумма долга"
                    value={newInitialDebt}
                    onChange={(e) => setNewInitialDebt(e.target.value)}
                    disabled={submittingNew}
                    style={{ width: 160 }}
                  />
                  <select
                    className="input"
                    value={newCurrency}
                    onChange={(e) => setNewCurrency(e.target.value)}
                    disabled={submittingNew}
                  >
                    {currencies.map((c) => (
                      <option key={c.code} value={c.code}>{c.code}</option>
                    ))}
                  </select>
                </div>
                <div className="form-row" style={{ marginTop: 8 }}>
                  <input
                    className="input"
                    type="text"
                    inputMode="decimal"
                    placeholder="Процентная ставка, % годовых"
                    value={newInterestRate}
                    onChange={(e) => setNewInterestRate(e.target.value)}
                    disabled={submittingNew}
                    style={{ width: 190 }}
                  />
                  <input
                    className="input"
                    type="text"
                    inputMode="numeric"
                    placeholder="День платежа (1–31)"
                    value={newPaymentDay}
                    onChange={(e) => setNewPaymentDay(e.target.value.replace(/\D/g, ''))}
                    disabled={submittingNew}
                    style={{ width: 160 }}
                  />
                </div>
                {newKind === 'credit_card' && (
                  <div className="form-row" style={{ marginTop: 8 }}>
                    <input
                      className="input"
                      type="text"
                      inputMode="decimal"
                      placeholder="Кредитный лимит"
                      value={newCreditLimit}
                      onChange={(e) => setNewCreditLimit(e.target.value)}
                      disabled={submittingNew}
                      style={{ flex: '1 1 200px' }}
                    />
                  </div>
                )}
                {hasTerm(newKind) && (
                  <div className="form-row" style={{ marginTop: 8 }}>
                    <select
                      className="input"
                      value={newTargetAccountId}
                      onChange={(e) => setNewTargetAccountId(e.target.value)}
                      disabled={submittingNew}
                      style={{ flex: 1 }}
                    >
                      <option value="">Не зачислять на счёт</option>
                      {cashAccounts.map((a) => (
                        <option key={a.id} value={a.id}>{a.name}</option>
                      ))}
                    </select>
                  </div>
                )}
                {hasTerm(newKind) && (
                  <div className="form-row" style={{ marginTop: 8, gap: 8 }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1 }}>
                      <label className="settings-row__sub" style={{ fontSize: '0.75rem' }}>Дата начала</label>
                      <input
                        className="input"
                        type="date"
                        value={newStartedAt}
                        onChange={(e) => setNewStartedAt(e.target.value)}
                        disabled={submittingNew}
                        style={{ width: '100%' }}
                      />
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1 }}>
                      <label className="settings-row__sub" style={{ fontSize: '0.75rem' }}>Дата окончания</label>
                      <input
                        className="input"
                        type="date"
                        value={newEndsAt}
                        onChange={(e) => setNewEndsAt(e.target.value)}
                        disabled={submittingNew}
                        style={{ width: '100%' }}
                      />
                    </div>
                  </div>
                )}
                <div className="form-row" style={{ marginTop: 8 }}>
                  <input
                    className="input"
                    type="text"
                    placeholder="Банк / провайдер (необязательно)"
                    value={newProvider}
                    onChange={(e) => setNewProvider(e.target.value)}
                    disabled={submittingNew}
                    style={{ flex: '1 1 260px' }}
                  />
                </div>
                {newError && (
                  <p style={{ color: 'var(--tag-out-fg)', fontSize: '0.85rem', marginTop: 8 }}>{newError}</p>
                )}
              </form>
            </div>
            <div className="modal-actions">
              <div className="action-pill">
                <button
                  className="action-pill__cancel"
                  type="button"
                  disabled={submittingNew}
                  onClick={() => setShowNewForm(false)}
                >
                  Отмена
                </button>
                <button
                  className="action-pill__confirm"
                  type="button"
                  disabled={submittingNew || !newName.trim()}
                  onClick={() => void handleCreateCredit()}
                >
                  {submittingNew ? 'Создаём...' : 'Создать'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
