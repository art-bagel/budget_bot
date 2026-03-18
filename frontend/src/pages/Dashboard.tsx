import { useEffect, useRef, useState } from 'react';

import {
  fetchBankAccounts,
  fetchBankAccountSnapshot,
  fetchDashboardOverview,
  fetchGroupMembers,
  fetchPortfolioPositions,
  fetchPortfolioSummary,
} from '../api';
import type {
  BankAccount,
  DashboardBankBalance,
  DashboardBudgetCategory,
  DashboardOverview as DashboardOverviewType,
  GroupMember,
  PortfolioPosition,
  PortfolioSummaryItem,
  UserContext,
} from '../types';
import { formatAmount } from '../utils/format';
import { fetchMoexPrices } from '../utils/moex';
import type { MoexPrice } from '../utils/moex';
import TransferDialog from '../components/TransferDialog';
import type { TransferSource, TransferTarget } from '../components/TransferDialog';
import AccountTransferDialog from '../components/AccountTransferDialog';
import CategoryDialog from '../components/CategoryDialog';
import CreateCategoryDialog from '../components/CreateCategoryDialog';
import ExpenseDialog from '../components/ExpenseDialog';
import IncomeDialog from '../components/IncomeDialog';
import Operations from './Operations';
import { IconAnalyticsDonut, IconClock, IconPlusCircle } from '../components/Icons';
import { parseCategoryIcon } from '../utils/categoryIcon';
import { CategorySvgIcon } from '../components/CategorySvgIcon';
import { useHints } from '../hooks/useHints';
import { hapticRigid } from '../telegram';

type DashboardBankHubMode = 'history' | 'analytics';

