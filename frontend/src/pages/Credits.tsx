import { type FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, House, Landmark, CreditCard, Pencil, Trash2, ArrowDownLeft, ArrowRight, CalendarDays } from 'lucide-react';
import BottomSheet from '../components/BottomSheet';
import { CategorySvgIcon } from '../components/CategorySvgIcon';

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

function creditKindIconColor(kind: CreditKind | null | undefined): { code: string; color: string } {
  if (kind === 'mortgage') return { code: 'home', color: 'b' };
  if (kind === 'credit_card') return { code: 'wallet', color: 'p' };
  return { code: 'landmark', color: 'o' };
}

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

const BADGE_COLORS = [
  { key: 'r', label: 'Красный' },
  { key: 'o', label: 'Оранжевый' },
  { key: 'y', label: 'Жёлтый' },
  { key: 'g', label: 'Зелёный' },
  { key: 'b', label: 'Синий' },
  { key: 'p', label: 'Фиолетовый' },
  { key: 'v', label: 'Сиреневый' },
] as const;

interface CreditEditDraft {
  name: string;
  creditLimit: string;
  interestRate: string;
  paymentDay: string;
  creditStartedAt: string;
  creditEndsAt: string;
  providerName: string;
  badgeColor: string;
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
    badgeColor: account.badge_color ?? '',
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
  const [newBadgeColor, setNewBadgeColor] = useState('');
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
    setNewBadgeColor('');
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
    resetNewCreditForm('mortgage');
    setNewKindStep('pick');
    setNewKindLocked(false);
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

