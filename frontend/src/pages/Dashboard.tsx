import { useEffect, useRef, useState } from 'react';

import {
  fetchBankAccounts,
  fetchBankAccountSnapshot,
  fetchDashboardOverview,
  fetchGroupMembers,
  fetchPortfolioPositions,
  fetchPortfolioSummary,
  fetchTinkoffLivePrices,
} from '../api';
import type {
  BankAccount,
  DashboardBankBalance,
  DashboardBudgetCategory,
  DashboardOverview as DashboardOverviewType,
  GroupMember,
  PortfolioPosition,
  PortfolioSummaryItem,
  TinkoffLivePrice,
  UserContext,
} from '../types';
import { currencySymbol, formatAmount } from '../utils/format';
import { fetchMoexPrices } from '../utils/moex';
import type { MoexPrice } from '../utils/moex';
import TransferDialog from '../components/TransferDialog';
import type { TransferSource, TransferTarget } from '../components/TransferDialog';
import AccountTransferDialog from '../components/AccountTransferDialog';
import BottomSheet from '../components/BottomSheet';
import CategoryActionSheet from '../components/CategoryActionSheet';
import CreateCategoryDialog from '../components/CreateCategoryDialog';
import IncomeDialog from '../components/IncomeDialog';
import Operations from './Operations';
import {
  IconArrowRightLeft,
  IconChartPie,
  IconChevronRight,
  IconClock,
  IconPlus,
} from '../components/Icons';
import { categoryDisplayName, parseCategoryIcon } from '../utils/categoryIcon';
import { CategorySvgIcon } from '../components/CategorySvgIcon';
import { useHints } from '../hooks/useHints';
import { hapticRigid } from '../telegram';

type DashboardBankHubMode = 'history' | 'analytics';