export default function Dashboard({ user }: { user: UserContext }) {
  const [overview, setOverview] = useState<DashboardOverviewType | null>(null);
  const [investmentAccounts, setInvestmentAccounts] = useState<BankAccount[]>([]);
  const [investmentBalancesByAccountId, setInvestmentBalancesByAccountId] = useState<Record<number, DashboardBankBalance[]>>({});
  const [portfolioSummaryItems, setPortfolioSummaryItems] = useState<PortfolioSummaryItem[]>([]);
  const [openPositions, setOpenPositions] = useState<PortfolioPosition[]>([]);
  const [moexPrices, setMoexPrices] = useState<Map<string, MoexPrice>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { hintsEnabled } = useHints();

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
  const [expenseCategory, setExpenseCategory] = useState<DashboardBudgetCategory | null>(null);
  const [transferTarget, setTransferTarget] = useState<TransferTarget | null>(null);
  const [transferInitialSourceId, setTransferInitialSourceId] = useState<number | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<DashboardBudgetCategory | null>(null);
  const suppressClickUntilRef = useRef(0);
  const [groupMembersByGroupId, setGroupMembersByGroupId] = useState<Record<number, GroupMember[]>>({});
  const [createDialogKind, setCreateDialogKind] = useState<'regular' | 'group' | null>(null);

  const activeSourceId = draggedCategoryId;

  /* ── swipe tracking ─────────────────────────────── */

  const swipeRef = useRef<{
    startX: number;
    startY: number;
    sourceId: number;
    kind: 'regular' | 'group' | 'free_budget';
    category: DashboardBudgetCategory | null;
    decided: boolean;
    isHorizontal: boolean;
    actionTriggered: boolean;
    element: HTMLElement | null;
  } | null>(null);

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

  const handleSwipeStart = (
    sourceId: number,
    kind: 'regular' | 'group' | 'free_budget',
    category: DashboardBudgetCategory | null,
    e: React.TouchEvent,
  ) => {
    swipeRef.current = {
      startX: e.touches[0].clientX,
      startY: e.touches[0].clientY,
      sourceId,
      kind,
      category,
      decided: false,
      isHorizontal: false,
      actionTriggered: false,
      element: e.currentTarget as HTMLElement,
    };
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

  const openTransferFromSwipe = (
    sourceId: number,
    kind: 'regular' | 'group' | 'free_budget',
    category: DashboardBudgetCategory | null,
  ) => {
    const categoryOwnerType = category?.owner_type || 'user';
    const swipeTarget: TransferTarget = kind === 'free_budget'
      ? {
          category_id: user.unallocated_category_id,
          name: overview?.has_family ? 'Свободный остаток (личный)' : 'Свободный остаток',
          kind: 'free_budget',
          owner_type: 'user',
          currency_code: overview?.base_currency_code || user.base_currency_code,
        }
      : {
          category_id: sourceId,
          name: category?.name || '',
          kind: category?.kind || 'regular',
          owner_type: categoryOwnerType,
          currency_code: category?.currency_code || (overview?.base_currency_code || user.base_currency_code),
        };

    const swipeInitialSource = kind === 'free_budget'
      ? null
      : categoryOwnerType === 'family' && overview?.family_unallocated_category_id
        ? overview.family_unallocated_category_id
        : user.unallocated_category_id;

    setTransferTarget(swipeTarget);
    setTransferInitialSourceId(swipeInitialSource);
    hapticRigid();
  };

  const handleSwipeMove = (e: React.TouchEvent) => {
    const s = swipeRef.current;
    if (!s || !s.element) return;
    if (s.actionTriggered) return;

    const touch = e.touches[0];
    const dx = touch.clientX - s.startX;
    const dy = touch.clientY - s.startY;

    if (!s.decided && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) {
      s.decided = true;
      s.isHorizontal = Math.abs(dx) > Math.abs(dy);
    }

    if (s.isHorizontal) {
      // free_budget/group: only left swipe; regular: both directions
      const minOffset = -80;
      const maxOffset = s.kind === 'regular' ? 80 : 0;
      const offset = Math.min(maxOffset, Math.max(minOffset, dx));
      s.element.style.transform = `translateX(${offset}px)`;
      s.element.style.transition = 'none';

      const actionThreshold = getSwipeActionThreshold(s.element);

      if (dx <= -actionThreshold) {
        s.actionTriggered = true;
        suppressClickUntilRef.current = Date.now() + 300;
        resetSwipeElement(s.element);
        openTransferFromSwipe(s.sourceId, s.kind, s.category);
      }
    }
  };

  const handleSwipeEnd = (e: React.TouchEvent) => {
    const s = swipeRef.current;
    swipeRef.current = null;
    if (!s) return;

    resetSwipeElement(s.element);

    if (s.actionTriggered) {
      return;
    }

    if (s.decided && s.isHorizontal) {
      suppressClickUntilRef.current = Date.now() + 300;
      const dx = e.changedTouches[0].clientX - s.startX;
      if (dx < -50) {
        openTransferFromSwipe(s.sourceId, s.kind, s.category);
      } else if (dx > 50 && s.kind === 'regular' && s.category) {
        // Right swipe → expense
        setExpenseCategory(s.category);
        hapticRigid();
      }
    }
  };

  /* ── data loading ───────────────────────────────── */

  const loadOverview = async () => {
    setLoading(true);
    setError(null);

    try {
      const [result, loadedInvestmentAccounts, loadedPortfolioSummary, loadedPositions] = await Promise.all([
        fetchDashboardOverview(user.bank_account_id),
        fetchBankAccounts('investment'),
        fetchPortfolioSummary(),
        fetchPortfolioPositions(),
      ]);
      const investmentSnapshots = await Promise.all(
        loadedInvestmentAccounts.map(async (account) => ({
          accountId: account.id,
          balances: await fetchBankAccountSnapshot(account.id),
        })),
      );
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
    setExpenseCategory(null);
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
      const t = pos.metadata?.ticker;
      const isBond = pos.metadata?.moex_market === 'bonds';
      if (typeof t === 'string' && t && !isBond) {
        const price = moexPrices.get(t);
        const currentPrice = price?.last ?? price?.prevClose ?? null;
        if (currentPrice !== null && pos.quantity) {
          marketValue += currentPrice * pos.quantity;
          continue;
        }
      }
      marketValue += pos.amount_in_currency;
    }
    return summary.cash_balance_in_base + marketValue;
  };

  const investmentBankTotal = investmentAccounts.reduce(
    (sum, account) => sum + getInvestmentAccountMarketTotal(account.id),
    0,
  );
  const totalBankWithInvestments = overview.total_bank_historical_in_base + investmentBankTotal;
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
      <h1 className="page-title">Обзор</h1>

      <article
        className="hero-card hero-card--clickable"
        role="button"
        tabIndex={0}
        onClick={() => { if (Date.now() < suppressClickUntilRef.current) return; setShowBankDetail(true); }}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setShowBankDetail(true); }}
        onTouchStart={hasFamily ? handleHeroSwipeStart : undefined}
        onTouchMove={hasFamily ? handleHeroSwipeMove : undefined}
        onTouchEnd={hasFamily ? handleHeroSwipeEnd : undefined}
      >
        <span className="hero-card__label">Банк по себестоимости</span>
        <strong className="hero-card__value">
          {formatAmount(totalBankWithInvestments, overview.base_currency_code)}
        </strong>
        {hasFamily ? (
          <>
            <div className="hero-card__breakdown">
              <div className="hero-card__breakdown-row">
                <span>Личный счет</span>
                <strong>{formatAmount(personalBankTotal, overview.base_currency_code)}</strong>
              </div>
              <div className="hero-card__breakdown-row">
                <span>Семейный счет</span>
                <strong>{formatAmount(familyBankTotal, overview.base_currency_code)}</strong>
              </div>
              <div className="hero-card__breakdown-row">
                <span>Инвестиции</span>
                <strong>{formatAmount(investmentBankTotal, overview.base_currency_code)}</strong>
              </div>
            </div>
            {hintsEnabled && (
              <span className="hero-card__sub">← свайп для перевода между счетами</span>
            )}
          </>
        ) : (
          <>
            <div className="hero-card__breakdown">
              <div className="hero-card__breakdown-row">
                <span>Личный счет</span>
                <strong>{formatAmount(personalBankTotal, overview.base_currency_code)}</strong>
              </div>
              <div className="hero-card__breakdown-row">
                <span>Инвестиции</span>
                <strong>{formatAmount(investmentBankTotal, overview.base_currency_code)}</strong>
              </div>
            </div>
          </>
        )}
        <div className="dashboard-bank-actions" onClick={(e) => e.stopPropagation()}>
          <button
            className="dashboard-bank-action"
            type="button"
            onClick={() => openBankHub('history')}
          >
            <span className="dashboard-bank-action__icon">
              <IconClock />
            </span>
            <span className="dashboard-bank-action__label">Операции</span>
          </button>
          <button
            className="dashboard-bank-action"
            type="button"
            onClick={() => setShowIncomeDialog(true)}
          >
            <span className="dashboard-bank-action__icon">
              <IconPlusCircle />
            </span>
            <span className="dashboard-bank-action__label">Пополнить</span>
          </button>
          <button
            className="dashboard-bank-action"
            type="button"
            onClick={() => openBankHub('analytics')}
          >
            <span className="dashboard-bank-action__icon">
              <IconAnalyticsDonut />
            </span>
            <span className="dashboard-bank-action__label">Аналитика</span>
          </button>
        </div>
      </article>

      <section className="section">
        <div className="section__header">
          <div>
            <div className="section__eyebrow">Бюджет</div>
            <h2 className="section__title">Как распределены деньги по категориям</h2>
          </div>
        </div>
        <div className="panel">
          <div className="dashboard-transfer-source">
            <div
              className={[
                'balance-card',
                'balance-card--draggable',
                'swipeable',
                activeSourceId !== null && activeSourceId !== personalFreeBudgetSource.category_id && draggedOwnerType === 'user'
                  ? 'balance-card--valid-target'
                  : '',
                activeSourceId === personalFreeBudgetSource.category_id ? 'balance-card--active-source' : '',
                draggedCategoryId === personalFreeBudgetSource.category_id ? 'balance-card--dragging' : '',
                dropTargetCategoryId === freeBudgetTarget.category_id ? 'balance-card--drop-target' : '',
              ].join(' ').trim()}
              draggable={personalFreeBudgetSource.balance > 0}
              onDragStart={(e) => {
                if (personalFreeBudgetSource.balance > 0) handleDragStart(personalFreeBudgetSource, e);
              }}
              onDragEnd={handleDragEnd}
              onDragOver={(event) => {
                if (activeSourceId === null || activeSourceId === freeBudgetTarget.category_id || draggedOwnerType !== 'user') return;
                event.preventDefault();
                setDropTargetCategoryId(freeBudgetTarget.category_id);
              }}
              onDragLeave={() => {
                if (dropTargetCategoryId === freeBudgetTarget.category_id) {
                  setDropTargetCategoryId(null);
                }
              }}
              onDrop={(event) => {
                event.preventDefault();
                handleDropOnCategory(freeBudgetTarget);
              }}
              onTouchStart={(e) => handleSwipeStart(personalFreeBudgetSource.category_id, 'free_budget', null, e)}
              onTouchMove={handleSwipeMove}
              onTouchEnd={handleSwipeEnd}
              onClick={() => {
                if (Date.now() < suppressClickUntilRef.current) return;
                if (activeSourceId !== null && activeSourceId !== freeBudgetTarget.category_id && draggedOwnerType === 'user') {
                  openTransferDialog(freeBudgetTarget, activeSourceId);
                }
              }}
            >
              <div className="balance-card__head">
                <span className="pill">Свободный остаток</span>
              </div>
              {hasFamily ? (
                <div className="balance-card__split">
                  <div className="balance-card__split-row">
                    <span className="balance-card__split-label">Личный</span>
                    <strong className="balance-card__split-amount">
                      {formatAmount(overview.personal_free_budget_in_base, overview.base_currency_code)}
                    </strong>
                  </div>
                  <div className="balance-card__split-row">
                    <span className="balance-card__split-label">Семейный</span>
                    <strong className="balance-card__split-amount">
                      {formatAmount(overview.family_free_budget_in_base, overview.base_currency_code)}
                    </strong>
                  </div>
                </div>
              ) : (
                <strong className="balance-card__amount">
                  {formatAmount(overview.free_budget_in_base, overview.base_currency_code)}
                </strong>
              )}
              <div className="balance-card__sub">
                {fxResultSummary || (hintsEnabled ? 'Свайпни влево для перевода. Сюда тоже можно вернуть из категории.' : null)}
              </div>
              {fxResultSummary && hintsEnabled ? (
                <div className="balance-card__hint">
                  Свайпни влево для перевода. Сюда тоже можно вернуть из категории.
                </div>
              ) : null}
            </div>
          </div>
          <div className="dashboard-budget-sections">
            <div className="dashboard-budget-section">
              <div className="dashboard-budget-section__header">
                <div className="section__eyebrow">Категории</div>
                <button
                  className="btn btn--icon"
                  type="button"
                  onClick={() => setCreateDialogKind('regular')}
                  aria-label="Добавить категорию"
                  title="Добавить категорию"
                >
                  +
                </button>
              </div>
              {regularBudgetCategories.length === 0 ? (
                <p className="list-row__sub">Обычных категорий пока нет.</p>
              ) : (
                <ul className="cat-grid">
                  {[
                    ...personalRegular,
                    ...(hasFamily && familyRegular.length > 0 && personalRegular.length > 0 ? [null] : []),
                    ...familyRegular,
                  ].map((category) => {
                    if (category === null) {
                      return <li className="cat-grid__divider" key="cat-family-divider" aria-hidden="true">Семейные</li>;
                    }

                    const isDropTarget = dropTargetCategoryId === category.category_id;
                    const isActiveSource = activeSourceId === category.category_id;
                    const isValidTarget = activeSourceId !== null && activeSourceId !== category.category_id
                      && (!hasFamily || draggedOwnerType === category.owner_type);

                    return (
                      <li
                        className={[
                          'cat-card',
                          'swipeable',
                          draggedCategoryId === category.category_id ? 'cat-card--dragging' : '',
                          isActiveSource ? 'cat-card--active-source' : '',
                          isDropTarget ? 'cat-card--drop-target' : '',
                          isValidTarget ? 'cat-card--valid-target' : '',
                        ].join(' ').trim()}
                        key={category.category_id}
                        draggable
                        role="button"
                        tabIndex={0}
                        onDragStart={(e) => handleDragStart({ ...category, owner_type: category.owner_type }, e)}
                        onDragEnd={handleDragEnd}
                        onTouchStart={(e) => handleSwipeStart(category.category_id, 'regular', category, e)}
                        onTouchMove={handleSwipeMove}
                        onTouchEnd={handleSwipeEnd}
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
                        onDragLeave={() => {
                          if (dropTargetCategoryId === category.category_id) setDropTargetCategoryId(null);
                        }}
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
                        {(() => {
                          const parsed = parseCategoryIcon(category.name);
                          return (
                            <>
                              {parsed.icon && !isValidTarget && (
                                <span className="cat-card__icon">
                                  {parsed.kind === 'svg'
                                    ? <CategorySvgIcon code={parsed.icon} />
                                    : parsed.icon}
                                </span>
                              )}
                              <span className="cat-card__name">
                                {isValidTarget ? 'Перевести сюда' : parsed.displayName}
                              </span>
                              <strong className="cat-card__amount">
                                {formatAmount(category.balance, category.currency_code)}
                              </strong>
                              {!isValidTarget && hintsEnabled && (
                                <span className="cat-card__hint">← перевод · расход →</span>
                              )}
                            </>
                          );
                        })()}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            <div className="dashboard-budget-section dashboard-budget-section--groups">
              <div className="dashboard-budget-section__header">
                <div className="section__eyebrow">Группы</div>
                <button
                  className="btn btn--icon"
                  type="button"
                  onClick={() => setCreateDialogKind('group')}
                  aria-label="Добавить группу"
                  title="Добавить группу"
                >
                  +
                </button>
              </div>
              {groupBudgetCategories.length === 0 ? (
                <p className="list-row__sub">Групп пока нет.</p>
              ) : (
                <ul className="groups-list">
                  {[
                    ...[...personalGroups].sort((a, b) => {
                      const aMembers = groupMembersByGroupId[a.category_id] ?? [];
                      const bMembers = groupMembersByGroupId[b.category_id] ?? [];
                      if (bMembers.length !== aMembers.length) return bMembers.length - aMembers.length;
                      const aSubGroups = aMembers.filter((m) => m.child_category_kind === 'group').length;
                      const bSubGroups = bMembers.filter((m) => m.child_category_kind === 'group').length;
                      return bSubGroups - aSubGroups;
                    }),
                    ...(hasFamily && familyGroups.length > 0 && personalGroups.length > 0 ? [null] : []),
                    ...[...familyGroups].sort((a, b) => {
                      const aMembers = groupMembersByGroupId[a.category_id] ?? [];
                      const bMembers = groupMembersByGroupId[b.category_id] ?? [];
                      if (bMembers.length !== aMembers.length) return bMembers.length - aMembers.length;
                      const aSubGroups = aMembers.filter((m) => m.child_category_kind === 'group').length;
                      const bSubGroups = bMembers.filter((m) => m.child_category_kind === 'group').length;
                      return bSubGroups - aSubGroups;
                    }),
                  ].map((category) => {
                    if (category === null) {
                      return (
                        <li className="groups-list__divider" key="family-divider" aria-hidden="true">
                          Семейные
                        </li>
                      );
                    }

                    const isDropTarget = dropTargetCategoryId === category.category_id;
                    const isValidTarget = activeSourceId !== null && activeSourceId !== category.category_id
                      && (!hasFamily || draggedOwnerType === category.owner_type);
                    const groupMembers = groupMembersByGroupId[category.category_id] || [];
                    const groupComposition = groupMembers.length > 0
                      ? groupMembers
                          .map((member) => `${member.child_category_kind === 'group' ? 'Группа ' : ''}${member.child_category_name} ${Number((member.share * 100).toFixed(2))}%`)
                          .join(' · ')
                      : 'Состав группы пока не настроен';
                    const groupBalance = groupMembers.length > 0
                      ? groupMembers.reduce(
                          (sum, member) => sum + getNestedGroupBalance(member.child_category_id, new Set([category.category_id])),
                          0,
                        )
                      : 0;

                    return (
                      <li
                        className={[
                          'dashboard-budget-row',
                          'list-row',
                          'list-row--interactive',
                          'list-row--group',
                          'swipeable',
                          isDropTarget ? 'list-row--drop-target' : '',
                          isValidTarget ? 'list-row--valid-target' : '',
                        ].join(' ').trim()}
                        key={category.category_id}
                        role="button"
                        tabIndex={0}
                        onDragEnd={handleDragEnd}
                        onTouchStart={(e) => handleSwipeStart(category.category_id, 'group', category, e)}
                        onTouchMove={handleSwipeMove}
                        onTouchEnd={handleSwipeEnd}
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
                        onDragLeave={() => {
                          if (dropTargetCategoryId === category.category_id) setDropTargetCategoryId(null);
                        }}
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
                        <div className="dashboard-budget-row__main">
                          <div className="list-row__title">{category.name}</div>
                          <div className="list-row__sub">
                            {isValidTarget
                              ? 'Нажми, чтобы перевести сюда'
                              : hintsEnabled ? 'Группа распределения · нажми для редактирования' : null}
                          </div>
                          <div className="list-row__meta">{groupComposition}</div>
                        </div>
                        <div className="dashboard-budget-row__side">
                          <div className="list-row__value">
                            {formatAmount(groupBalance, category.currency_code)}
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        </div>
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
        <CategoryDialog
          category={selectedCategory}
          onClose={() => setSelectedCategory(null)}
          onSuccess={() => void handleDialogSuccess()}
        />
      )}

      {expenseCategory && (
        <ExpenseDialog
          category={expenseCategory}
          user={user}
          familyBankAccountId={overview.family_bank_account_id}
          onClose={() => setExpenseCategory(null)}
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
          personalBalances={overview.bank_balances}
          familyBalances={overview.family_bank_balances}
          onClose={() => setShowAccountTransfer(false)}
          onSuccess={() => { setShowAccountTransfer(false); void loadOverview(); }}
        />
      )}

      {showBankDetail && (
        <div className="modal-backdrop" onClick={() => setShowBankDetail(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="section__header">
                <div>
                  <div className="section__eyebrow">Банк</div>
                  <h2 className="section__title">Сколько денег лежит по валютам</h2>
                </div>
              </div>
            </div>
            <div className="modal-body">
              <div className="dashboard-budget-sections">
                <div className="dashboard-budget-section">
                  <div className="dashboard-budget-section__header">
                    <div className="section__eyebrow">Личный счет</div>
                  </div>
                  {overview.bank_balances.length === 0 ? (
                    <p className="list-row__sub">На личном счете пока нет валютных остатков.</p>
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
                      <div className="section__eyebrow">Семейный счет</div>
                    </div>
                    {overview.family_bank_balances.length === 0 ? (
                      <p className="list-row__sub">На семейном счете пока нет валютных остатков.</p>
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

                <div className="dashboard-budget-section">
                  <div className="dashboard-budget-section__header">
                    <div className="section__eyebrow">Инвестиции</div>
                  </div>
                  {investmentAccounts.length === 0 ? (
                    <p className="list-row__sub">Инвестиционных счетов пока нет.</p>
                  ) : (
                    <div className="dashboard-budget-sections">
                      {investmentAccounts.map((account) => {
                        const balances = investmentBalancesByAccountId[account.id] ?? [];
                        const summary = investmentSummaryByAccountId[account.id];
                        return (
                          <div className="dashboard-budget-section" key={`investment-${account.id}`}>
                            <div className="dashboard-budget-section__header">
                              <div className="section__title" style={{ fontSize: '1rem' }}>{account.name}</div>
                              {(summary || balances.length > 0) ? (
                                <span className="tag tag--neutral">
                                  {formatAmount(getInvestmentAccountMarketTotal(account.id), overview.base_currency_code)}
                                </span>
                              ) : null}
                            </div>
                            {summary ? (
                              <div className="list-row__sub" style={{ marginBottom: balances.length > 0 ? '0.5rem' : 0 }}>
                                Свободно {formatAmount(summary.cash_balance_in_base, overview.base_currency_code)}
                                {' · '}
                                Вложено {formatAmount(summary.invested_principal_in_base, overview.base_currency_code)}
                              </div>
                            ) : null}
                            {balances.length === 0 ? (
                              <p className="list-row__sub">На этом счете пока нет валютных остатков.</p>
                            ) : (
                              <ul className="bank-detail-list">
                                {balances.map((balance) => (
                                  <li className="bank-detail-row" key={`investment-${account.id}-${balance.currency_code}`}>
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
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </div>
            <div className="modal-actions">
              <button className="btn" type="button" onClick={() => setShowBankDetail(false)}>
                Закрыть
              </button>
            </div>
          </div>
        </div>
      )}

      {showBankHub && (
        <div className="modal-backdrop" onClick={() => setShowBankHub(false)}>
          <div className="modal-card modal-card--wide" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="section__header">
                <div>
                  <div className="section__eyebrow">Банк</div>
                  <h2 className="section__title">
                    {bankHubMode === 'analytics' ? 'Аналитика' : 'Операции'}
                  </h2>
                </div>
              </div>
            </div>
            <div className="modal-body">
              <Operations
                user={user}
                embedded
                initialViewMode={bankHubMode === 'analytics' ? 'analytics' : 'history'}
              />
            </div>
            <div className="modal-actions">
              <button className="btn" type="button" onClick={() => setShowBankHub(false)}>
                Закрыть
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