  const [repaySheetOpen, setRepaySheetOpen] = useState(false);
  const [transferSheetOpen, setTransferSheetOpen] = useState(false);

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
    setRepaySheetOpen(false);
    setTransferSheetOpen(false);
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
        badge_color: editDraft.badgeColor || null,
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
        badge_color: newBadgeColor || undefined,
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
                                    <span className={`tile__bank${item.account.badge_color ? ` tile__bank--${item.account.badge_color}` : ''}`}>{item.account.provider_name}</span>
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
      {selectedCredit && (() => {
        const isTerm = isTermCredit(selectedCredit.account.credit_kind);
        const isCard = selectedCredit.account.credit_kind === 'credit_card';
        const debtNow = isTerm && selectedSummary
          ? selectedSummary.principal_outstanding
          : getCreditDebt(selectedCredit);
        const accruedInt = isTerm && selectedSummary ? selectedSummary.accrued_interest : 0;
        const totalDue  = isTerm && selectedSummary ? selectedSummary.total_due_as_of : debtNow;
        const ccy = isTerm && selectedSummary ? selectedSummary.currency_code : user.base_currency_code;
        const creditLimit = selectedCredit.account.credit_limit ?? 0;
        const usedPct = isCard && creditLimit > 0
          ? Math.min(100, Math.round((debtNow / creditLimit) * 100))
          : 0;
        const utilLvl = usedPct < 30 ? 'low' : usedPct < 70 ? 'mid' : 'high';

        return (
        <>
          <BottomSheet
            open
            gray
            title={selectedCredit.account.name}
            tag={creditKindLabel(selectedCredit.account.credit_kind)}
            icon={<CategorySvgIcon code={creditKindIconColor(selectedCredit.account.credit_kind).code} />}
            iconColor={creditKindIconColor(selectedCredit.account.credit_kind).color}
            onClose={handleCloseDetail}
          >
            <div className="credits-detail-body">
              {/* dstats */}
              <div className="credits-dstats">
                <div className="credits-dstats__cell">
                  <span className="credits-dstats__label">Остаток</span>
                  <span className="credits-dstats__value">{formatNumericAmount(debtNow, 0)}</span>
                  <span className="credits-dstats__sub">{isTerm ? 'основной долг' : 'использовано'} {ccy}</span>
                </div>
                <div className="credits-dstats__cell">
                  <span className="credits-dstats__label">Проценты</span>
                  <span className="credits-dstats__value">{formatNumericAmount(accruedInt, 0)}</span>
                  <span className="credits-dstats__sub">начислено сегодня</span>
                </div>
                <div className="credits-dstats__cell">
                  <span className="credits-dstats__label">К оплате</span>
                  <span className="credits-dstats__value">{formatNumericAmount(totalDue, 0)}</span>
                  <span className="credits-dstats__sub">если закрыть</span>
                </div>
              </div>

              {/* dnext */}
              {isTerm && selectedSummary?.next_payment_date && selectedSummary.next_payment_total != null && (
                <div className="credits-dnext">
                  <div className="credits-dnext__left">
                    <span className="credits-dnext__label">Следующий платёж</span>
                    <span className="credits-dnext__date">{new Date(selectedSummary.next_payment_date).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}</span>
                    {selectedSummary.next_payment_interest != null && (
                      <div className="credits-dnext__row">
                        <span className="credits-dnext__row-label">Проценты</span>
                        <span className="credits-dnext__row-val">{formatAmount(selectedSummary.next_payment_interest, ccy)}</span>
                      </div>
                    )}
                    {selectedSummary.next_payment_principal != null && (
                      <div className="credits-dnext__row">
                        <span className="credits-dnext__row-label">Тело</span>
                        <span className="credits-dnext__row-val">{formatAmount(selectedSummary.next_payment_principal, ccy)}</span>
                      </div>
                    )}
                  </div>
                  <span className="credits-dnext__amount">{formatNumericAmount(selectedSummary.next_payment_total, 0)} {currencySymbol(ccy)}</span>
                </div>
              )}

              {/* dutil - credit cards */}
              {isCard && creditLimit > 0 && (
                <div className="credits-util">
                  <div className="credits-util__head">
                    <span className="credits-util__title">Лимит карты</span>
                    <span className="credits-util__pct">{usedPct}%</span>
                  </div>
                  <div className="credits-util__bar">
                    <div className={`credits-util__fill credits-util__fill--${utilLvl}`} style={{ width: `${Math.max(2, usedPct)}%` }} />
                  </div>
                  <span className="credits-util__legend">
                    Использовано <strong>{formatAmount(debtNow, ccy)}</strong> · доступно <strong>{formatAmount(creditLimit - debtNow, ccy)}</strong> из <strong>{formatAmount(creditLimit, ccy)}</strong>
                  </span>
                </div>
              )}

              {/* dcond */}
              <div className="credits-dcond">
                <div className="credits-dcond__head">
                  <span className="sec-tag">Условия</span>
                  <button className="credits-textbtn" type="button" onClick={() => { setEditingCredit((v) => !v); setEditError(null); }}>
                    <Pencil size={14} strokeWidth={2} /> {editingCredit ? 'Скрыть' : 'Изменить'}
                  </button>
                </div>
                {!editingCredit ? (
                  <>
                    {selectedCredit.account.interest_rate != null && (
                      <div className="credits-dcond__row"><span className="credits-dcond__row-label">Ставка</span><span className="credits-dcond__row-value">{selectedCredit.account.interest_rate}% годовых</span></div>
                    )}
                    {selectedCredit.account.payment_day != null && (
                      <div className="credits-dcond__row"><span className="credits-dcond__row-label">День платежа</span><span className="credits-dcond__row-value">{selectedCredit.account.payment_day}-е число</span></div>
                    )}
                    {(selectedCredit.account.credit_started_at || selectedCredit.account.credit_ends_at) && (
                      <div className="credits-dcond__row">
                        <span className="credits-dcond__row-label">Срок</span>
                        <span className="credits-dcond__row-value">
                          {selectedCredit.account.credit_started_at ? new Date(selectedCredit.account.credit_started_at).toLocaleDateString('ru-RU', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}
                          {selectedCredit.account.credit_ends_at ? ` — ${new Date(selectedCredit.account.credit_ends_at).toLocaleDateString('ru-RU', { day: '2-digit', month: 'short', year: 'numeric' })}` : ''}
                        </span>
                      </div>
                    )}
                    {isCard && creditLimit > 0 && (
                      <div className="credits-dcond__row"><span className="credits-dcond__row-label">Лимит</span><span className="credits-dcond__row-value">{formatAmount(creditLimit, ccy)}</span></div>
                    )}
                    {selectedCredit.account.provider_name && (
                      <div className="credits-dcond__row"><span className="credits-dcond__row-label">Банк</span><span className="credits-dcond__row-value">{selectedCredit.account.provider_name}</span></div>
                    )}
                    {isTerm && selectedSummary && selectedSummary.payments_count > 0 && (
                      <>
                        <div className="credits-dcond__row"><span className="credits-dcond__row-label">Погашено долга</span><span className="credits-dcond__row-value">{formatAmount(selectedSummary.paid_principal_total, ccy)}</span></div>
                        <div className="credits-dcond__row"><span className="credits-dcond__row-label">Уплачено процентов</span><span className="credits-dcond__row-value">{formatAmount(selectedSummary.paid_interest_total, ccy)}</span></div>
                      </>
                    )}
                  </>
                ) : (
                  editDraft && (
                    <form className="apf-body" onSubmit={(e) => void handleSaveCredit(e)}>
                      <div className="apf-field">
                        <label className="apf-label">Название</label>
                        <input className="apf-input" type="text" placeholder="Название кредита" value={editDraft.name} onChange={(e) => setEditDraft((prev) => prev ? { ...prev, name: e.target.value } : prev)} disabled={savingCredit} />
                      </div>
                      <div className="apf-row">
                        <div className="apf-field" style={{ flex: 1 }}>
                          <label className="apf-label">{isCard ? 'Кредитный лимит' : 'Сумма кредита'}</label>
                          <input className="apf-input" type="text" inputMode="decimal" placeholder="0" value={editDraft.creditLimit} onChange={(e) => setEditDraft((prev) => prev ? { ...prev, creditLimit: e.target.value } : prev)} disabled={savingCredit} />
                        </div>
                        <div className="apf-field" style={{ flex: 1 }}>
                          <label className="apf-label">Банк</label>
                          <input className="apf-input" type="text" placeholder="Банк" value={editDraft.providerName} onChange={(e) => setEditDraft((prev) => prev ? { ...prev, providerName: e.target.value } : prev)} disabled={savingCredit} />
                        </div>
                      </div>
                      <div className="apf-field">
                        <label className="apf-label">Цвет бейджа</label>
                        <div className="badge-color-picker">
                          <button type="button" className={`badge-color-picker__swatch badge-color-picker__swatch--none${!editDraft.badgeColor ? ' badge-color-picker__swatch--active' : ''}`} onClick={() => setEditDraft((prev) => prev ? { ...prev, badgeColor: '' } : prev)} disabled={savingCredit} />
                          {BADGE_COLORS.map((c) => (
                            <button key={c.key} type="button" className={`badge-color-picker__swatch badge-color-picker__swatch--${c.key}${editDraft.badgeColor === c.key ? ' badge-color-picker__swatch--active' : ''}`} title={c.label} onClick={() => setEditDraft((prev) => prev ? { ...prev, badgeColor: c.key } : prev)} disabled={savingCredit} />
                          ))}
                        </div>
                      </div>
                      <div className="apf-row">
                        <div className="apf-field" style={{ flex: 1 }}>
                          <label className="apf-label">Ставка, %</label>
                          <input className="apf-input" type="text" inputMode="decimal" placeholder="12.4" value={editDraft.interestRate} onChange={(e) => setEditDraft((prev) => prev ? { ...prev, interestRate: e.target.value } : prev)} disabled={savingCredit} />
                        </div>
                        {isTerm && (
                          <div className="apf-field" style={{ flex: 1 }}>
                            <label className="apf-label">День платежа</label>
                            <input className="apf-input" type="text" inputMode="numeric" placeholder="15" value={editDraft.paymentDay} onChange={(e) => setEditDraft((prev) => prev ? { ...prev, paymentDay: e.target.value.replace(/\D/g, '') } : prev)} disabled={savingCredit} />
                          </div>
                        )}
                      </div>
                      {isTerm && (
                        <div className="apf-row">
                          <div className="apf-field" style={{ flex: 1 }}>
                            <label className="apf-label">Дата начала</label>
                            <input className="apf-input" type="date" value={editDraft.creditStartedAt} onChange={(e) => setEditDraft((prev) => prev ? { ...prev, creditStartedAt: e.target.value } : prev)} disabled={savingCredit} />
                          </div>
                          <div className="apf-field" style={{ flex: 1 }}>
                            <label className="apf-label">Дата окончания</label>
                            <input className="apf-input" type="date" value={editDraft.creditEndsAt} onChange={(e) => setEditDraft((prev) => prev ? { ...prev, creditEndsAt: e.target.value } : prev)} disabled={savingCredit} />
                          </div>
                        </div>
                      )}
                      {editError && <div className="apf-error">{editError}</div>}
                      <div className="apf-actions">
                        <button className="apf-cancel" type="button" disabled={savingCredit} onClick={() => { setEditingCredit(false); setEditDraft(buildCreditEditDraft(selectedCredit.account)); setEditError(null); }}>Отмена</button>
                        <button className="apf-submit" type="submit" disabled={savingCredit}>{savingCredit ? 'Сохраняем...' : 'Сохранить'}</button>
                      </div>
                    </form>
                  )
                )}
              </div>

              {/* hint */}
              {isTerm && !selectedSummaryLoading && missingTermConfigFields.length > 0 && (
                <div className="credits-hint">Заполни {missingTermConfigFields.join(', ')} — появится график платежей.</div>
              )}
              {selectedSummaryLoading && <div className="credits-hint">Считаем проценты и график...</div>}
              {selectedSummaryError && <div className="credits-hint">{selectedSummaryError}</div>}

              {/* actions */}
              <div className="credits-sheet-actions">
                <button className="btn btn--primary" type="button" onClick={() => setRepaySheetOpen(true)}>
                  <ArrowDownLeft size={16} /> Погасить
                </button>
                {isCard && selectedCreditAvailableLimit > 0 && (
                  <button className="btn btn--ghost" type="button" onClick={() => setTransferSheetOpen(true)}>
                    <ArrowRight size={16} /> Перевод с кредита
                  </button>
                )}
                {isTerm && (
                  <button className="btn btn--ghost" type="button" onClick={() => void openSchedule()} disabled={scheduleLoading || !!selectedSummaryError || !selectedSummary?.schedule_available}>
                    <CalendarDays size={16} /> {scheduleLoading ? 'Загружаем...' : 'График платежей'}
                  </button>
                )}
              </div>

              {archiveError && <p style={{ color: 'var(--neg)', fontSize: '0.85rem' }}>{archiveError}</p>}
              {getCreditDebt(selectedCredit) === 0 && (
                <button className="credits-archive-btn" type="button" onClick={() => void handleArchive(selectedCredit.account.id)} disabled={archiving}>
                  <Trash2 size={15} strokeWidth={2} /> {archiving ? 'Архивируем...' : 'Перенести в архив'}
                </button>
              )}
            </div>
          </BottomSheet>

          {/* Repay sheet */}
          <BottomSheet open={repaySheetOpen} title={selectedCredit.account.name} tag="Погашение" icon={<CategorySvgIcon code="coins" />} iconColor="g" onClose={() => setRepaySheetOpen(false)}>
            <form className="apf-body" onSubmit={(e) => void handleRepay(e, selectedCredit.account.id)}>
              {isTerm && <p className="apf-balance">Платёж сначала покроет начисленные проценты, остаток уменьшит основной долг.</p>}
              <div className="apf-row">
                <div className="apf-field" style={{ flex: 2 }}>
                  <label className="apf-label">Сумма</label>
                  <input className="apf-input" type="text" inputMode="decimal" placeholder="0" value={repayDrafts[selectedCredit.account.id]?.amount ?? ''} onChange={(e) => setRepayDrafts((prev) => ({ ...prev, [selectedCredit.account.id]: { ...prev[selectedCredit.account.id], amount: sanitizeDecimalInput(e.target.value) } }))} disabled={submittingRepayId === selectedCredit.account.id} />
                </div>
                <div className="apf-field" style={{ flex: 1 }}>
                  <label className="apf-label">Валюта</label>
                  <ApfSelect value={repayDrafts[selectedCredit.account.id]?.currencyCode ?? user.base_currency_code} options={currencies.map((c) => ({ value: c.code, label: c.code }))} onChange={(v) => setRepayDrafts((prev) => ({ ...prev, [selectedCredit.account.id]: { ...prev[selectedCredit.account.id], currencyCode: v } }))} disabled={submittingRepayId === selectedCredit.account.id} />
                </div>
              </div>
              <div className="apf-field">
                <label className="apf-label">Со счёта</label>
                <ApfSelect value={repayDrafts[selectedCredit.account.id]?.fromAccountId ?? ''} options={[{ value: '', label: 'Выберите счёт' }, ...cashAccounts.map((a) => ({ value: String(a.id), label: a.name }))]} onChange={(v) => setRepayDrafts((prev) => ({ ...prev, [selectedCredit.account.id]: { ...prev[selectedCredit.account.id], fromAccountId: v } }))} disabled={submittingRepayId === selectedCredit.account.id} />
              </div>
              {isTerm && (
                <div className="apf-field">
                  <label className="apf-label">Дата платежа</label>
                  <input className="apf-input" type="date" value={repayDrafts[selectedCredit.account.id]?.paymentAt ?? todayIso()} max={todayIso()} onChange={(e) => setRepayDrafts((prev) => ({ ...prev, [selectedCredit.account.id]: { ...prev[selectedCredit.account.id], paymentAt: e.target.value } }))} disabled={submittingRepayId === selectedCredit.account.id} />
                </div>
              )}
              <div className="apf-field">
                <label className="apf-label">Комментарий</label>
                <input className="apf-input" type="text" placeholder="Например, плановый платёж" value={repayDrafts[selectedCredit.account.id]?.comment ?? ''} onChange={(e) => setRepayDrafts((prev) => ({ ...prev, [selectedCredit.account.id]: { ...prev[selectedCredit.account.id], comment: e.target.value } }))} disabled={submittingRepayId === selectedCredit.account.id} />
              </div>
              {repayError && <div className="apf-error">{repayError}</div>}
              <div className="apf-actions">
                <button className="apf-cancel" type="button" onClick={() => setRepaySheetOpen(false)} disabled={submittingRepayId === selectedCredit.account.id}>Отмена</button>
                <button className="apf-submit" type="submit" disabled={submittingRepayId === selectedCredit.account.id}>{submittingRepayId === selectedCredit.account.id ? 'Погашаем...' : 'Погасить'}</button>
              </div>
            </form>
          </BottomSheet>

          {/* Transfer sheet */}
          <BottomSheet open={transferSheetOpen} title={selectedCredit.account.name} tag="Перевод с кредита" icon={<CategorySvgIcon code="banknote" />} iconColor="b" onClose={() => setTransferSheetOpen(false)}>
            <form className="apf-body" onSubmit={(e) => void handleCreditTransfer(e, selectedCredit.account.id)}>
              <p className="apf-balance">Деньги попадут в свободный остаток выбранного личного или семейного счёта.</p>
              <div className="apf-row">
                <div className="apf-field" style={{ flex: 2 }}>
                  <label className="apf-label">Сумма</label>
                  <input className="apf-input" type="text" inputMode="decimal" placeholder="0" value={selectedCreditTransferDraft?.amount ?? ''} onChange={(e) => setCreditTransferDrafts((prev) => ({ ...prev, [selectedCredit.account.id]: { ...(selectedCreditTransferDraft ?? buildCreditTransferDraft(selectedCredit, cashAccounts, user.base_currency_code)), amount: sanitizeDecimalInput(e.target.value) } }))} disabled={submittingCreditTransferId === selectedCredit.account.id} />
                </div>
                <div className="apf-field" style={{ flex: 1 }}>
                  <label className="apf-label">Валюта</label>
                  <ApfSelect value={selectedCreditTransferDraft?.currencyCode ?? user.base_currency_code} options={selectedCreditTransferCurrencyCodes.map((c) => ({ value: c, label: c }))} onChange={(v) => setCreditTransferDrafts((prev) => ({ ...prev, [selectedCredit.account.id]: { ...(selectedCreditTransferDraft ?? buildCreditTransferDraft(selectedCredit, cashAccounts, user.base_currency_code)), currencyCode: v, amount: '' } }))} disabled={submittingCreditTransferId === selectedCredit.account.id} />
                </div>
              </div>
              <div className="apf-field">
                <label className="apf-label">На счёт</label>
                <ApfSelect value={selectedCreditTransferDraft?.toAccountId ?? ''} options={[{ value: '', label: 'Выберите счёт' }, ...cashAccounts.map((a) => ({ value: String(a.id), label: `${a.owner_type === 'family' ? 'Семейный' : 'Личный'} · ${a.name}` }))]} onChange={(v) => setCreditTransferDrafts((prev) => ({ ...prev, [selectedCredit.account.id]: { ...(selectedCreditTransferDraft ?? buildCreditTransferDraft(selectedCredit, cashAccounts, user.base_currency_code)), toAccountId: v } }))} disabled={submittingCreditTransferId === selectedCredit.account.id} />
              </div>
              <div className="apf-field">
                <label className="apf-label">Комментарий</label>
                <input className="apf-input" type="text" placeholder="Перевод с карты" value={selectedCreditTransferDraft?.comment ?? ''} onChange={(e) => setCreditTransferDrafts((prev) => ({ ...prev, [selectedCredit.account.id]: { ...(selectedCreditTransferDraft ?? buildCreditTransferDraft(selectedCredit, cashAccounts, user.base_currency_code)), comment: e.target.value } }))} disabled={submittingCreditTransferId === selectedCredit.account.id} />
              </div>
              <p className="apf-balance">Доступный лимит: {formatAmount(selectedCreditAvailableLimit, selectedCreditTransferDraft?.currencyCode ?? user.base_currency_code)}</p>
              {creditTransferError && <div className="apf-error">{creditTransferError}</div>}
              <div className="apf-actions">
                <button className="apf-cancel" type="button" onClick={() => setTransferSheetOpen(false)} disabled={submittingCreditTransferId === selectedCredit.account.id}>Отмена</button>
                <button className="apf-submit" type="submit" disabled={submittingCreditTransferId === selectedCredit.account.id || !selectedCreditTransferDraft?.amount.trim() || !selectedCreditTransferDraft?.toAccountId || selectedCreditAvailableLimit <= 0}>{submittingCreditTransferId === selectedCredit.account.id ? 'Переводим...' : 'Перевести'}</button>
              </div>
            </form>
          </BottomSheet>
        </>
        );
      })()}

      {/* ── Schedule sheet ── */}
      {scheduleOpen && selectedCredit && (() => {
        const ccy = selectedSummary?.currency_code ?? user.base_currency_code;
        const nextItemDate = scheduleItems.find((i) => i.status !== 'paid')?.scheduled_date ?? null;
        return (
          <BottomSheet
            open={scheduleOpen}
            gray
            tag="График платежей"
            title={selectedCredit.account.name}
            icon={<CategorySvgIcon code="chart" />}
            iconColor="v"
            onClose={() => setScheduleOpen(false)}
          >
            {scheduleYears.length > 0 && (
              <div className="sch-years">
                {scheduleYears.map((year) => (
                  <button
                    key={year}
                    className={`sch-years__pill${selectedScheduleYear === year ? ' sch-years__pill--on' : ''}`}
                    type="button"
                    onClick={() => setSelectedScheduleYear(year)}
                  >
                    {year}
                  </button>
                ))}
              </div>
            )}

            {scheduleLoading ? (
              <div className="credits-hint">Собираем график платежей...</div>
            ) : scheduleError ? (
              <div className="credits-hint">{scheduleError}</div>
            ) : visibleScheduleItems.length === 0 ? (
              <div className="credits-hint">График пока недоступен. Проверь срок, ставку и дату платежа.</div>
            ) : (
              <div className="sch-list">
                {visibleScheduleItems.map((item) => {
                  const isPaid = item.status === 'paid';
                  const isNext = item.scheduled_date === nextItemDate;
                  const total = item.total_payment;
                  const principalPct = total > 0 ? Math.round((item.principal_component / total) * 100) : 50;
                  const interestPct = 100 - principalPct;
                  const mod = isPaid ? ' sch-item--paid' : isNext ? ' sch-item--next' : '';
                  return (
                    <div className={`sch-item${mod}`} key={item.scheduled_date}>
                      <div className="sch-item__head">
                        <div className="sch-item__date">
                          {new Date(item.scheduled_date).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })}
                          <span>Остаток {formatAmount(item.principal_after, ccy)}</span>
                        </div>
                        <span className="sch-item__total">{formatAmount(item.total_payment, ccy)}</span>
                      </div>
                      <div className="sch-item__bar">
                        <div className="sch-item__bar-seg sch-item__bar-seg--principal" style={{ width: `${principalPct}%` }} />
                        <div className="sch-item__bar-seg sch-item__bar-seg--interest" style={{ width: `${interestPct}%` }} />
                      </div>
                      <div className="sch-item__breakdown">
                        <span>Тело <strong>{formatAmount(item.principal_component, ccy)}</strong></span>
                        <span>Проценты <strong>{formatAmount(item.interest_component, ccy)}</strong></span>
                        <span className={`sch-item__status${isPaid ? ' sch-item__status--paid' : isNext ? ' sch-item__status--next' : ' sch-item__status--plan'}`}>
                          {isPaid ? 'Оплачено' : isNext ? 'Следующий' : 'План'}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </BottomSheet>
        );
      })()}

      {/* ── New credit sheet ── */}
      {showNewForm && (
        <BottomSheet
          open={showNewForm}
          tag="Создать"
          title={newKindStep === 'pick' ? 'Новый кредитный счёт' : creditKindTitle(newKind)}
          icon={<CategorySvgIcon code={newKindStep === 'pick' ? 'briefcase' : creditKindIconColor(newKind).code} />}
          iconColor={newKindStep === 'pick' ? 'r' : creditKindIconColor(newKind).color}
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

              <div className="apf-field">
                <label className="apf-label">Цвет бейджа</label>
                <div className="badge-color-picker">
                  <button type="button" className={`badge-color-picker__swatch badge-color-picker__swatch--none${!newBadgeColor ? ' badge-color-picker__swatch--active' : ''}`} onClick={() => setNewBadgeColor('')} disabled={submittingNew} />
                  {BADGE_COLORS.map((c) => (
                    <button key={c.key} type="button" className={`badge-color-picker__swatch badge-color-picker__swatch--${c.key}${newBadgeColor === c.key ? ' badge-color-picker__swatch--active' : ''}`} title={c.label} onClick={() => setNewBadgeColor(c.key)} disabled={submittingNew} />
                  ))}
                </div>
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