export default function Dashboard({ user, onNavigate }: { user: UserContext; onNavigate?: (page: 'exchange') => void }) {
  const [overview, setOverview] = useState<DashboardOverviewType | null>(null);
  const [investmentAccounts, setInvestmentAccounts] = useState<BankAccount[]>([]);
  const [investmentBalancesByAccountId, setInvestmentBalancesByAccountId] = useState<Record<number, DashboardBankBalance[]>>({});
  const [totalCreditDebtInBase, setTotalCreditDebtInBase] = useState(0);
  const [portfolioSummaryItems, setPortfolioSummaryItems] = useState<PortfolioSummaryItem[]>([]);
  const [openPositions, setOpenPositions] = useState<PortfolioPosition[]>([]);
  const [moexPrices, setMoexPrices] = useState<Map<string, MoexPrice>>(new Map());
  const [tinkoffLivePrices, setTinkoffLivePrices] = useState<Map<number, TinkoffLivePrice>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { hintsEnabled } = useHints();
  const [includeCredits, setIncludeCredits] = useState<boolean>(() => {
    try { return localStorage.getItem('dashboard_include_credits') !== 'false'; } catch { return true; }
  });
  const toggleIncludeCredits = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIncludeCredits((prev) => {
      const next = !prev;
      try { localStorage.setItem('dashboard_include_credits', String(next)); } catch { /* ignore */ }
      return next;
    });
  };

  const [showBankDetail, setShowBankDetail] = useState(false);
  const [showBankHub, setShowBankHub] = useState(false);
  const [bankHubMode, setBankHubMode] = useState<DashboardBankHubMode>('history');
  const [showIncomeDialog, setShowIncomeDialog] = useState(false);
  const [showAccountTransfer, setShowAccountTransfer] = useState(false);

  useEffect(() => {
    if (showBankDetail || showBankHub) {
      document.body.classList.add('modal-open');
      return () => document.body.classList.remove('modal-open');
    }
  }, [showBankDetail, showBankHub]);
  const [draggedCategoryId, setDraggedCategoryId] = useState<number | null>(null);
  const [draggedOwnerType, setDraggedOwnerType] = useState<'user' | 'family' | null>(null);
  const [dropTargetCategoryId, setDropTargetCategoryId] = useState<number | null>(null);
  const [transferTarget, setTransferTarget] = useState<TransferTarget | null>(null);
  const [transferInitialSourceId, setTransferInitialSourceId] = useState<number | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<DashboardBudgetCategory | null>(null);
  const suppressClickUntilRef = useRef(0);
  const [groupMembersByGroupId, setGroupMembersByGroupId] = useState<Record<number, GroupMember[]>>({});
  const [createDialogKind, setCreateDialogKind] = useState<'regular' | 'group' | null>(null);

  const activeSourceId = draggedCategoryId;

  /* ── swipe tracking (hero only) ─────────────────── */

  const heroSwipeRef = useRef<{
    startX: number;
    startY: number;
    decided: boolean;
    isHorizontal: boolean;
    actionTriggered: boolean;
    element: HTMLElement | null;
  } | null>(null);

  const handleHeroSwipeStart = (e: React.TouchEvent) => {
    heroSwipeRef.current = {
      startX: e.touches[0].clientX,
      startY: e.touches[0].clientY,
      decided: false,
      isHorizontal: false,
      actionTriggered: false,
      element: e.currentTarget as HTMLElement,
    };
  };

  const handleHeroSwipeMove = (e: React.TouchEvent) => {
    const s = heroSwipeRef.current;
    if (!s) return;
    if (s.actionTriggered) return;

    const dx = e.touches[0].clientX - s.startX;
    const dy = e.touches[0].clientY - s.startY;

    if (!s.decided && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) {
      s.decided = true;
      s.isHorizontal = Math.abs(dx) > Math.abs(dy);
    }

    if (s.isHorizontal && s.element) {
      const offset = Math.max(-96, Math.min(0, dx));
      s.element.style.transform = `translateX(${offset}px)`;
      s.element.style.transition = 'none';

      const actionThreshold = getSwipeActionThreshold(s.element);

      if (dx <= -actionThreshold) {
        s.actionTriggered = true;
        suppressClickUntilRef.current = Date.now() + 300;
        resetSwipeElement(s.element);
        hapticRigid();
        setShowAccountTransfer(true);
      }
    }
  };

  const handleHeroSwipeEnd = (e: React.TouchEvent) => {
    const s = heroSwipeRef.current;
    heroSwipeRef.current = null;
    if (!s) return;

    resetSwipeElement(s.element);

    if (s.actionTriggered) {
      return;
    }

    if (!s || !s.decided || !s.isHorizontal) return;
    const dx = e.changedTouches[0].clientX - s.startX;
    if (dx < -50) {
      suppressClickUntilRef.current = Date.now() + 300;
      hapticRigid();
      setShowAccountTransfer(true);
    }
  };

  const resetSwipeElement = (element: HTMLElement | null) => {
    if (!element) return;
    element.style.transition = 'transform 0.2s ease';
    element.style.transform = '';
    window.setTimeout(() => { element.style.transition = ''; }, 200);
  };

  const getSwipeActionThreshold = (element: HTMLElement | null) => {
    const width = element?.offsetWidth ?? 0;
    return Math.max(48, Math.min(80, width * 0.2));
  };

  const freeBudgetSwipeRef = useRef<{
    startX: number; startY: number; decided: boolean; isHorizontal: boolean; actionTriggered: boolean; element: HTMLElement | null;
  } | null>(null);

  const openFreeBudgetTransfer = () => {
    if (!overview) return;
    const target: TransferTarget = {
      category_id: user.unallocated_category_id,
      name: overview.has_family ? 'Свободный остаток (личный)' : 'Свободный остаток',
      kind: 'free_budget',
      owner_type: 'user',
      currency_code: overview.base_currency_code,
    };
    setTransferTarget(target);
    setTransferInitialSourceId(null);
    hapticRigid();
  };

  const handleFreeBudgetSwipeStart = (e: React.TouchEvent) => {
    freeBudgetSwipeRef.current = {
      startX: e.touches[0].clientX, startY: e.touches[0].clientY,
      decided: false, isHorizontal: false, actionTriggered: false,
      element: e.currentTarget as HTMLElement,
    };
  };

  const handleFreeBudgetSwipeMove = (e: React.TouchEvent) => {
    const s = freeBudgetSwipeRef.current;
    if (!s || s.actionTriggered) return;
    const dx = e.touches[0].clientX - s.startX;
    const dy = e.touches[0].clientY - s.startY;
    if (!s.decided && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) { s.decided = true; s.isHorizontal = Math.abs(dx) > Math.abs(dy); }
    if (s.isHorizontal && s.element) {
      s.element.style.transform = `translateX(${Math.max(-96, Math.min(0, dx))}px)`;
      s.element.style.transition = 'none';
      if (dx <= -getSwipeActionThreshold(s.element)) {
        s.actionTriggered = true;
        suppressClickUntilRef.current = Date.now() + 300;
        resetSwipeElement(s.element);
        openFreeBudgetTransfer();
      }
    }
  };

  const handleFreeBudgetSwipeEnd = (e: React.TouchEvent) => {
    const s = freeBudgetSwipeRef.current;
    freeBudgetSwipeRef.current = null;
    if (!s) return;
    resetSwipeElement(s.element);
    if (s.actionTriggered || !s.decided || !s.isHorizontal) return;
    const dx = e.changedTouches[0].clientX - s.startX;
    if (dx < -50) { suppressClickUntilRef.current = Date.now() + 300; openFreeBudgetTransfer(); }
  };

  /* ── data loading ───────────────────────────────── */

  const loadOverview = async () => {
    setLoading(true);
    setError(null);

    try {
      const [result, loadedInvestmentAccounts, loadedCreditAccounts, loadedPortfolioSummary, loadedPositions] = await Promise.all([
        fetchDashboardOverview(user.bank_account_id),
        fetchBankAccounts('investment'),
        fetchBankAccounts('credit'),
        fetchPortfolioSummary(),
        fetchPortfolioPositions(),
      ]);
      const [investmentSnapshots, creditSnapshots] = await Promise.all([
        Promise.all(
          loadedInvestmentAccounts.map(async (account) => ({
            accountId: account.id,
            balances: await fetchBankAccountSnapshot(account.id),
          })),
        ),
        Promise.all(
          loadedCreditAccounts.map((account) => fetchBankAccountSnapshot(account.id)),
        ),
      ]);
      setOverview(result);
      setInvestmentAccounts(loadedInvestmentAccounts);
      setPortfolioSummaryItems(loadedPortfolioSummary);
      setOpenPositions(loadedPositions.filter((p) => p.status === 'open'));
      setInvestmentBalancesByAccountId(
        investmentSnapshots.reduce<Record<number, DashboardBankBalance[]>>((acc, item) => {
          acc[item.accountId] = item.balances;
          return acc;
        }, {}),
      );
      // Credit balances are negative (debt = negative balance), so negate the sum
      const creditDebt = -creditSnapshots
        .flat()
        .reduce((sum, b) => sum + b.historical_cost_in_base, 0);
      setTotalCreditDebtInBase(Math.max(0, creditDebt));
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadOverview();
  }, [user.bank_account_id]);

  useEffect(() => {
    if (openPositions.length === 0) {
      setTinkoffLivePrices(new Map());
      return;
    }

    void fetchTinkoffLivePrices()
      .then((items) => setTinkoffLivePrices(new Map(items.map((item) => [item.position_id, item]))))
      .catch(() => setTinkoffLivePrices(new Map()));
  }, [openPositions]);

  useEffect(() => {
    const sharesTickers: string[] = [];
    const bondsTickers: string[] = [];
    for (const pos of openPositions) {
      const t = pos.metadata?.ticker;
      const m = pos.metadata?.moex_market;
      if (typeof t !== 'string' || !t) continue;
      if (m === 'bonds') bondsTickers.push(t);
      else sharesTickers.push(t);
    }
    if (sharesTickers.length === 0 && bondsTickers.length === 0) return;
    void Promise.all([
      fetchMoexPrices(sharesTickers, 'shares'),
      fetchMoexPrices(bondsTickers, 'bonds'),
    ]).then(([s, b]) => setMoexPrices(new Map([...s, ...b]))).catch(() => {});
  }, [openPositions]);

  useEffect(() => {
    if (!overview) {
      setGroupMembersByGroupId({});
      return;
    }

    const groupCategories = overview.budget_categories.filter((category) => category.kind === 'group');

    if (groupCategories.length === 0) {
      setGroupMembersByGroupId({});
      return;
    }

    let cancelled = false;

    void Promise.all(
      groupCategories.map(async (group) => ({
        groupId: group.category_id,
        members: await fetchGroupMembers(group.category_id),
      })),
    )
      .then((results) => {
        if (cancelled) return;

        setGroupMembersByGroupId(
          results.reduce<Record<number, GroupMember[]>>((acc, result) => {
            acc[result.groupId] = result.members;
            return acc;
          }, {}),
        );
      })
      .catch(() => {
        if (!cancelled) {
          setGroupMembersByGroupId({});
        }
      });

    return () => {
      cancelled = true;
    };
  }, [overview]);

  /* ── desktop DnD handlers ──────────────────────── */

  const handleDragStart = (source: TransferSource, event: React.DragEvent) => {
    event.dataTransfer.setData('text/plain', '');
    event.dataTransfer.effectAllowed = 'move';
    suppressClickUntilRef.current = Date.now() + 250;
    setDraggedCategoryId(source.category_id);
    setDraggedOwnerType((source.owner_type ?? 'user') as 'user' | 'family');
  };

  const handleDragEnd = () => {
    setDraggedCategoryId(null);
    setDropTargetCategoryId(null);
    setDraggedOwnerType(null);
  };

  /* ── shared transfer logic ─────────────────────── */

  const openTransferDialog = (target: TransferTarget, initialSourceId: number | null) => {
    setTransferTarget(target);
    setTransferInitialSourceId(initialSourceId);
    setDraggedCategoryId(null);
    setDropTargetCategoryId(null);
  };

  const handleDropOnCategory = (target: TransferTarget) => {
    if (!draggedCategoryId) {
      handleDragEnd();
      return;
    }
    if (target.kind === 'system' || draggedCategoryId === target.category_id) {
      handleDragEnd();
      return;
    }
    if (draggedOwnerType && target.owner_type && draggedOwnerType !== target.owner_type) {
      handleDragEnd();
      return;
    }
    openTransferDialog(target, draggedCategoryId);
  };

  const openCategoryDialog = (category: DashboardBudgetCategory) => {
    if (Date.now() < suppressClickUntilRef.current) return;
    setSelectedCategory(category);
  };

  const handleDialogSuccess = async () => {
    setTransferTarget(null);
    setTransferInitialSourceId(null);
    setSelectedCategory(null);
    setCreateDialogKind(null);
    await loadOverview();
  };

  const openBankHub = (mode: DashboardBankHubMode) => {
    setBankHubMode(mode);
    setShowBankHub(true);
  };

  /* ── render ─────────────────────────────────────── */

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

  const hasFamily = overview.has_family;
  const familyUnallocatedId = overview.family_unallocated_category_id;
  const personalBankTotal = overview.bank_balances.reduce(
    (sum, balance) => sum + balance.historical_cost_in_base,
    0,
  );
  const familyBankTotal = overview.family_bank_balances.reduce(
    (sum, balance) => sum + balance.historical_cost_in_base,
    0,
  );
  const investmentSummaryByAccountId = portfolioSummaryItems.reduce<Record<number, PortfolioSummaryItem>>((acc, item) => {
    acc[item.investment_account_id] = item;
    return acc;
  }, {});
  const getResolvedPositionValue = (position: PortfolioPosition): number | null => {
    const tinkoffPrice = tinkoffLivePrices.get(position.id);
    if (tinkoffPrice) {
      return tinkoffPrice.current_value;
    }

    const ticker = position.metadata?.ticker;
    const isBond = position.metadata?.moex_market === 'bonds';
    if (typeof ticker === 'string' && ticker && !isBond) {
      const price = moexPrices.get(ticker);
      const currentPrice = price?.last ?? price?.prevClose ?? null;
      if (currentPrice !== null && position.quantity) {
        return currentPrice * position.quantity;
      }
    }

    return null;
  };
  const getInvestmentCashInBase = (accountId: number) => (
    investmentBalancesByAccountId[accountId] ?? []
  ).reduce((sum, balance) => sum + balance.historical_cost_in_base, 0);

  // Market-adjusted value per account:
  // cash + (for each open position: market value if ticker known, else cost basis)
  const getInvestmentAccountMarketTotal = (accountId: number) => {
    const summary = investmentSummaryByAccountId[accountId];
    if (!summary) return getInvestmentCashInBase(accountId);

    const accountPositions = openPositions.filter((p) => p.investment_account_id === accountId);
    let marketValue = 0;
    for (const pos of accountPositions) {
      const resolvedValue = getResolvedPositionValue(pos);
      if (resolvedValue !== null) {
        marketValue += resolvedValue;
        continue;
      }
      marketValue += pos.amount_in_currency;
    }
    return summary.cash_balance_in_base + marketValue;
  };

  const investmentBankTotal = investmentAccounts.reduce(
    (sum, account) => sum + getInvestmentAccountMarketTotal(account.id),
    0,
  );
  const totalBankWithInvestments = overview.total_bank_historical_in_base + investmentBankTotal - (includeCredits ? totalCreditDebtInBase : 0);
  const regularBudgetCategories = overview.budget_categories.filter((category) => category.kind === 'regular');
  const groupBudgetCategories = overview.budget_categories.filter((category) => category.kind === 'group');
  const personalRegular = hasFamily ? regularBudgetCategories.filter((c) => c.owner_type === 'user') : regularBudgetCategories;
  const familyRegular = hasFamily ? regularBudgetCategories.filter((c) => c.owner_type === 'family') : [];
  const personalGroups = hasFamily ? groupBudgetCategories.filter((c) => c.owner_type === 'user') : groupBudgetCategories;
  const familyGroups = hasFamily ? groupBudgetCategories.filter((c) => c.owner_type === 'family') : [];
  const personalBudgetTotal = personalRegular.reduce((sum, c) => sum + c.balance, 0) + overview.personal_free_budget_in_base;
  const familyBudgetTotal = hasFamily
    ? familyRegular.reduce((sum, c) => sum + c.balance, 0) + overview.family_free_budget_in_base
    : 0;

  const personalFreeBudgetSource: TransferSource = {
    category_id: user.unallocated_category_id,
    name: hasFamily ? 'Свободный остаток (личный)' : 'Свободный остаток',
    kind: 'free_budget',
    owner_type: 'user',
    balance: hasFamily ? overview.personal_free_budget_in_base : overview.free_budget_in_base,
    currency_code: overview.base_currency_code,
  };
  const familyFreeBudgetSource: TransferSource | null = hasFamily && familyUnallocatedId ? {
    category_id: familyUnallocatedId,
    name: 'Свободный остаток (семейный)',
    kind: 'free_budget',
    owner_type: 'family',
    balance: overview.family_free_budget_in_base,
    currency_code: overview.base_currency_code,
  } : null;
  const freeBudgetTarget: TransferTarget = {
    category_id: user.unallocated_category_id,
    name: hasFamily ? 'Свободный остаток (личный)' : 'Свободный остаток',
    kind: 'free_budget',
    owner_type: 'user',
    currency_code: overview.base_currency_code,
  };
  const familyFreeBudgetTarget: TransferTarget | null = hasFamily && familyUnallocatedId ? {
    category_id: familyUnallocatedId,
    name: 'Свободный остаток (семейный)',
    kind: 'free_budget',
    owner_type: 'family',
    currency_code: overview.base_currency_code,
  } : null;
  const personalSources: TransferSource[] = [
    personalFreeBudgetSource,
    ...personalRegular.map((c) => ({
      category_id: c.category_id,
      name: c.name,
      kind: c.kind,
      owner_type: 'user' as const,
      balance: c.balance,
      currency_code: c.currency_code,
    })),
  ];
  const familySources: TransferSource[] = familyFreeBudgetSource ? [
    familyFreeBudgetSource,
    ...familyRegular.map((c) => ({
      category_id: c.category_id,
      name: c.name,
      kind: c.kind,
      owner_type: 'family' as const,
      balance: c.balance,
      currency_code: c.currency_code,
    })),
  ] : [];
  const getSourcesFor = (target: TransferTarget): TransferSource[] => {
    const pool = target.owner_type === 'family' ? familySources : personalSources;
    return pool.filter((s) => s.category_id !== target.category_id);
  };
  const fxResultSummary = overview.fx_result_in_base === 0
    ? null
    : `Включая курсовую разницу ${formatAmount(overview.fx_result_in_base, overview.base_currency_code)}`;
  const regularCategoryBalanceById = regularBudgetCategories.reduce<Record<number, number>>((acc, category) => {
    acc[category.category_id] = category.balance;
    return acc;
  }, {});
  const categoryById = overview.budget_categories.reduce<Record<number, DashboardBudgetCategory>>((acc, item) => {
    acc[item.category_id] = item;
    return acc;
  }, {});

  const groupMemberLabel = (member: GroupMember): string => {
    if (member.child_category_kind === 'system' && member.child_category_name === 'Unallocated') {
      return 'В свободный остаток';
    }

    return `${member.child_category_kind === 'group' ? 'Группа ' : ''}${categoryDisplayName(member.child_category_name)}`;
  };

  const getNestedGroupBalance = (categoryId: number, visited = new Set<number>()): number => {
    if (visited.has(categoryId)) {
      return 0;
    }

    const category = categoryById[categoryId];

    if (!category) {
      return 0;
    }

    if (category.kind === 'regular') {
      return regularCategoryBalanceById[categoryId] || 0;
    }

    const nextVisited = new Set(visited);
    nextVisited.add(categoryId);

    return (groupMembersByGroupId[categoryId] || []).reduce(
      (sum, member) => sum + getNestedGroupBalance(member.child_category_id, nextVisited),
      0,
    );
  };
  return (
    <>
      {/* Hero — yellow capital card */}
      <article
        className="hero"
        onTouchStart={hasFamily ? handleHeroSwipeStart : undefined}
        onTouchMove={hasFamily ? handleHeroSwipeMove : undefined}
        onTouchEnd={hasFamily ? handleHeroSwipeEnd : undefined}
      >
        <div className="hero__head">
          <span className="hero__eyebrow">Чистый капитал</span>
          <button
            className={`chiptog${includeCredits ? ' chiptog--on' : ''}`}
            type="button"
            onClick={toggleIncludeCredits}
          >
            <span className="chiptog__glyph" aria-hidden="true">{includeCredits ? '−' : '+'}</span>
            кредиты
          </button>
        </div>
        <div className="hero__amount">
          <span className="hero__value">
            {new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(totalBankWithInvestments)}
          </span>
          <span className="hero__sym">{currencySymbol(overview.base_currency_code)}</span>
        </div>
        <dl className="hero__rows">
          <div
            className="hero__row"
            role="button"
            tabIndex={0}
            onClick={() => { if (Date.now() < suppressClickUntilRef.current) return; setShowBankDetail(true); }}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setShowBankDetail(true); }}
          >
            <dt><span className="hero__mark hero__mark--ink" />&nbsp;Личный счёт</dt>
            <dd>
              {new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(personalBankTotal)}&nbsp;{currencySymbol(overview.base_currency_code)}
              <span className="hero__row-chev"><IconChevronRight /></span>
            </dd>
          </div>
          {hasFamily && (
            <div
              className="hero__row"
              role="button"
              tabIndex={0}
              onClick={() => { if (Date.now() < suppressClickUntilRef.current) return; setShowBankDetail(true); }}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setShowBankDetail(true); }}
            >
              <dt><span className="hero__mark hero__mark--coral" />&nbsp;Семейный счёт</dt>
              <dd>
                {new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(familyBankTotal)}&nbsp;{currencySymbol(overview.base_currency_code)}
                <span className="hero__row-chev"><IconChevronRight /></span>
              </dd>
            </div>
          )}
          <div
            className="hero__row"
            role="button"
            tabIndex={0}
            onClick={() => { if (Date.now() < suppressClickUntilRef.current) return; setShowBankDetail(true); }}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setShowBankDetail(true); }}
          >
            <dt><span className="hero__mark hero__mark--mint" />&nbsp;Инвестиции</dt>
            <dd>
              {new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(investmentBankTotal)}&nbsp;{currencySymbol(overview.base_currency_code)}
              <span className="hero__row-chev"><IconChevronRight /></span>
            </dd>
          </div>
          <div
            className={`hero__row${totalCreditDebtInBase > 0 ? ' hero__row--neg' : ''}`}
            role="button"
            tabIndex={0}
            onClick={() => { if (Date.now() < suppressClickUntilRef.current) return; setShowBankDetail(true); }}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setShowBankDetail(true); }}
          >
            <dt><span className={`hero__mark${totalCreditDebtInBase > 0 ? ' hero__mark--warn' : ' hero__mark--ink'}`} />&nbsp;Кредиты</dt>
            <dd>
              {totalCreditDebtInBase > 0
                ? `−${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(totalCreditDebtInBase)}`
                : '0'}&nbsp;{currencySymbol(overview.base_currency_code)}
              <span className="hero__row-chev"><IconChevronRight /></span>
            </dd>
          </div>
        </dl>
      </article>

      {/* Quick actions row */}
      <div className="quickrow">
        <button className="qa" type="button" onClick={() => setShowIncomeDialog(true)}>
          <span className="qa__ico"><IconPlus /></span>
          <span className="qa__label">Пополнить</span>
        </button>
        <button className="qa" type="button" onClick={() => openBankHub('history')}>
          <span className="qa__ico qa__ico--alt"><IconClock /></span>
          <span className="qa__label">Операции</span>
        </button>
        <button className="qa" type="button" onClick={() => openBankHub('analytics')}>
          <span className="qa__ico qa__ico--alt"><IconChartPie /></span>
          <span className="qa__label">Аналитика</span>
        </button>
        <button className="qa" type="button" onClick={() => setShowAccountTransfer(true)}>
          <span className="qa__ico qa__ico--alt"><IconArrowRightLeft /></span>
          <span className="qa__label">Перевод</span>
        </button>
      </div>

      {/* Budget section */}
      <section className="sec">
        <div className="sec__head">
          <h2 className="sec__title">Бюджет</h2>
          <span className="sec__sub">Как распределены деньги</span>
        </div>

        {/* Free budget card */}
        <div
          className={[
            'free',
            activeSourceId !== null && activeSourceId !== personalFreeBudgetSource.category_id && draggedOwnerType === 'user'
              ? 'free--valid-target' : '',
            dropTargetCategoryId === freeBudgetTarget.category_id ? 'free--drop-target' : '',
          ].filter(Boolean).join(' ')}
          role="button"
          tabIndex={0}
          draggable={personalFreeBudgetSource.balance > 0}
          onDragStart={(e) => { if (personalFreeBudgetSource.balance > 0) handleDragStart(personalFreeBudgetSource, e); }}
          onDragEnd={handleDragEnd}
          onDragOver={(event) => {
            if (activeSourceId === null || activeSourceId === freeBudgetTarget.category_id || draggedOwnerType !== 'user') return;
            event.preventDefault();
            setDropTargetCategoryId(freeBudgetTarget.category_id);
          }}
          onDragLeave={() => { if (dropTargetCategoryId === freeBudgetTarget.category_id) setDropTargetCategoryId(null); }}
          onDrop={(event) => { event.preventDefault(); handleDropOnCategory(freeBudgetTarget); }}
          onTouchStart={handleFreeBudgetSwipeStart}
          onTouchMove={handleFreeBudgetSwipeMove}
          onTouchEnd={handleFreeBudgetSwipeEnd}
          onClick={() => {
            if (Date.now() < suppressClickUntilRef.current) return;
            if (activeSourceId !== null && activeSourceId !== freeBudgetTarget.category_id && draggedOwnerType === 'user') {
              openTransferDialog(freeBudgetTarget, activeSourceId);
            }
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              if (activeSourceId !== null && activeSourceId !== freeBudgetTarget.category_id && draggedOwnerType === 'user') {
                openTransferDialog(freeBudgetTarget, activeSourceId);
              }
            }
          }}
        >
          <div className="free__top">
            <span className="sec-tag">Свободный остаток</span>
            <span className="free__hint">
              <svg className="free__hint-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" width="12" height="12">
                <path d="M8 3 4 7l4 4"/><path d="M4 7h16"/><path d="m16 21 4-4-4-4"/><path d="M20 17H4"/>
              </svg>
              перевод
            </span>
          </div>
          {hasFamily ? (
            <div className="free__split">
              <div className="free__side">
                <span className="free__label">Личный</span>
                <strong className="free__amt">
                  {new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(overview.personal_free_budget_in_base)}
                  <span className="ruble">&nbsp;{currencySymbol(overview.base_currency_code)}</span>
                </strong>
              </div>
              <span className="free__sep" />
              <div className="free__side">
                <span className="free__label">Семейный</span>
                <strong className="free__amt">
                  {new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(overview.family_free_budget_in_base)}
                  <span className="ruble">&nbsp;{currencySymbol(overview.base_currency_code)}</span>
                </strong>
              </div>
            </div>
          ) : (
            <div className="free__single">
              <span className="free__label">Свободно к распределению</span>
              <strong className="free__amt free__amt--full">
                {new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(overview.free_budget_in_base)}
                <span className="ruble">&nbsp;{currencySymbol(overview.base_currency_code)}</span>
              </strong>
            </div>
          )}
          {fxResultSummary && (
            <div className="free__note">{fxResultSummary}</div>
          )}
        </div>

        {/* Categories */}
        <div className="sub">
          <div className="sub__head">
            <span className="sub__title">Категории</span>
            <button className="add-pill" type="button" onClick={() => setCreateDialogKind('regular')}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" width="14" height="14"><path d="M12 5v14M5 12h14"/></svg>
              Добавить
            </button>
          </div>
          {regularBudgetCategories.length === 0 ? (
            <p className="sec__sub" style={{ padding: '4px' }}>Обычных категорий пока нет.</p>
          ) : (
            <ul className="catgrid">
              {[
                ...personalRegular,
                ...(hasFamily && familyRegular.length > 0 && personalRegular.length > 0 ? [null] : []),
                ...familyRegular,
              ].map((category, idx) => {
                if (category === null) {
                  return (
                    <li className="catgrid__sep" key="cat-family-divider" aria-hidden="true">
                      <span>Семейные</span>
                    </li>
                  );
                }

                const isDropTarget = dropTargetCategoryId === category.category_id;
                const isActiveSource = activeSourceId === category.category_id;
                const isValidTarget = activeSourceId !== null && activeSourceId !== category.category_id
                  && (!hasFamily || draggedOwnerType === category.owner_type);
                const parsed = parseCategoryIcon(category.name);
                const colorClasses = ['--g', '--o', '--b', '--p', '--r', '--v'] as const;
                const colorClass = colorClasses[category.category_id % 6];
                const isNeg = category.balance < 0;
                const isWarn = category.balance >= 0 && category.balance < 500;

                return (
                  <li
                    className={[
                      'cat',
                      category.owner_type === 'family' ? 'cat--fam' : '',
                      draggedCategoryId === category.category_id ? 'cat--dragging' : '',
                      isActiveSource ? 'cat--active-source' : '',
                      isDropTarget ? 'cat--drop-target' : '',
                      isValidTarget ? 'cat--valid-target' : '',
                    ].filter(Boolean).join(' ')}
                    key={category.category_id}
                    draggable
                    role="button"
                    tabIndex={0}
                    onDragStart={(e) => handleDragStart({ ...category, owner_type: category.owner_type }, e)}
                    onDragEnd={handleDragEnd}
                    onClick={() => {
                      if (Date.now() < suppressClickUntilRef.current) return;
                      if (activeSourceId !== null && activeSourceId !== category.category_id) {
                        openTransferDialog({
                          category_id: category.category_id,
                          name: category.name,
                          kind: category.kind,
                          owner_type: category.owner_type,
                          currency_code: category.currency_code,
                        }, activeSourceId);
                      } else {
                        openCategoryDialog(category);
                      }
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        openCategoryDialog(category);
                      }
                    }}
                    onDragOver={(event) => {
                      if (activeSourceId === null || activeSourceId === category.category_id) return;
                      if (hasFamily && draggedOwnerType !== category.owner_type) return;
                      event.preventDefault();
                      setDropTargetCategoryId(category.category_id);
                    }}
                    onDragLeave={() => { if (dropTargetCategoryId === category.category_id) setDropTargetCategoryId(null); }}
                    onDrop={(event) => {
                      event.preventDefault();
                      handleDropOnCategory({
                        category_id: category.category_id,
                        name: category.name,
                        kind: category.kind,
                        owner_type: category.owner_type,
                        currency_code: category.currency_code,
                      });
                    }}
                  >
                    {isValidTarget ? (
                      <>
                        <span className={`cat__ico cat__ico${colorClass}`} />
                        <span className="cat__name" style={{ color: 'var(--text)', fontWeight: 700 }}>Перевести сюда</span>
                        <strong className="cat__amt">{formatAmount(category.balance, category.currency_code)}</strong>
                      </>
                    ) : (
                      <>
                        <span className={`cat__ico cat__ico${colorClass}`}>
                          {parsed.kind === 'svg' && parsed.icon
                            ? <CategorySvgIcon code={parsed.icon} />
                            : parsed.kind === 'emoji' && parsed.icon
                              ? <span style={{ fontSize: '18px', lineHeight: 1 }}>{parsed.icon}</span>
                              : null}
                        </span>
                        <span className="cat__name">{parsed.displayName}</span>
                        <strong className={[
                          'cat__amt',
                          isNeg ? 'cat__amt--neg' : '',
                          isWarn ? 'cat__amt--warn' : '',
                        ].filter(Boolean).join(' ')}>
                          {new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(category.balance)}
                          <span className="ruble">&nbsp;{currencySymbol(category.currency_code)}</span>
                        </strong>
                      </>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Groups */}
        {groupBudgetCategories.length > 0 && (
          <div className="sub">
            <div className="sub__head">
              <span className="sub__title">Группы</span>
              <button className="add-pill" type="button" onClick={() => setCreateDialogKind('group')}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" width="14" height="14"><path d="M12 5v14M5 12h14"/></svg>
                Группа
              </button>
            </div>
            <ul className="groups">
              {[
                ...[...personalGroups].sort((a, b) => {
                  const am = groupMembersByGroupId[a.category_id] ?? [];
                  const bm = groupMembersByGroupId[b.category_id] ?? [];
                  if (bm.length !== am.length) return bm.length - am.length;
                  return bm.filter((m) => m.child_category_kind === 'group').length
                    - am.filter((m) => m.child_category_kind === 'group').length;
                }),
                ...(hasFamily && familyGroups.length > 0 && personalGroups.length > 0 ? [null] : []),
                ...[...familyGroups].sort((a, b) => {
                  const am = groupMembersByGroupId[a.category_id] ?? [];
                  const bm = groupMembersByGroupId[b.category_id] ?? [];
                  if (bm.length !== am.length) return bm.length - am.length;
                  return bm.filter((m) => m.child_category_kind === 'group').length
                    - am.filter((m) => m.child_category_kind === 'group').length;
                }),
              ].map((category) => {
                if (category === null) {
                  return (
                    <li key="family-group-divider" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 2px', fontSize: 11, color: 'var(--text-3)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.1em' }}>
                      <span style={{ flex: 1, height: 1, background: 'var(--line)' }} />
                      <span>Семейные</span>
                      <span style={{ flex: 1, height: 1, background: 'var(--line)' }} />
                    </li>
                  );
                }

                const isDropTarget = dropTargetCategoryId === category.category_id;
                const isValidTarget = activeSourceId !== null && activeSourceId !== category.category_id
                  && (!hasFamily || draggedOwnerType === category.owner_type);
                const groupMembers = [...(groupMembersByGroupId[category.category_id] || [])]
                  .sort((l, r) => r.share !== l.share ? r.share - l.share : groupMemberLabel(l).localeCompare(groupMemberLabel(r), 'ru'));
                const groupBalance = groupMembers.length > 0
                  ? groupMembers.reduce((sum, m) => sum + getNestedGroupBalance(m.child_category_id, new Set([category.category_id])), 0)
                  : 0;
                const visibleMembers = groupMembers.slice(0, 4);
                const segColors = ['group__seg--1', 'group__seg--2', 'group__seg--3', 'group__seg--4'] as const;
                const lgColors = ['lg--1', 'lg--2', 'lg--3', 'lg--4'] as const;

                return (
                  <li
                    className={[
                      'group',
                      isDropTarget ? 'group--drop-target' : '',
                      isValidTarget ? 'group--valid-target' : '',
                    ].filter(Boolean).join(' ')}
                    key={category.category_id}
                    role="button"
                    tabIndex={0}
                    onDragEnd={handleDragEnd}
                    onClick={() => {
                      if (activeSourceId !== null && activeSourceId !== category.category_id) {
                        openTransferDialog({
                          category_id: category.category_id,
                          name: category.name,
                          kind: category.kind,
                          owner_type: category.owner_type,
                          currency_code: category.currency_code,
                        }, activeSourceId);
                      } else {
                        openCategoryDialog(category);
                      }
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openCategoryDialog(category); }
                    }}
                    onDragOver={(event) => {
                      if (activeSourceId === null || activeSourceId === category.category_id) return;
                      if (hasFamily && draggedOwnerType !== category.owner_type) return;
                      event.preventDefault();
                      setDropTargetCategoryId(category.category_id);
                    }}
                    onDragLeave={() => { if (dropTargetCategoryId === category.category_id) setDropTargetCategoryId(null); }}
                    onDrop={(event) => {
                      event.preventDefault();
                      handleDropOnCategory({
                        category_id: category.category_id,
                        name: category.name,
                        kind: category.kind,
                        owner_type: category.owner_type,
                        currency_code: category.currency_code,
                      });
                    }}
                  >
                    <div className="group__head">
                      <div className="group__title-wrap">
                        <span className="group__title">
                          {isValidTarget ? 'Перевести сюда' : categoryDisplayName(category.name)}
                          {category.owner_type === 'family' && (
                            <span className="group__badge">семья</span>
                          )}
                        </span>
                        <span className="group__sub">{groupMembers.length} {groupMembers.length === 1 ? 'категория' : groupMembers.length < 5 ? 'категории' : 'категорий'}</span>
                      </div>
                      <div className="group__amt-block">
                        <strong className="group__amt">
                          {new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(groupBalance)}
                          <span className="ruble">&nbsp;{currencySymbol(category.currency_code)}</span>
                        </strong>
                        <span className="group__chev"><IconChevronRight /></span>
                      </div>
                    </div>
                    {visibleMembers.length > 0 && (
                      <div className="group__bar" aria-hidden="true">
                        {visibleMembers.map((member, i) => (
                          <span
                            key={member.child_category_id}
                            className={`group__seg ${segColors[i]}`}
                            style={{ '--w': member.share } as React.CSSProperties}
                          />
                        ))}
                      </div>
                    )}
                    {visibleMembers.length > 0 && (
                      <ul className="group__legend">
                        {visibleMembers.map((member, i) => (
                          <li key={member.child_category_id}>
                            <i className={`lg ${lgColors[i]}`} />
                            {groupMemberLabel(member)}
                            <em>{Math.round(member.share * 100)}%</em>
                          </li>
                        ))}
                      </ul>
                    )}
                    {groupMembers.length === 0 && (
                      <span style={{ fontSize: 12, color: 'var(--text-3)' }}>Состав группы пока не настроен</span>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        )}
        {groupBudgetCategories.length === 0 && (
          <div className="sub">
            <div className="sub__head">
              <span className="sub__title">Группы</span>
              <button className="add-pill" type="button" onClick={() => setCreateDialogKind('group')}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" width="14" height="14"><path d="M12 5v14M5 12h14"/></svg>
                Группа
              </button>
            </div>
          </div>
        )}
      </section>

      {transferTarget && (
        <TransferDialog
          sources={
            transferTarget.kind === 'free_budget' && hasFamily
              ? [...personalSources, ...familySources].filter((s) => s.kind !== 'free_budget')
              : getSourcesFor(transferTarget)
          }
          extraTargets={
            transferTarget.kind === 'free_budget' && hasFamily && familyFreeBudgetTarget
              ? [familyFreeBudgetTarget]
              : undefined
          }
          initialSourceId={
            transferInitialSourceId !== null && transferInitialSourceId !== transferTarget.category_id
              ? transferInitialSourceId
              : null
          }
          target={transferTarget}
          baseCurrencyCode={overview.base_currency_code}
          onClose={() => { setTransferTarget(null); setTransferInitialSourceId(null); }}
          onSuccess={() => void handleDialogSuccess()}
        />
      )}

      {selectedCategory && (
        <CategoryActionSheet
          category={selectedCategory}
          user={user}
          transferSources={getSourcesFor({
            category_id: selectedCategory.category_id,
            name: selectedCategory.name,
            kind: selectedCategory.kind,
            currency_code: selectedCategory.currency_code,
            owner_type: selectedCategory.owner_type,
          })}
          baseCurrencyCode={overview.base_currency_code}
          familyBankAccountId={overview.family_bank_account_id}
          onClose={() => setSelectedCategory(null)}
          onSuccess={() => void handleDialogSuccess()}
        />
      )}

      {createDialogKind && (
        <CreateCategoryDialog
          kind={createDialogKind}
          onClose={() => setCreateDialogKind(null)}
          onSuccess={() => void handleDialogSuccess()}
        />
      )}

      {showIncomeDialog && (
        <IncomeDialog
          user={user}
          onClose={() => setShowIncomeDialog(false)}
          onSuccess={() => { setShowIncomeDialog(false); void loadOverview(); }}
        />
      )}

      {showAccountTransfer && (
        <AccountTransferDialog
          personalAccountId={user.bank_account_id}
          familyAccountId={overview.family_bank_account_id}
          baseCurrencyCode={overview.base_currency_code}
          personalBalances={overview.bank_balances}
          familyBalances={overview.family_bank_balances}
          onClose={() => setShowAccountTransfer(false)}
          onSuccess={() => { setShowAccountTransfer(false); void loadOverview(); }}
        />
      )}

      <BottomSheet
        open={showBankDetail}
        tag="Банк"
        title="По валютам"
        onClose={() => setShowBankDetail(false)}
      >
        <div className="dashboard-budget-sections">
          <div className="dashboard-budget-section">
            <div className="dashboard-budget-section__header">
              <div className="section__eyebrow">Личный счёт</div>
            </div>
            {overview.bank_balances.length === 0 ? (
              <p className="list-row__sub">На личном счёте пока нет валютных остатков.</p>
            ) : (
              <ul className="bank-detail-list">
                {overview.bank_balances.map((balance) => (
                  <li className="bank-detail-row" key={'personal-' + balance.currency_code}>
                    <div className="bank-detail-row__main">
                      <span className="pill">{balance.currency_code}</span>
                      <strong className="bank-detail-row__amount">
                        {formatAmount(balance.amount, balance.currency_code)}
                      </strong>
                    </div>
                    <div className="bank-detail-row__sub">
                      Себестоимость: {formatAmount(balance.historical_cost_in_base, overview.base_currency_code)}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {hasFamily && (
            <div className="dashboard-budget-section">
              <div className="dashboard-budget-section__header">
                <div className="section__eyebrow">Семейный счёт</div>
              </div>
              {overview.family_bank_balances.length === 0 ? (
                <p className="list-row__sub">На семейном счёте пока нет валютных остатков.</p>
              ) : (
                <ul className="bank-detail-list">
                  {overview.family_bank_balances.map((balance) => (
                    <li className="bank-detail-row" key={'family-' + balance.currency_code}>
                      <div className="bank-detail-row__main">
                        <span className="pill">{balance.currency_code}</span>
                        <strong className="bank-detail-row__amount">
                          {formatAmount(balance.amount, balance.currency_code)}
                        </strong>
                      </div>
                      <div className="bank-detail-row__sub">
                        Себестоимость: {formatAmount(balance.historical_cost_in_base, overview.base_currency_code)}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      </BottomSheet>

      <BottomSheet
        open={showBankHub}
        tag="Банк"
        title={bankHubMode === 'analytics' ? 'Аналитика' : 'Операции'}
        icon={bankHubMode === 'analytics' ? <IconChartPie /> : <IconClock />}
        iconColor={bankHubMode === 'analytics' ? 'b' : 'o'}
        onClose={() => setShowBankHub(false)}
      >
        <Operations
          user={user}
          embedded
          initialViewMode={bankHubMode === 'analytics' ? 'analytics' : 'history'}
          allowedModes={['history', 'analytics']}
          historyScope="banking"
        />
      </BottomSheet>
    </>
  );
}
