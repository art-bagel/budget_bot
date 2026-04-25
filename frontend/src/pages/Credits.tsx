import { type FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, House, Landmark, CreditCard } from 'lucide-react';
import BottomSheet from '../components/BottomSheet';

function ApfSelect<T extends string>({
  value,
  options,
  onChange,
  disabled,
}: {
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (v: T) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const selected = options.find((o) => o.value === value);

  return (
    <div className="apf-csel" ref={ref}>
      <button
        type="button"
        className={`apf-csel__btn${open ? ' apf-csel__btn--open' : ''}`}
        onClick={() => !disabled && setOpen((v) => !v)}
        disabled={disabled}
      >
        <span className="apf-csel__label">{selected?.label ?? '—'}</span>
        <ChevronDown size={15} className="apf-csel__chev" strokeWidth={2.2} />
      </button>
      {open && (
        <div className="apf-csel__drop">
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              className={`apf-csel__item${o.value === value ? ' apf-csel__item--on' : ''}`}
              onMouseDown={(e) => { e.preventDefault(); onChange(o.value); setOpen(false); }}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
import { sanitizeDecimalInput } from '../utils/validation';
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
import { formatAmount, formatNumericAmount, currencySymbol } from '../utils/format';

type CreditKind = 'loan' | 'credit_card' | 'mortgage';

const CREDIT_KIND_OPTIONS: { value: CreditKind; label: string }[] = [
  { value: 'mortgage', label: 'Ипотека' },
  { value: 'loan', label: 'Кредит' },
  { value: 'credit_card', label: 'Кредитная карта' },
];

function creditKindLabel(kind: CreditKind | null | undefined): string {
  return CREDIT_KIND_OPTIONS.find((o) => o.value === kind)?.label ?? '—';
}

function creditKindTitle(kind: CreditKind): string {
  if (kind === 'mortgage') return 'Новая ипотека';
  if (kind === 'credit_card') return 'Новая кредитная карта';
  return 'Новый кредит';
}

function creditKindPlaceholder(kind: CreditKind): string {
  if (kind === 'mortgage') return 'Например, Ипотека Сбербанк';
  if (kind === 'credit_card') return 'Например, Кредитная карта Т-Банк';
  return 'Например, Кредит Альфа-Банк';
}

function creditProviderPlaceholder(kind: CreditKind): string {
  if (kind === 'credit_card') return 'Например, Т-Банк (необязательно)';
  return 'Например, Сбербанк (необязательно)';
}

function resolveKindFromFilterTab(tab: FilterTab): CreditKind | null {
  if (tab === 'mortgage' || tab === 'loan' || tab === 'credit_card') return tab;
  return null;
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

interface CreditTransferDraft {
  amount: string;
  currencyCode: string;
  toAccountId: string;
  comment: string;
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

function buildCreditTransferDraft(
  credit: CreditWithBalances | null,
  cashAccounts: BankAccount[],
  baseCurrencyCode: string,
): CreditTransferDraft {
  const currencyCode = credit?.balances[0]?.currency_code ?? baseCurrencyCode;
  return {
    amount: '',
    currencyCode,
    toAccountId: String(cashAccounts[0]?.id ?? ''),
    comment: '',
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

function availableCreditLimit(credit: CreditWithBalances, currencyCode: string): number {
  const creditLimit = credit.account.credit_limit ?? 0;
  const balance = credit.balances.find((item) => item.currency_code === currencyCode)?.amount ?? 0;
  return Math.max(0, creditLimit + balance);
}

type ViewTab = 'credits' | 'ops' | 'analytics';
type FilterTab = 'all' | 'mortgage' | 'loan' | 'credit_card';

export default function Credits({ user }: { user: UserContext }) {
  const [credits, setCredits] = useState<CreditWithBalances[]>([]);
  const [cashAccounts, setCashAccounts] = useState<BankAccount[]>([]);
  const [currencies, setCurrencies] = useState<Currency[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // View state
  const [viewTab, setViewTab] = useState<ViewTab>('credits');
  const [filterTab, setFilterTab] = useState<FilterTab>('all');
  const [segtogMode, setSegtogMode] = useState<'now' | 'withint'>('now');
  const [totalAccruedInterest, setTotalAccruedInterest] = useState<number>(0);
  const [interestLoading, setInterestLoading] = useState(false);

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
  const [creditTransferDrafts, setCreditTransferDrafts] = useState<Record<number, CreditTransferDraft>>({});
  const [submittingCreditTransferId, setSubmittingCreditTransferId] = useState<number | null>(null);
  const [creditTransferError, setCreditTransferError] = useState<string | null>(null);
  const [archiving, setArchiving] = useState(false);
  const [archiveError, setArchiveError] = useState<string | null>(null);

  // New credit form
  const [showNewForm, setShowNewForm] = useState(false);
  const [newKindStep, setNewKindStep] = useState<'pick' | 'form'>('pick');
  const [newKindLocked, setNewKindLocked] = useState(false);
  const [newName, setNewName] = useState('');
  const [newKind, setNewKind] = useState<CreditKind>('mortgage');
  const [newCurrency, setNewCurrency] = useState(user.base_currency_code);
  const [newOwnerType] = useState<'user' | 'family'>('user');
  const [newInterestRate, setNewInterestRate] = useState('');
  const [newPaymentDay, setNewPaymentDay] = useState('');
  const [newStartedAt, setNewStartedAt] = useState('');
  const [newEndsAt, setNewEndsAt] = useState('');
  const [newCreditLimit, setNewCreditLimit] = useState('');
  const [newTargetAccountId, setNewTargetAccountId] = useState('');
  const [newProvider, setNewProvider] = useState('');
  const [submittingNew, setSubmittingNew] = useState(false);
  const [newError, setNewError] = useState<string | null>(null);

  const sheetRef = useRef<HTMLDivElement>(null);

  const resetNewCreditForm = (kind: CreditKind = 'mortgage') => {
    setNewName('');
    setNewKind(kind);
    setNewCurrency(user.base_currency_code);
    setNewInterestRate('');
    setNewPaymentDay('');
    setNewStartedAt('');
    setNewEndsAt('');
    setNewCreditLimit('');
    setNewTargetAccountId('');
    setNewProvider('');
    setNewError(null);
  };

  const closeNewCreditSheet = () => {
    if (submittingNew) return;
    setShowNewForm(false);
    setNewKindStep('pick');
    setNewKindLocked(false);
    resetNewCreditForm();
  };

  const openNewCreditSheet = () => {
    const presetKind = resolveKindFromFilterTab(filterTab);
    if (presetKind) {
      resetNewCreditForm(presetKind);
      setNewKindStep('form');
      setNewKindLocked(true);
    } else {
      resetNewCreditForm('mortgage');
      setNewKindStep('pick');
      setNewKindLocked(false);
    }
    setShowNewForm(true);
  };

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

  // Fetch accrued interest for all term credits in the background
  useEffect(() => {
    const termIds = credits
      .filter(({ account }) => isTermCredit(account.credit_kind))
      .map(({ account }) => account.id);
    if (termIds.length === 0) { setTotalAccruedInterest(0); return; }

    let cancelled = false;
    setInterestLoading(true);
    void Promise.all(termIds.map((id) => fetchCreditAccountSummary(id).catch(() => null)))
      .then((summaries) => {
        if (cancelled) return;
        const total = summaries.reduce(
          (sum, s) => sum + (s?.accrued_interest ?? 0),
          0,
        );
        setTotalAccruedInterest(total);
      })
      .finally(() => { if (!cancelled) setInterestLoading(false); });
    return () => { cancelled = true; };
  }, [credits]);

  const selectedCredit = useMemo(
    () => credits.find(({ account }) => account.id === selectedId) ?? null,
    [credits, selectedId],
  );

  const handleOpenDetail = (id: number) => {
    setRepayError(null);
    setCreditTransferError(null);
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
    setCreditTransferDrafts((prev) => {
      if (prev[id]) return prev;
      const credit = credits.find(({ account }) => account.id === id);
      return {
        ...prev,
        [id]: buildCreditTransferDraft(credit ?? null, cashAccounts, user.base_currency_code),
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
    setCreditTransferDrafts((prev) => {
      if (prev[selectedCredit.account.id]) return prev;
      return {
        ...prev,
        [selectedCredit.account.id]: buildCreditTransferDraft(selectedCredit, cashAccounts, user.base_currency_code),
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

  const handleCreditTransfer = async (e: FormEvent, creditId: number) => {
    e.preventDefault();
    const credit = credits.find(({ account }) => account.id === creditId) ?? null;
    const draft = creditTransferDrafts[creditId];
    if (!credit || !draft || !draft.amount.trim() || !draft.toAccountId || submittingCreditTransferId === creditId) return;

    const parsedAmount = Number(draft.amount);
    const availableLimit = availableCreditLimit(credit, draft.currencyCode);
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      setCreditTransferError('Сумма должна быть положительной');
      return;
    }
    if (parsedAmount > availableLimit) {
      setCreditTransferError(`Доступный лимит: ${formatAmount(availableLimit, draft.currencyCode)}`);
      return;
    }

    setSubmittingCreditTransferId(creditId);
    setCreditTransferError(null);
    try {
      await transferBetweenAccounts({
        from_account_id: creditId,
        to_account_id: Number(draft.toAccountId),
        currency_code: draft.currencyCode,
        amount: parsedAmount,
        comment: draft.comment.trim() || `Перевод с кредита · ${credit.account.name}`,
      });
      setCreditTransferDrafts((prev) => ({
        ...prev,
        [creditId]: buildCreditTransferDraft(credit, cashAccounts, user.base_currency_code),
      }));
      await load();
    } catch (err) {
      setCreditTransferError(err instanceof Error ? err.message : 'Ошибка перевода с кредита');
    } finally {
      setSubmittingCreditTransferId(null);
    }
  };

  const handleCreateCredit = async () => {
    if (!newName.trim() || submittingNew) return;
    setSubmittingNew(true);
    setNewError(null);
    const parsedCreditLimit = parseDecimalInput(newCreditLimit);
    const parsedInterestRate = parseDecimalInput(newInterestRate);
    if (parsedCreditLimit == null || parsedCreditLimit <= 0) {
      setNewError(newKind === 'credit_card' ? 'Введите корректный кредитный лимит' : 'Введите корректную сумму кредита');
      setSubmittingNew(false);
      return;
    }
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
        credit_limit: parsedCreditLimit,
        target_account_id: newTargetAccountId ? Number(newTargetAccountId) : undefined,
        owner_type: newOwnerType,
        interest_rate: parsedInterestRate ?? undefined,
        payment_day: newPaymentDay.trim() ? Number(newPaymentDay) : undefined,
        credit_started_at: newStartedAt.trim() || undefined,
        credit_ends_at: newEndsAt.trim() || undefined,
        provider_name: newProvider.trim() || undefined,
      });
      setShowNewForm(false);
      setNewKindStep('pick');
      setNewKindLocked(false);
      resetNewCreditForm();
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

  const filteredCredits = useMemo(() => {
    if (filterTab === 'all') return credits;
    return credits.filter(({ account }) => account.credit_kind === filterTab);
  }, [credits, filterTab]);

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
  const selectedCreditTransferCurrencyCodes = useMemo(() => {
    const codes = selectedCredit?.balances.map((balance) => balance.currency_code) ?? [];
    if (codes.length === 0) return [user.base_currency_code];
    return Array.from(new Set(codes));
  }, [selectedCredit, user.base_currency_code]);
  const selectedCreditTransferDraft = selectedCredit
    ? creditTransferDrafts[selectedCredit.account.id] ?? buildCreditTransferDraft(selectedCredit, cashAccounts, user.base_currency_code)
    : null;
  const selectedCreditAvailableLimit = selectedCredit && selectedCreditTransferDraft
    ? availableCreditLimit(selectedCredit, selectedCreditTransferDraft.currencyCode)
    : 0;

  // Calculate overall payoff progress for term credits
  const termCredits = credits.filter(({ account }) => isTermCredit(account.credit_kind));
  const totalTermLimit = termCredits.reduce((s, { account }) => s + (account.credit_limit ?? 0), 0);
  const totalTermDebt = termCredits.reduce((s, { balances }) => s + accountDebt(balances), 0);
  const paidPrincipal = Math.max(0, totalTermLimit - totalTermDebt);
  const progressPct = totalTermLimit > 0 ? Math.round((paidPrincipal / totalTermLimit) * 100) : 0;

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
      {/* ── Hero ── */}
      <article className="hero hero--ink">
        <div className="hero__head">
          <span className="hero__eyebrow">
            Общий долг
          </span>
          <button
            className={`credits-chiptog${segtogMode === 'withint' ? ' credits-chiptog--on' : ''}`}
            type="button"
            aria-pressed={segtogMode === 'withint'}
            onClick={() => setSegtogMode((m) => m === 'now' ? 'withint' : 'now')}
          >
            <span className="credits-chiptog__glyph" aria-hidden="true">
              {segtogMode === 'withint' ? '−' : '+'}
            </span>
            с процентами
          </button>
        </div>

        <div className="hero__amount">
          <span className="hero__value">
            {formatNumericAmount(segtogMode === 'withint' ? totalDebt + totalAccruedInterest : totalDebt, 0)}
          </span>
          <span className="hero__sym">{currencySymbol(user.base_currency_code)}</span>
        </div>

        {credits.length > 0 && (
          <div className="hero__delta-row">
            <span className="hero__delta">
              {segtogMode === 'now'
                ? 'Текущий остаток'
                : 'Текущий остаток с процентами'}
            </span>
          </div>
        )}

        {credits.length > 0 && (
          <dl className="hero__rows">
            {hasMortgage && (
              <div
                className="hero__row"
                role="button"
                tabIndex={0}
                onClick={() => setFilterTab(filterTab === 'mortgage' ? 'all' : 'mortgage')}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setFilterTab(filterTab === 'mortgage' ? 'all' : 'mortgage'); } }}
              >
                <dt><span className="hero__mark hero__mark--ink" />Ипотека</dt>
                <dd>{formatAmount(mortgageDebt, user.base_currency_code)}</dd>
              </div>
            )}
            {hasLoans && (
              <div
                className="hero__row"
                role="button"
                tabIndex={0}
                onClick={() => setFilterTab(filterTab === 'loan' ? 'all' : 'loan')}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setFilterTab(filterTab === 'loan' ? 'all' : 'loan'); } }}
              >
                <dt><span className="hero__mark hero__mark--mint" />Кредиты</dt>
                <dd>{formatAmount(loanDebt, user.base_currency_code)}</dd>
              </div>
            )}
            {hasCards && (
              <div
                className="hero__row"
                role="button"
                tabIndex={0}
                onClick={() => setFilterTab(filterTab === 'credit_card' ? 'all' : 'credit_card')}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setFilterTab(filterTab === 'credit_card' ? 'all' : 'credit_card'); } }}
              >
                <dt><span className="hero__mark hero__mark--coral" />Карты</dt>
                <dd>{formatAmount(cardDebt, user.base_currency_code)}</dd>
              </div>
            )}
          </dl>
        )}

        {termCredits.length > 0 && totalTermLimit > 0 && (
          <div className="hero__progress">
            <div className="hero__progress-meta">
              <span className="hero__progress-label">Погашено тела</span>
              <span className="hero__progress-value">
                {formatAmount(paidPrincipal, user.base_currency_code)} из {formatAmount(totalTermLimit, user.base_currency_code)} · <strong>{progressPct}%</strong>
              </span>
            </div>
            <div className="hero__progress-bar">
              <div className="hero__progress-fill" style={{ width: `${progressPct}%` }} />
            </div>
            {hasCards && (
              <div className="hero__progress-note">только срочные кредиты — карты возобновляемые</div>
            )}
          </div>
        )}

        {segtogMode === 'withint' && !interestLoading && totalAccruedInterest > 0 && (
          <div className="hero__potnote">
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
              <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.4" />
              <path d="M8 7v4M8 5v.01" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
            <span>+{formatAmount(totalAccruedInterest, user.base_currency_code)} начислено по срочным кредитам на сегодня</span>
          </div>
        )}
      </article>

      {error && <p style={{ color: 'var(--tag-out-fg)', marginBottom: 12 }}>{error}</p>}

      {/* ── Type filter tabs + add button ── */}
      <div className="tabs-row">
        <nav className="tabs" role="tablist" aria-label="Тип кредита">
          {(
            [
              { key: 'all', label: 'Все' },
              hasMortgage && { key: 'mortgage', label: 'Ипотека' },
              hasLoans && { key: 'loan', label: 'Кредиты' },
              hasCards && { key: 'card', label: 'Карты' },
            ] as Array<{ key: string; label: string } | false>
          )
            .filter(Boolean)
            .map((item) => {
              if (!item) return null;
              const tabKey = item.key === 'card' ? 'credit_card' : item.key as FilterTab;
              const isOn = filterTab === tabKey || (item.key === 'all' && filterTab === 'all');
              return (
                <button
                  key={item.key}
                  className={`tabs__item${isOn ? ' tabs__item--on' : ''}`}
                  type="button"
                  role="tab"
                  aria-selected={isOn}
                  onClick={() => setFilterTab(tabKey)}
                >
                  {item.label}
                </button>
              );
            })}
        </nav>
        <button
          className="tabs-add-btn"
          type="button"
          onClick={openNewCreditSheet}
          aria-label="Новый кредитный счёт"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <path d="M12 5v14M5 12h14" />
          </svg>
        </button>
      </div>

      {/* ── View switcher ── */}
      <div className="viewtog" role="tablist" aria-label="Раздел">
        {(
          [
            { key: 'credits', label: 'Кредиты' },
            { key: 'ops', label: 'Операции' },
            { key: 'analytics', label: 'Аналитика' },
          ] as Array<{ key: ViewTab; label: string }>
        ).map(({ key, label }) => (
          <button
            key={key}
            className={`viewtog__opt${viewTab === key ? ' viewtog__opt--on' : ''}`}
            type="button"
            role="tab"
            aria-selected={viewTab === key}
            onClick={() => setViewTab(key)}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ── Pane: Кредиты ── */}
      <div className={`view-pane${viewTab === 'credits' ? ' view-pane--on' : ''}`}>
        <section className="sec">
          <div className="sec__head">
            <h2 className="sec__title">Кредиты</h2>
            <span className="sec__sub">
              {filteredCredits.length === 0
                ? 'Нет активных кредитов'
                : `${filteredCredits.length} активных`}
            </span>
          </div>

          {filteredCredits.length === 0 ? (
            <div className="credits-empty">
              <strong>Нет кредитов</strong>
              {filterTab !== 'all' ? 'Нет кредитов в этой категории' : 'Добавьте первый кредитный счёт'}
            </div>
          ) : (
            <div className="credit-groups">
              {(['mortgage', 'loan', 'credit_card'] as CreditKind[])
                .filter((kind) => filteredCredits.some(({ account }) => account.credit_kind === kind))
                .map((kind) => {
                  const kindItems = filteredCredits.filter(({ account }) => account.credit_kind === kind);
                  return (
                    <div className="credit-group" key={kind}>
                      <div className="credit-group__head">
                        <span className="credit-group__title">{creditKindLabel(kind)}</span>
                        <span className="credit-group__count">{kindItems.length}</span>
                      </div>
                      <div className="credit-list">
                        {kindItems.map((item) => {
                          const debt = getCreditDebt(item);
                          const limit = item.account.credit_limit ?? 0;
                          const utilPct = kind === 'credit_card' && limit > 0
                            ? Math.min(100, Math.round((debt / limit) * 100))
                            : 0;
                          const termPct = isTermCredit(kind) && limit > 0
                            ? Math.min(100, Math.round(((limit - debt) / limit) * 100))
                            : 0;

                          return (
                            <button
                              key={item.account.id}
                              className={`tile${kind === 'credit_card' ? ' tile--card' : ''}`}
                              type="button"
                              onClick={() => handleOpenDetail(item.account.id)}
                            >
                              <div className="tile__head">
                                <div className="tile__head-left">
                                  {item.account.provider_name && (
                                    <span className="tile__bank">{item.account.provider_name}</span>
                                  )}
                                  <span className="tile__name">{item.account.name}</span>
                                </div>
                                <div className="tile__amount">
                                  <span className="tile__debt">−{formatAmount(debt, user.base_currency_code)}</span>
                                  <span className="tile__debt-label">долг</span>
                                </div>
                              </div>

                              {(item.account.interest_rate != null || item.account.payment_day != null || item.account.credit_ends_at) && (
                                <div className="tile__meta">
                                  {item.account.interest_rate != null && (
                                    <span>{item.account.interest_rate}% годовых</span>
                                  )}
                                  {item.account.interest_rate != null && item.account.payment_day != null && (
                                    <span className="tile__meta-sep" />
                                  )}
                                  {item.account.payment_day != null && (
                                    <span>платёж {item.account.payment_day}-го</span>
                                  )}
                                  {item.account.payment_day != null && item.account.credit_ends_at && (
                                    <span className="tile__meta-sep" />
                                  )}
                                  {item.account.credit_ends_at && (
                                    <span>до {new Date(item.account.credit_ends_at).toLocaleDateString('ru-RU', { month: 'short', year: 'numeric' })}</span>
                                  )}
                                </div>
                              )}

                              {isTermCredit(kind) && limit > 0 && (
                                <div className="tile__progress">
                                  <div className="tile__progress-meta">
                                    <span className="tile__progress-text">Погашено</span>
                                    <span className="tile__progress-pct">{termPct}%</span>
                                  </div>
                                  <div className="tile__progress-bar">
                                    <div className="tile__progress-fill" style={{ width: `${termPct}%` }} />
                                  </div>
                                </div>
                              )}

                              {kind === 'credit_card' && limit > 0 && (
                                <div className="tile__util">
                                  <div className="tile__util-meta">
                                    <span className="tile__util-text">
                                      Использовано <strong>{formatAmount(debt, user.base_currency_code)}</strong> из {formatAmount(limit, user.base_currency_code)}
                                    </span>
                                    <span className="tile__util-text"><strong>{utilPct}%</strong></span>
                                  </div>
                                  <div className="tile__util-bar">
                                    <div
                                      className={`tile__util-fill${utilPct < 50 ? ' tile__util-fill--low' : utilPct < 80 ? ' tile__util-fill--mid' : ' tile__util-fill--high'}`}
                                      style={{ width: `${utilPct}%` }}
                                    />
                                  </div>
                                </div>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
            </div>
          )}
        </section>
      </div>

      {/* ── Pane: Операции ── */}
      <div className={`view-pane${viewTab === 'ops' ? ' view-pane--on' : ''}`}>
        <section className="card-sec">
          <header className="card-sec__head">
            <div className="card-sec__title-row">
              <span className="card-sec__ico card-sec__ico--ops">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <path d="M2 4h12M2 8h12M2 12h8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                </svg>
              </span>
              <div className="card-sec__title-meta">
                <h3 className="card-sec__title">Операции</h3>
                <span className="card-sec__sub">Кредитные счета · 30 дней</span>
              </div>
            </div>
          </header>
          <div className="card-sec__empty">История операций будет доступна в следующей версии</div>
        </section>
      </div>

      {/* ── Pane: Аналитика ── */}
      <div className={`view-pane${viewTab === 'analytics' ? ' view-pane--on' : ''}`}>
        <section className="card-sec">
          <header className="card-sec__head">
            <div className="card-sec__title-row">
              <span className="card-sec__ico card-sec__ico--anal">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <rect x="2" y="2" width="12" height="12" rx="2" stroke="currentColor" strokeWidth="1.4" />
                  <path d="M5 11V8M8 11V5M11 11v-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                </svg>
              </span>
              <div className="card-sec__title-meta">
                <h3 className="card-sec__title">Аналитика</h3>
                <span className="card-sec__sub">Долговой портфель · {new Date().getFullYear()}</span>
              </div>
            </div>
          </header>
          <div className="card-sec__empty">Аналитика долгов будет доступна в следующей версии</div>
        </section>
      </div>

      {/* ── Detail sheet ── */}
      {selectedCredit && (
        <div className="modal-backdrop" onClick={handleCloseDetail}>
          <div
            ref={sheetRef}
            className="modal-card"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <div>
                <div className="section__eyebrow">{creditKindLabel(selectedCredit.account.credit_kind)}</div>
                <div className="section__title">{selectedCredit.account.name}</div>
                {selectedCredit.account.provider_name && (
                  <div className="settings-row__sub">{selectedCredit.account.provider_name}</div>
                )}
              </div>
            </div>
            <div className="modal-body">
              <div className="portfolio-position-detail">

                {/* Debt info stats */}
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

                {/* Transfer from credit */}
                <div className="section__header" style={{ marginBottom: 8 }}>
                  <div className="section__eyebrow">Перевод с кредита</div>
                </div>
                <p className="settings-row__sub" style={{ marginBottom: 8 }}>
                  Деньги попадут в свободный остаток выбранного личного или семейного счёта.
                </p>
                <form onSubmit={(e) => void handleCreditTransfer(e, selectedCredit.account.id)}>
                  <div className="form-row">
                    <input
                      className="input"
                      type="text"
                      inputMode="decimal"
                      placeholder="Сумма перевода"
                      value={selectedCreditTransferDraft?.amount ?? ''}
                      onChange={(e) => setCreditTransferDrafts((prev) => ({
                        ...prev,
                        [selectedCredit.account.id]: {
                          ...(selectedCreditTransferDraft ?? buildCreditTransferDraft(selectedCredit, cashAccounts, user.base_currency_code)),
                          amount: sanitizeDecimalInput(e.target.value),
                        },
                      }))}
                      disabled={submittingCreditTransferId === selectedCredit.account.id}
                      style={{ width: 160 }}
                    />
                    <select
                      className="input"
                      value={selectedCreditTransferDraft?.currencyCode ?? user.base_currency_code}
                      onChange={(e) => setCreditTransferDrafts((prev) => ({
                        ...prev,
                        [selectedCredit.account.id]: {
                          ...(selectedCreditTransferDraft ?? buildCreditTransferDraft(selectedCredit, cashAccounts, user.base_currency_code)),
                          currencyCode: e.target.value,
                          amount: '',
                        },
                      }))}
                      disabled={submittingCreditTransferId === selectedCredit.account.id}
                    >
                      {selectedCreditTransferCurrencyCodes.map((code) => (
                        <option key={code} value={code}>{code}</option>
                      ))}
                    </select>
                  </div>
                  <div className="form-row" style={{ marginTop: 8 }}>
                    <select
                      className="input"
                      value={selectedCreditTransferDraft?.toAccountId ?? ''}
                      onChange={(e) => setCreditTransferDrafts((prev) => ({
                        ...prev,
                        [selectedCredit.account.id]: {
                          ...(selectedCreditTransferDraft ?? buildCreditTransferDraft(selectedCredit, cashAccounts, user.base_currency_code)),
                          toAccountId: e.target.value,
                        },
                      }))}
                      disabled={submittingCreditTransferId === selectedCredit.account.id}
                      style={{ flex: '1 1 220px' }}
                    >
                      <option value="">Выберите счёт зачисления</option>
                      {cashAccounts.map((acc) => (
                        <option key={acc.id} value={acc.id}>
                          {acc.owner_type === 'family' ? 'Семейный' : 'Личный'} · {acc.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="form-row" style={{ marginTop: 8 }}>
                    <input
                      className="input"
                      type="text"
                      placeholder="Комментарий"
                      value={selectedCreditTransferDraft?.comment ?? ''}
                      onChange={(e) => setCreditTransferDrafts((prev) => ({
                        ...prev,
                        [selectedCredit.account.id]: {
                          ...(selectedCreditTransferDraft ?? buildCreditTransferDraft(selectedCredit, cashAccounts, user.base_currency_code)),
                          comment: e.target.value,
                        },
                      }))}
                      disabled={submittingCreditTransferId === selectedCredit.account.id}
                      style={{ flex: '1 1 220px' }}
                    />
                    <button
                      className="btn btn--primary"
                      type="submit"
                      disabled={
                        submittingCreditTransferId === selectedCredit.account.id
                        || !selectedCreditTransferDraft?.amount.trim()
                        || !selectedCreditTransferDraft?.toAccountId
                        || selectedCreditAvailableLimit <= 0
                      }
                    >
                      {submittingCreditTransferId === selectedCredit.account.id ? 'Переводим...' : 'Перевести'}
                    </button>
                  </div>
                  <p className="settings-row__sub" style={{ marginTop: 8 }}>
                    Доступный лимит: {formatAmount(selectedCreditAvailableLimit, selectedCreditTransferDraft?.currencyCode ?? user.base_currency_code)}
                  </p>
                  {creditTransferError && (
                    <p style={{ color: 'var(--tag-out-fg)', fontSize: '0.85rem', marginTop: 8 }}>{creditTransferError}</p>
                  )}
                </form>

                <hr style={{ opacity: 0.15, margin: '16px 0' }} />

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
                        [selectedCredit.account.id]: { ...prev[selectedCredit.account.id], amount: sanitizeDecimalInput(e.target.value) },
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

      {/* ── Schedule modal ── */}
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

      {/* ── New credit sheet ── */}
      {showNewForm && (
        <BottomSheet
          open={showNewForm}
          tag="Создать"
          title={newKindStep === 'pick' ? 'Новый кредитный счёт' : creditKindTitle(newKind)}
          onClose={closeNewCreditSheet}
        >
          {newKindStep === 'pick' ? (
            <div className="add-pos-types">
              <button type="button" className="add-pos-type-tile" onClick={() => { resetNewCreditForm('mortgage'); setNewKindStep('form'); setNewKindLocked(true); }}>
                <span className="add-pos-type-tile__icon add-pos-type-tile__icon--b"><House size={20} strokeWidth={2} /></span>
                <div className="add-pos-type-tile__copy">
                  <span className="add-pos-type-tile__label">Ипотека</span>
                  <span className="add-pos-type-tile__sub">Срок, ставка, платёж и счёт зачисления</span>
                </div>
                <span className="add-pos-type-tile__chev">›</span>
              </button>
              <button type="button" className="add-pos-type-tile" onClick={() => { resetNewCreditForm('loan'); setNewKindStep('form'); setNewKindLocked(true); }}>
                <span className="add-pos-type-tile__icon add-pos-type-tile__icon--g"><Landmark size={20} strokeWidth={2} /></span>
                <div className="add-pos-type-tile__copy">
                  <span className="add-pos-type-tile__label">Кредит</span>
                  <span className="add-pos-type-tile__sub">Обычный кредит с погашением по графику</span>
                </div>
                <span className="add-pos-type-tile__chev">›</span>
              </button>
              <button type="button" className="add-pos-type-tile" onClick={() => { resetNewCreditForm('credit_card'); setNewKindStep('form'); setNewKindLocked(true); }}>
                <span className="add-pos-type-tile__icon add-pos-type-tile__icon--p"><CreditCard size={20} strokeWidth={2} /></span>
                <div className="add-pos-type-tile__copy">
                  <span className="add-pos-type-tile__label">Кредитная карта</span>
                  <span className="add-pos-type-tile__sub">Лимит, ставка и день обязательного платежа</span>
                </div>
                <span className="add-pos-type-tile__chev">›</span>
              </button>
            </div>
          ) : (
          <form
            className="apf-body credits-create-form"
            onSubmit={(e) => {
              e.preventDefault();
              void handleCreateCredit();
            }}
          >

              <div className="apf-field">
                <label className="apf-label">Название</label>
                <input
                  className="apf-input"
                  type="text"
                  placeholder={creditKindPlaceholder(newKind)}
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  disabled={submittingNew}
                  autoFocus
                />
              </div>

              <div className="apf-field">
                <label className="apf-label">Банк</label>
                <input
                  className="apf-input"
                  type="text"
                  placeholder={creditProviderPlaceholder(newKind)}
                  value={newProvider}
                  onChange={(e) => setNewProvider(e.target.value)}
                  disabled={submittingNew}
                />
              </div>

              <div className="apf-row">
                <div className="apf-field" style={{ flex: 1 }}>
                  <label className="apf-label">
                    {hasTerm(newKind) ? 'Сумма кредита' : 'Кредитный лимит'}
                  </label>
                  <input
                    className="apf-input"
                    type="text"
                    inputMode="decimal"
                    placeholder="0"
                    value={newCreditLimit}
                    onChange={(e) => setNewCreditLimit(sanitizeDecimalInput(e.target.value))}
                    disabled={submittingNew}
                  />
                </div>
                <div className="apf-field" style={{ flex: 1 }}>
                  <label className="apf-label">Валюта</label>
                  <ApfSelect
                    value={newCurrency}
                    options={currencies.map((c) => ({ value: c.code, label: c.code }))}
                    onChange={setNewCurrency}
                    disabled={submittingNew}
                  />
                </div>
              </div>

              <div className="apf-row">
                <div className="apf-field" style={{ flex: 1 }}>
                  <label className="apf-label">Ставка, %</label>
                  <input
                    className="apf-input"
                    type="text"
                    inputMode="decimal"
                    placeholder="12,4"
                    value={newInterestRate}
                    onChange={(e) => setNewInterestRate(sanitizeDecimalInput(e.target.value))}
                    disabled={submittingNew}
                  />
                </div>
                <div className="apf-field" style={{ flex: 1 }}>
                  <label className="apf-label">День платежа</label>
                  <input
                    className="apf-input"
                    type="text"
                    inputMode="numeric"
                    placeholder="15"
                    value={newPaymentDay}
                    onChange={(e) => setNewPaymentDay(e.target.value.replace(/\D/g, '').slice(0, 2))}
                    disabled={submittingNew}
                  />
                </div>
              </div>

              {hasTerm(newKind) && (
                <div className="apf-row">
                  <div className="apf-field" style={{ flex: 1 }}>
                    <label className="apf-label">Дата начала</label>
                    <input
                      className="apf-input"
                      type="date"
                      value={newStartedAt}
                      onChange={(e) => setNewStartedAt(e.target.value)}
                      disabled={submittingNew}
                    />
                  </div>
                  <div className="apf-field" style={{ flex: 1 }}>
                    <label className="apf-label">Дата окончания</label>
                    <input
                      className="apf-input"
                      type="date"
                      value={newEndsAt}
                      onChange={(e) => setNewEndsAt(e.target.value)}
                      disabled={submittingNew}
                    />
                  </div>
                </div>
              )}

              {hasTerm(newKind) && (
                <div className="apf-field">
                  <label className="apf-label">Зачислить на счёт</label>
                  <ApfSelect
                    value={newTargetAccountId}
                    options={[
                      { value: '', label: 'Выберите счёт' },
                      ...cashAccounts.map((a) => ({ value: String(a.id), label: a.name })),
                    ]}
                    onChange={setNewTargetAccountId}
                    disabled={submittingNew}
                  />
                </div>
              )}

              {newError && (
                <div className="apf-error">{newError}</div>
              )}

              <div className="apf-actions">
                <button className="apf-cancel" type="button" onClick={closeNewCreditSheet} disabled={submittingNew}>
                  Отмена
                </button>
                <button
                  className="apf-submit"
                  type="button"
                  disabled={submittingNew || !newName.trim() || !newCreditLimit.trim() || (hasTerm(newKind) && !newTargetAccountId)}
                  onClick={() => void handleCreateCredit()}
                >
                  {submittingNew ? 'Создаём...' : 'Создать'}
                </button>
              </div>
            </form>
          )}
        </BottomSheet>
      )}
    </>
  );
}
