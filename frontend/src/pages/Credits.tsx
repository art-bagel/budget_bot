import { type FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import {
  archiveCreditAccount,
  createCreditAccount,
  fetchCreditAccountSchedule,
  fetchCreditAccountSummary,
  fetchBankAccountSnapshot,
  fetchBankAccounts,
  fetchCurrencies,
  repayCreditAccount,
  transferBetweenAccounts,
  updateCreditAccount,
} from '../api';
import type {
  BankAccount,
  CreditAccountSummary,
  CreditScheduleItem,
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

function parseDecimalInput(value: string): number | null {
  const normalized = value.trim().replace(',', '.');
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
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
  paymentAt: string;
}

interface CreditEditDraft {
  name: string;
  creditLimit: string;
  interestRate: string;
  paymentDay: string;
  creditStartedAt: string;
  creditEndsAt: string;
  providerName: string;
}

function isTermCredit(kind: CreditKind | null | undefined): boolean {
  return kind === 'loan' || kind === 'mortgage';
}

function buildCreditEditDraft(account: BankAccount): CreditEditDraft {
  return {
    name: account.name ?? '',
    creditLimit: account.credit_limit != null ? String(account.credit_limit) : '',
    interestRate: account.interest_rate != null ? String(account.interest_rate) : '',
    paymentDay: account.payment_day != null ? String(account.payment_day) : '',
    creditStartedAt: account.credit_started_at ?? '',
    creditEndsAt: account.credit_ends_at ?? '',
    providerName: account.provider_name ?? '',
  };
}

function buildRepayDraft(
  credit: CreditWithBalances | null,
  cashAccounts: BankAccount[],
  baseCurrencyCode: string,
): RepayDraft {
  const currencyCode = credit?.balances[0]?.currency_code ?? baseCurrencyCode;
  return {
    amount: '',
    currencyCode,
    fromAccountId: String(cashAccounts[0]?.id ?? ''),
    comment: '',
    paymentAt: todayIso(),
  };
}

function getMissingTermConfigFields(
  summary: CreditAccountSummary | null,
  account: BankAccount | null,
): string[] {
  const annualRate = summary?.annual_rate ?? account?.interest_rate ?? null;
  const paymentDay = summary?.payment_day ?? account?.payment_day ?? null;
  const creditEndsAt = summary?.credit_ends_at ?? account?.credit_ends_at ?? null;
  const missing: string[] = [];

  if (annualRate == null) missing.push('ставку');
  if (paymentDay == null) missing.push('день платежа');
  if (!creditEndsAt) missing.push('дату окончания');

  return missing;
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
  const [selectedSummary, setSelectedSummary] = useState<CreditAccountSummary | null>(null);
  const [selectedSummaryLoading, setSelectedSummaryLoading] = useState(false);
  const [selectedSummaryError, setSelectedSummaryError] = useState<string | null>(null);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [scheduleLoading, setScheduleLoading] = useState(false);
  const [scheduleError, setScheduleError] = useState<string | null>(null);
  const [scheduleItems, setScheduleItems] = useState<CreditScheduleItem[]>([]);
  const [selectedScheduleYear, setSelectedScheduleYear] = useState<number | null>(null);
  const [editingCredit, setEditingCredit] = useState(false);
  const [editDraft, setEditDraft] = useState<CreditEditDraft | null>(null);
  const [savingCredit, setSavingCredit] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  // Repay form
  const [repayDrafts, setRepayDrafts] = useState<Record<number, RepayDraft>>({});
  const [submittingRepayId, setSubmittingRepayId] = useState<number | null>(null);
  const [repayError, setRepayError] = useState<string | null>(null);
  const [archiving, setArchiving] = useState(false);
  const [archiveError, setArchiveError] = useState<string | null>(null);

  // New credit form
  const [showNewForm, setShowNewForm] = useState(false);
  const [newName, setNewName] = useState('');
  const [newKind, setNewKind] = useState<CreditKind>('loan');
  const [newCurrency, setNewCurrency] = useState(user.base_currency_code);
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
    setArchiveError(null);
    setSelectedSummary(null);
    setSelectedSummaryError(null);
    setScheduleOpen(false);
    setScheduleItems([]);
    setScheduleError(null);
    setSelectedScheduleYear(null);
    setEditingCredit(false);
    setEditError(null);
    setSelectedId(id);
    setRepayDrafts((prev) => {
      if (prev[id]) return prev;
      const credit = credits.find(({ account }) => account.id === id);
      return {
        ...prev,
        [id]: buildRepayDraft(credit ?? null, cashAccounts, user.base_currency_code),
      };
    });
    const credit = credits.find(({ account }) => account.id === id);
    setEditDraft(credit ? buildCreditEditDraft(credit.account) : null);
  };

  const handleCloseDetail = () => {
    setSelectedId(null);
    setArchiveError(null);
    setSelectedSummary(null);
    setSelectedSummaryError(null);
    setScheduleOpen(false);
    setScheduleItems([]);
    setScheduleError(null);
    setSelectedScheduleYear(null);
    setEditingCredit(false);
    setEditDraft(null);
    setEditError(null);
  };

  useEffect(() => {
    if (!selectedCredit) return;
    if (!editingCredit) {
      setEditDraft(buildCreditEditDraft(selectedCredit.account));
      setEditError(null);
    }
  }, [editingCredit, selectedCredit]);

  useEffect(() => {
    if (!selectedCredit) return;
    setRepayDrafts((prev) => {
      if (prev[selectedCredit.account.id]) return prev;
      return {
        ...prev,
        [selectedCredit.account.id]: buildRepayDraft(selectedCredit, cashAccounts, user.base_currency_code),
      };
    });
  }, [cashAccounts, selectedCredit, user.base_currency_code]);

  useEffect(() => {
    if (!selectedCredit || !isTermCredit(selectedCredit.account.credit_kind)) {
      setSelectedSummary(null);
      setSelectedSummaryLoading(false);
      setSelectedSummaryError(null);
      return;
    }

    let cancelled = false;
    setSelectedSummaryLoading(true);
    setSelectedSummaryError(null);

    void fetchCreditAccountSummary(selectedCredit.account.id)
      .then((summary) => {
        if (cancelled) return;
        setSelectedSummary(summary);
      })
      .catch((err) => {
        if (cancelled) return;
        setSelectedSummary(null);
        setSelectedSummaryError(err instanceof Error ? err.message : 'Не удалось загрузить расчёт кредита');
      })
      .finally(() => {
        if (!cancelled) setSelectedSummaryLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedCredit]);

  const openSchedule = async () => {
    if (!selectedCredit || !isTermCredit(selectedCredit.account.credit_kind)) return;
    setScheduleOpen(true);
    setScheduleLoading(true);
    setScheduleError(null);
    try {
      const items = await fetchCreditAccountSchedule(selectedCredit.account.id);
      setScheduleItems(items);
      const currentYear = new Date().getFullYear();
      const years = Array.from(new Set(items.map((item) => new Date(item.scheduled_date).getFullYear())));
      setSelectedScheduleYear(
        years.includes(currentYear)
          ? currentYear
          : (items.length > 0 ? new Date(items[items.length - 1].scheduled_date).getFullYear() : null),
      );
    } catch (err) {
      setScheduleItems([]);
      setScheduleError(err instanceof Error ? err.message : 'Не удалось загрузить график платежей');
    } finally {
      setScheduleLoading(false);
    }
  };

  const handleArchive = async (creditId: number) => {
    if (archiving) return;
    setArchiving(true);
    setArchiveError(null);
    try {
      await archiveCreditAccount(creditId);
      setSelectedId(null);
      await load();
    } catch (err) {
      setArchiveError(err instanceof Error ? err.message : 'Ошибка архивирования');
    } finally {
      setArchiving(false);
    }
  };

  const handleSaveCredit = async (e: FormEvent) => {
    e.preventDefault();
    if (!selectedCredit || !editDraft || savingCredit) return;

    setSavingCredit(true);
    setEditError(null);
    const parsedInterestRate = parseDecimalInput(editDraft.interestRate);
    if (editDraft.interestRate.trim() && parsedInterestRate == null) {
      setEditError('Ставку нужно ввести числом, например 10,4');
      setSavingCredit(false);
      return;
    }
    try {
      await updateCreditAccount(selectedCredit.account.id, {
        name: editDraft.name.trim(),
        credit_limit: Number(editDraft.creditLimit),
        interest_rate: parsedInterestRate,
        payment_day: editDraft.paymentDay.trim() ? Number(editDraft.paymentDay) : null,
        credit_started_at: editDraft.creditStartedAt || null,
        credit_ends_at: editDraft.creditEndsAt || null,
        provider_name: editDraft.providerName.trim() || null,
      });
      setEditingCredit(false);
      setScheduleOpen(false);
      setScheduleItems([]);
      setSelectedScheduleYear(null);
      await load();
    } catch (err) {
      setEditError(err instanceof Error ? err.message : 'Не удалось сохранить параметры кредита');
    } finally {
      setSavingCredit(false);
    }
  };

  const handleRepay = async (e: FormEvent, creditId: number) => {
    e.preventDefault();
    const draft = repayDrafts[creditId];
    if (!draft || !draft.amount.trim() || !draft.fromAccountId || submittingRepayId === creditId) return;

    setSubmittingRepayId(creditId);
    setRepayError(null);
    try {
      const selectedAccount = credits.find(({ account }) => account.id === creditId)?.account;
      if (selectedAccount && isTermCredit(selectedAccount.credit_kind)) {
        await repayCreditAccount(creditId, {
          from_account_id: Number(draft.fromAccountId),
          currency_code: draft.currencyCode,
          amount: Number(draft.amount),
          comment: draft.comment.trim() || undefined,
          payment_at: draft.paymentAt ? new Date(`${draft.paymentAt}T12:00:00`).toISOString() : undefined,
        });
      } else {
        await transferBetweenAccounts({
          from_account_id: Number(draft.fromAccountId),
          to_account_id: creditId,
          currency_code: draft.currencyCode,
          amount: Number(draft.amount),
          comment: draft.comment.trim() || undefined,
        });
      }
      setRepayDrafts((prev) => {
        const credit = credits.find(({ account }) => account.id === creditId) ?? null;
        return {
          ...prev,
          [creditId]: buildRepayDraft(credit, cashAccounts, user.base_currency_code),
        };
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
    const parsedInterestRate = parseDecimalInput(newInterestRate);
    if (newInterestRate.trim() && parsedInterestRate == null) {
      setNewError('Ставку нужно ввести числом, например 10,4');
      setSubmittingNew(false);
      return;
    }
    try {
      await createCreditAccount({
        name: newName.trim(),
        credit_kind: newKind,
        currency_code: newCurrency,
        credit_limit: Number(newCreditLimit),
        target_account_id: newTargetAccountId ? Number(newTargetAccountId) : undefined,
        owner_type: newOwnerType,
        interest_rate: parsedInterestRate ?? undefined,
        payment_day: newPaymentDay.trim() ? Number(newPaymentDay) : undefined,
        credit_started_at: newStartedAt.trim() || undefined,
        credit_ends_at: newEndsAt.trim() || undefined,
        provider_name: newProvider.trim() || undefined,
      });
      setShowNewForm(false);
      setNewName('');
      setNewKind('loan');
      setNewCurrency(user.base_currency_code);
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
  const scheduleYears = useMemo(
    () => Array.from(new Set(scheduleItems.map((item) => new Date(item.scheduled_date).getFullYear()))),
    [scheduleItems],
  );
  const visibleScheduleItems = useMemo(
    () => (
      selectedScheduleYear == null
        ? scheduleItems
        : scheduleItems.filter((item) => new Date(item.scheduled_date).getFullYear() === selectedScheduleYear)
    ),
    [scheduleItems, selectedScheduleYear],
  );
  const missingTermConfigFields = useMemo(
    () => (
      selectedCredit && isTermCredit(selectedCredit.account.credit_kind)
        ? getMissingTermConfigFields(selectedSummary, selectedCredit.account)
        : []
    ),
    [selectedCredit, selectedSummary],
  );

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
                  {isTermCredit(selectedCredit.account.credit_kind) && selectedSummary ? (
                    <>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
                        <span className="settings-row__sub">Основной долг <span className="pill">{selectedSummary.currency_code}</span></span>
                        <strong style={{ color: 'var(--tag-out-fg)' }}>
                          {formatAmount(selectedSummary.principal_outstanding, selectedSummary.currency_code)}
                        </strong>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
                        <span className="settings-row__sub">Начислено процентов на сегодня</span>
                        <strong>{formatAmount(selectedSummary.accrued_interest, selectedSummary.currency_code)}</strong>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
                        <span className="settings-row__sub">К оплате на сегодня</span>
                        <strong>{formatAmount(selectedSummary.total_due_as_of, selectedSummary.currency_code)}</strong>
                      </div>
                      {selectedSummary.next_payment_date && selectedSummary.next_payment_total != null && (
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
                          <span className="settings-row__sub">
                            Следующий платёж · {new Date(selectedSummary.next_payment_date).toLocaleDateString('ru-RU', { day: '2-digit', month: 'long' })}
                          </span>
                          <strong>{formatAmount(selectedSummary.next_payment_total, selectedSummary.currency_code)}</strong>
                        </div>
                      )}
                      {selectedSummary.next_payment_interest != null && selectedSummary.next_payment_principal != null && (
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                          <span className="settings-row__sub">В следующем платеже</span>
                          <span className="settings-row__sub">
                            {formatAmount(selectedSummary.next_payment_interest, selectedSummary.currency_code)} проценты
                            {' · '}
                            {formatAmount(selectedSummary.next_payment_principal, selectedSummary.currency_code)} долг
                          </span>
                        </div>
                      )}
                      {selectedSummary.payments_count > 0 && (
                        <>
                          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                            <span className="settings-row__sub">Погашено основного долга</span>
                            <span>{formatAmount(selectedSummary.paid_principal_total, selectedSummary.currency_code)}</span>
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                            <span className="settings-row__sub">Уплачено процентов</span>
                            <span>{formatAmount(selectedSummary.paid_interest_total, selectedSummary.currency_code)}</span>
                          </div>
                        </>
                      )}
                    </>
                  ) : (
                    selectedCredit.balances.map((b) => (
                      <div key={b.currency_code} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
                        <span className="settings-row__sub">Остаток долга <span className="pill">{b.currency_code}</span></span>
                        <strong style={{ color: 'var(--tag-out-fg)' }}>
                          −{formatAmount(Math.abs(b.amount), b.currency_code)}
                        </strong>
                      </div>
                    ))
                  )}
                  {selectedSummaryLoading && (
                    <div className="settings-row__sub">Считаем проценты и график...</div>
                  )}
                  {selectedSummaryError && (
                    <div className="settings-row__sub" style={{ color: 'var(--tag-out-fg)' }}>{selectedSummaryError}</div>
                  )}
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
                  {selectedCredit.account.provider_name && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                      <span className="settings-row__sub">Банк</span>
                      <span>{selectedCredit.account.provider_name}</span>
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
                  {(selectedCredit.account.credit_started_at || selectedCredit.account.credit_ends_at) && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                      <span className="settings-row__sub">Срок</span>
                      <span>
                        {selectedCredit.account.credit_started_at
                          ? new Date(selectedCredit.account.credit_started_at).toLocaleDateString('ru-RU', { day: '2-digit', month: 'short', year: 'numeric' })
                          : '—'}
                        {selectedCredit.account.credit_ends_at
                          ? ` — ${new Date(selectedCredit.account.credit_ends_at).toLocaleDateString('ru-RU', { day: '2-digit', month: 'short', year: 'numeric' })}`
                          : null}
                      </span>
                    </div>
                  )}
                  {isTermCredit(selectedCredit.account.credit_kind) && !selectedSummaryLoading && !selectedSummaryError && missingTermConfigFields.length > 0 && (
                    <div className="credit-config-hint">
                      <span className="settings-row__sub">
                        Чтобы появился график платежей, заполни {missingTermConfigFields.join(', ')}.
                      </span>
                    </div>
                  )}
                  <div className="credit-detail-actions">
                    <button
                      className="btn btn--secondary"
                      type="button"
                      onClick={() => {
                        setEditingCredit((prev) => !prev);
                        setEditError(null);
                      }}
                    >
                      {editingCredit ? 'Скрыть условия' : 'Изменить условия'}
                    </button>
                    {isTermCredit(selectedCredit.account.credit_kind) && (
                      <button
                        className="btn btn--secondary"
                        type="button"
                        onClick={() => void openSchedule()}
                        disabled={scheduleLoading || !!selectedSummaryError || !selectedSummary?.schedule_available}
                      >
                        {scheduleLoading ? 'Загружаем график...' : 'График платежей'}
                      </button>
                    )}
                  </div>
                  {editingCredit && editDraft && (
                    <div className="credit-edit-panel">
                      <div className="section__eyebrow">Параметры кредита</div>
                      <form onSubmit={(e) => void handleSaveCredit(e)}>
                        <div className="form-row" style={{ marginTop: 8 }}>
                          <input
                            className="input"
                            type="text"
                            placeholder="Название кредита"
                            value={editDraft.name}
                            onChange={(e) => setEditDraft((prev) => (prev ? { ...prev, name: e.target.value } : prev))}
                            disabled={savingCredit}
                            style={{ flex: '1 1 260px' }}
                          />
                        </div>
                        <div className="form-row" style={{ marginTop: 8 }}>
                          <input
                            className="input"
                            type="text"
                            inputMode="decimal"
                            placeholder="Кредитный лимит"
                            value={editDraft.creditLimit}
                            onChange={(e) => setEditDraft((prev) => (prev ? { ...prev, creditLimit: e.target.value } : prev))}
                            disabled={savingCredit}
                            style={{ width: 180 }}
                          />
                          <input
                            className="input"
                            type="text"
                            placeholder="Банк"
                            value={editDraft.providerName}
                            onChange={(e) => setEditDraft((prev) => (prev ? { ...prev, providerName: e.target.value } : prev))}
                            disabled={savingCredit}
                            style={{ flex: '1 1 220px' }}
                          />
                        </div>
                        <div className="form-row" style={{ marginTop: 8 }}>
                          <input
                            className="input"
                            type="text"
                            inputMode="decimal"
                            placeholder="Ставка, % годовых"
                            value={editDraft.interestRate}
                            onChange={(e) => setEditDraft((prev) => (prev ? { ...prev, interestRate: e.target.value } : prev))}
                            disabled={savingCredit}
                            style={{ width: 180 }}
                          />
                          {isTermCredit(selectedCredit.account.credit_kind) && (
                            <input
                              className="input"
                              type="text"
                              inputMode="numeric"
                              placeholder="День платежа"
                              value={editDraft.paymentDay}
                              onChange={(e) => setEditDraft((prev) => (prev ? { ...prev, paymentDay: e.target.value.replace(/\D/g, '') } : prev))}
                              disabled={savingCredit}
                              style={{ width: 160 }}
                            />
                          )}
                        </div>
                        {isTermCredit(selectedCredit.account.credit_kind) && (
                          <div className="form-row" style={{ marginTop: 8 }}>
                            <input
                              className="input"
                              type="date"
                              value={editDraft.creditStartedAt}
                              onChange={(e) => setEditDraft((prev) => (prev ? { ...prev, creditStartedAt: e.target.value } : prev))}
                              disabled={savingCredit}
                              style={{ flex: '1 1 180px' }}
                            />
                            <input
                              className="input"
                              type="date"
                              value={editDraft.creditEndsAt}
                              onChange={(e) => setEditDraft((prev) => (prev ? { ...prev, creditEndsAt: e.target.value } : prev))}
                              disabled={savingCredit}
                              style={{ flex: '1 1 180px' }}
                            />
                          </div>
                        )}
                        {editError && (
                          <p style={{ color: 'var(--tag-out-fg)', fontSize: '0.85rem', marginTop: 8 }}>{editError}</p>
                        )}
                        <div className="credit-edit-panel__actions">
                          <button
                            className="btn btn--secondary"
                            type="button"
                            disabled={savingCredit}
                            onClick={() => {
                              setEditingCredit(false);
                              setEditDraft(buildCreditEditDraft(selectedCredit.account));
                              setEditError(null);
                            }}
                          >
                            Отмена
                          </button>
                          <button className="btn btn--primary" type="submit" disabled={savingCredit}>
                            {savingCredit ? 'Сохраняем...' : 'Сохранить условия'}
                          </button>
                        </div>
                      </form>
                    </div>
                  )}
                </div>

                <hr style={{ opacity: 0.15, marginBottom: 16 }} />

                {/* Repay form */}
                <div className="section__header" style={{ marginBottom: 8 }}>
                  <div className="section__eyebrow">Погашение</div>
                </div>
                {isTermCredit(selectedCredit.account.credit_kind) && (
                  <p className="settings-row__sub" style={{ marginBottom: 8 }}>
                    Платёж сначала покроет начисленные проценты, остаток уменьшит основной долг.
                  </p>
                )}
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
                    {isTermCredit(selectedCredit.account.credit_kind) && (
                      <input
                        className="input"
                        type="date"
                        value={repayDrafts[selectedCredit.account.id]?.paymentAt ?? todayIso()}
                        max={todayIso()}
                        onChange={(e) => setRepayDrafts((prev) => ({
                          ...prev,
                          [selectedCredit.account.id]: {
                            ...prev[selectedCredit.account.id],
                            paymentAt: e.target.value,
                          },
                        }))}
                        disabled={submittingRepayId === selectedCredit.account.id}
                        style={{ width: 180 }}
                      />
                    )}
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
              {archiveError && (
                <p style={{ color: 'var(--tag-out-fg)', fontSize: '0.85rem', margin: '0 0 8px' }}>{archiveError}</p>
              )}
              <div className="action-pill">
                <button className="action-pill__cancel" type="button" onClick={handleCloseDetail}>
                  Закрыть
                </button>
                {getCreditDebt(selectedCredit) === 0 && (
                  <button
                    className="action-pill__cancel"
                    type="button"
                    disabled={archiving}
                    onClick={() => void handleArchive(selectedCredit.account.id)}
                  >
                    {archiving ? 'Архивируем...' : 'В архив'}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {scheduleOpen && selectedCredit && (
        <div className="modal-backdrop" onClick={() => setScheduleOpen(false)}>
          <div className="modal-card credit-schedule-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <div className="section__eyebrow">График платежей</div>
                <div className="section__title">{selectedCredit.account.name}</div>
              </div>
            </div>
            <div className="modal-body">
              {scheduleYears.length > 0 && (
                <div className="credit-schedule-years">
                  {scheduleYears.map((year) => (
                    <button
                      key={year}
                      className={`credit-schedule-years__pill${selectedScheduleYear === year ? ' credit-schedule-years__pill--active' : ''}`}
                      type="button"
                      onClick={() => setSelectedScheduleYear(year)}
                    >
                      {year}
                    </button>
                  ))}
                </div>
              )}

              {scheduleLoading ? (
                <p className="settings-row__sub">Собираем график платежей...</p>
              ) : scheduleError ? (
                <p className="settings-row__sub" style={{ color: 'var(--tag-out-fg)' }}>{scheduleError}</p>
              ) : visibleScheduleItems.length === 0 ? (
                <p className="settings-row__sub">График пока недоступен. Проверь срок, ставку и дату платежа.</p>
              ) : (
                <div className="credit-schedule-list">
                  {visibleScheduleItems.map((item) => (
                    <div className="credit-schedule-item" key={item.scheduled_date}>
                      <div className="credit-schedule-item__head">
                        <div className="credit-schedule-item__head-main">
                          <strong>
                            {new Date(item.scheduled_date).toLocaleDateString('ru-RU', { day: '2-digit', month: 'long' })}
                            {' — '}
                            {formatAmount(item.total_payment, selectedSummary?.currency_code ?? user.base_currency_code)}
                          </strong>
                          <span className={`tag ${item.status === 'paid' ? 'tag--in' : 'tag--neutral'}`}>
                            {item.status === 'paid' ? 'Оплачено' : 'План'}
                          </span>
                        </div>
                      </div>
                      <div className="credit-schedule-item__sub">
                        {item.status === 'paid' ? 'Остаток после платежа ' : 'Остаток '}
                        {formatAmount(item.principal_after, selectedSummary?.currency_code ?? user.base_currency_code)}
                      </div>
                      <div className="credit-schedule-item__row">
                        <span>Основной долг</span>
                        <strong>{formatAmount(item.principal_component, selectedSummary?.currency_code ?? user.base_currency_code)}</strong>
                      </div>
                      <div className="credit-schedule-item__row">
                        <span>Проценты</span>
                        <strong>{formatAmount(item.interest_component, selectedSummary?.currency_code ?? user.base_currency_code)}</strong>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="modal-actions">
              <div className="action-pill">
                <button className="action-pill__cancel" type="button" onClick={() => setScheduleOpen(false)}>
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
                    placeholder="Кредитный лимит"
                    value={newCreditLimit}
                    onChange={(e) => setNewCreditLimit(e.target.value)}
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
                {hasTerm(newKind) && (
                  <div className="form-row" style={{ marginTop: 8 }}>
                    <select
                      className="input"
                      value={newTargetAccountId}
                      onChange={(e) => setNewTargetAccountId(e.target.value)}
                      disabled={submittingNew}
                      style={{ flex: 1 }}
                    >
                      <option value="">Выберите счёт зачисления</option>
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
                  disabled={submittingNew || !newName.trim() || !newCreditLimit.trim() || (hasTerm(newKind) && !newTargetAccountId)}
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
