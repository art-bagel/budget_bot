import InvestmentCostAnalytics from '../components/InvestmentCostAnalytics';
import PaRow, { PA_COLORS } from '../components/PaRow';
import CollectibleImage from '../components/CollectibleImage';
import CollectionShelf, { CollectibleHero } from '../components/CollectionShelf';
import { cryptoAssetLabel, cryptoNetworkLabel, cryptoNetworkSuffix, cryptoPriceSourceLabel, cryptoQuoteTime } from '../utils/cryptoAssetLabel';
import FeeRefundSheet from '../components/FeeRefundSheet';
import LiquidityActionSheet from '../components/LiquidityActionSheet';
import { walletPositions } from '../utils/cryptoWalletPositions';
import { setCryptoAssetHidden } from '../api';
import { isEmptyProtocolPosition, protocolMarketValue, sumProtocolValues, knownProtocolValues, walletMarketValue } from '../utils/cryptoProtocolValuation';
import CryptoCorrectionSheet from '../components/CryptoCorrectionSheet';
import { useCryptoRequestKey } from '../hooks/useCryptoRequestKey';
import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import SplashScreen from '../components/SplashScreen';
import RefreshBar from '../components/RefreshBar';
import { TrendingUp, Landmark, Coins, Package, Info, Trash2, ChevronDown, Pencil, Check, ChevronRight, Plus, ArrowDownToLine, ArrowUpFromLine, HandCoins, Percent, Gift, RefreshCw, Link2, X, Zap, Ticket, PieChart, Droplets, type LucideIcon } from 'lucide-react';
import { CategorySvgIcon } from '../components/CategorySvgIcon';

import {
  cancelPortfolioIncome,
  editCollectibleDetails,
  changeDepositRate,
  closePortfolioPosition,
  createBankAccount,
  deletePortfolioPosition,
  fetchBankAccountSnapshot,
  fetchBankAccounts,
  fetchCurrencies,
  fetchPortfolioEvents,
  fetchPortfolioPositions,
  fetchPortfolioSummary,
  fetchTinkoffLivePrices,
  getTinkoffInstrumentLogoUrl,
  getTinkoffConnections,
  partialClosePortfolioPosition,
  recordPortfolioFee,
  recordPortfolioIncome,
  topUpPortfolioPosition,
  fetchPortfolioAnalytics,
  fetchCryptoProtocolPositions,
  fetchCryptoLivePrices,
  fetchCryptoAssets,
  fetchCryptoAccountAssets,
  createCryptoProtocolPosition,
  updateCryptoProtocolPosition,
  closeCryptoProtocolPosition,
  transferCryptoFromInvestment,
  sellCollectibleForCrypto,
  chargeCollectibleCoin,
  transferCryptoBetweenInvestmentAccounts,
  swapCryptoInvestmentAsset,
} from '../api';
import BottomSheet from '../components/BottomSheet';
import PortfolioPositionDialog from '../components/PortfolioPositionDialog';
import TinkoffSyncDialog from '../components/TinkoffSyncDialog';
import CryptoAssetSheet from '../components/CryptoAssetSheet';
import CryptoIncomeSheet from '../components/CryptoIncomeSheet';
import CryptoProtocolHistory from '../components/CryptoProtocolHistory';
import CryptoProtocolPartialCloseSheet from '../components/CryptoProtocolPartialCloseSheet';
import CryptoSwapSheet from '../components/CryptoSwapSheet';
import CryptoWithdrawSheet from '../components/CryptoWithdrawSheet';
import CryptoTransferSheet from '../components/CryptoTransferSheet';
import {
  LpAddLiquiditySheet,
  LpCloseSheet,
  LpClaimFeesSheet,
} from '../components/CryptoLpActionSheets';
import {
  LendingTopUpSheet,
  LendingTakeDebtSheet,
  LendingRepayDebtSheet,
  LendingAdjustSheet,
  LendingDebtEventSheet,
  LendingGroupSheet,
  LendingPartialWithdrawSheet,
  LendingCloseSheet,
} from '../components/CryptoLendingActionSheets';
import { DefiFeeField, EMPTY_FEE_DRAFT, manualFee } from '../components/DefiFeeField';
import type { DefiFeeDraft } from '../components/DefiFeeField';
import type {
  BankAccount,
  Currency,
  DashboardBankBalance,
  ExternalConnection,
  PortfolioEvent,
  PortfolioPosition,
  PortfolioSummaryItem,
  TinkoffLivePrice,
  CryptoLivePrice,
  CryptoAccountAssetSummary,
  UserContext,
  PortfolioAnalyticsData,
  PortfolioAnalyticsMonthlyItem,
  CryptoProtocolPosition,
  CryptoAsset,
} from '../types';
import { PROTOCOL_TYPE_LABELS, getLendingMetadata, getLiquidityPoolMetadata } from '../types';
import { calculateProjectedInterest } from '../utils/depositInterest';
import { collectibleSaleLabel, collectibleFlag, getCollectibleKind, isSealedPack, safeItemLink } from '../utils/collectibles';
import type { DepositKind, InterestPayout, CapitalizationPeriod } from '../utils/depositInterest';
import { formatAmount, formatNumericAmount, currencySymbol, pluralRu } from '../utils/format';
import { sanitizeDecimalInput } from '../utils/validation';
import { defiCoinSymbols, getCryptoIconUrl } from '../utils/cryptoAssets';
import { CoinStack } from '../components/CoinStack';
import { trimDecimal } from '../utils/portfolioPosition';
import { fetchMoexPrices } from '../utils/moex';
import type { MoexPrice } from '../utils/moex';
import Operations from './Operations';


type AccountWithBalances = {
  account: BankAccount;
  balances: DashboardBankBalance[];
};

type CloseDraft = {
  amount: string;
  amountEdited: boolean;
  currencyCode: string;
  baseAmount: string;
  closedAt: string;
  comment: string;
};

type IncomeDraft = {
  amount: string;
  quantity: string;
  currencyCode: string;
  baseAmount: string;
  incomeKind: string;
  destination: 'account' | 'position';
  receivedAt: string;
  comment: string;
};

type TopUpDraft = {
  resolvePurchasePrice?: boolean;
  allocationPositionIds?: number[];
  amount: string;
  quantity: string;
  currencyCode: string;
  toppedUpAt: string;
  comment: string;
};

type PartialCloseDraft = {
  returnAmount: string;
  returnCurrencyCode: string;
  returnBaseAmount: string;
  principalReduction: string;
  principalEditedManually: boolean;
  closedQuantity: string;
  closedAt: string;
  comment: string;
};

type FeeDraft = {
  amount: string;
  currencyCode: string;
  chargedAt: string;
  comment: string;
};

type RateChangeDraft = {
  newRate: string;
  effectiveDate: string;
};


type ProtocolPositionType = 'staking' | 'lending' | 'liquidity_pool';

type StakingCreateDraft = {
  positionType: ProtocolPositionType;
  sourcePositionId: string;
  protocolName: string;
  quantity: string;
  rewardsUnclaimedInBase: string;
  depositedAt: string;
  comment: string;
  apr: string;
  borrowedCryptoAssetId: string;
  borrowedQuantity: string;
  poolName: string;
  pairSourcePositionId: string;
  pairQuantity: string;
};

type StakingUpdateDraft = {
  currentQuantity: string;
  rewardsClaimedInBase: string;
  rewardsUnclaimedInBase: string;
  comment: string;
};

type StakingCloseDraft = {
  returnQuantity: string;
  withdrawnAt: string;
  comment: string;
};


type PortfolioAssetTab = {
  code: string;
  label: string;
  openCount: number;
  closedCount: number;
  principalInBase: number;
  incomeInBase: number;
  totalInBase: number;
  valuationIncomplete: boolean;
};

type PositionAccountGroup = {
  accountId: number;
  accountName: string;
  ownerType: 'user' | 'family';
  positions: PortfolioPosition[];
};

type PositionAccountTab = {
  key: string;
  accountName: string;
  ownerLabel: string | null;
  openCount: number;
  estimatedValue: number;
};

type SecuritySection = {
  code: string;
  label: string;
  positions: PortfolioPosition[];
};

type PortfolioAnalyticsBucket = {
  key: string;
  label: string;
  estimatedValue: number;
  investedPrincipal: number;
  nkdValue: number;
  currentResult: number;
  positionsCount: number;
  share: number;
};

type PortfolioAnalyticsAccountItem = {
  isCrypto: boolean;
  isCollection: boolean;
  valuationIncomplete: boolean;
  basisIncomplete: boolean;
  key: string;
  accountName: string;
  ownerLabel: string | null;
  estimatedValue: number;
  investedPrincipal: number;
  nkdValue: number;
  cashValue: number;
  resultValue: number;
  positionsCount: number;
};

type PortfolioAnalyticsLeader = {
  positionId: number;
  title: string;
  ticker: string | null;
  accountName: string;
  quantityLabel: string | null;
  estimatedValue: number;
  currentResult: number | null;
  logoUrl: string | null;
  share: number;
};

const ASSET_TYPE_OPTIONS = [
  { value: 'security', label: 'Ценные бумаги' },
  { value: 'deposit', label: 'Депозит' },
  { value: 'crypto', label: 'Криптовалюта' },
  { value: 'other', label: 'Разное' },
  { value: 'collectible', label: 'Коллекции' },
] as const;

const DEFAULT_PORTFOLIO_ASSET_TYPE_CODES = ['security', 'deposit', 'crypto', 'other', 'collectible'] as const;

const SECURITY_KIND_OPTIONS = [
  { value: 'stock', label: 'Акции' },
  { value: 'bond', label: 'Облигации' },
  { value: 'fund', label: 'Фонды' },
] as const;

type PaMeta = { Icon: LucideIcon; color: (typeof PA_COLORS)[number] };
const PA_ASSET_TYPE_META: Record<string, PaMeta> = {
  security: { Icon: TrendingUp, color: 'b' },
  deposit: { Icon: Landmark, color: 'g' },
  crypto: { Icon: Coins, color: 'r' },
  other: { Icon: Package, color: 'p' },
  collectible: { Icon: Gift, color: 'v' },
};
const TYPE_TILES = [
  { code: 'security', label: 'Ценные бумаги', sub: 'Акции, облигации, фонды', tint: 'b', icon: <TrendingUp size={20} strokeWidth={2} /> },
  { code: 'deposit', label: 'Депозит', sub: 'Вклад или накопительный', tint: 'g', icon: <Landmark size={20} strokeWidth={2} /> },
  { code: 'crypto', label: 'Крипта', sub: 'BTC, ETH, GRAM и другие', tint: 'o', icon: <Coins size={20} strokeWidth={2} /> },
  { code: 'other', label: 'Другое', sub: 'Металлы, ЗПИФ и прочее', tint: 'p', icon: <Package size={20} strokeWidth={2} /> },
  { code: 'collectible', label: 'Коллекции', sub: 'Подарки, стикеры, скины, предметы', tint: 'v', icon: <Gift size={20} strokeWidth={2} /> },
] as const;
const PA_SECURITY_KIND_META: Record<string, PaMeta> = {
  stock: { Icon: TrendingUp, color: 'b' },
  bond: { Icon: Ticket, color: 'o' },
  fund: { Icon: PieChart, color: 'v' },
};
const PA_INCOME_KIND_META: Record<string, PaMeta> = {
  dividend: { Icon: TrendingUp, color: 'g' },
  coupon: { Icon: Ticket, color: 'b' },
  interest: { Icon: Percent, color: 'o' },
  reward: { Icon: Gift, color: 'p' },
  staking: { Icon: Coins, color: 'v' },
  lending: { Icon: HandCoins, color: 'r' },
  liquidity: { Icon: Droplets, color: 'b' },
  other: { Icon: Package, color: 'v' },
};

const INCOME_KIND_LABELS: Record<string, string> = {
  dividend: 'Дивиденды',
  interest: 'Проценты',
  coupon: 'Купоны',
  reward: 'Награды',
  staking: 'Стейкинг',
  lending: 'Лендинг',
  liquidity: 'Пулы ликвидности',
  other: 'Прочее',
};

function getAnalyticsPeriodRange(
  periodType: 'month' | 'quarter' | 'year',
  offset: number,
): { dateFrom: string; dateTo: string; label: string } {
  const now = new Date();
  let start: Date;
  let end: Date;
  let label: string;

  if (periodType === 'month') {
    start = new Date(now.getFullYear(), now.getMonth() + offset, 1);
    end = new Date(start.getFullYear(), start.getMonth() + 1, 0);
    label = start.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' });
  } else if (periodType === 'quarter') {
    const currentQuarter = Math.floor(now.getMonth() / 3);
    const targetQuarter = currentQuarter + offset;
    const targetYear = now.getFullYear() + Math.floor(targetQuarter / 4);
    const targetQuarterInYear = ((targetQuarter % 4) + 4) % 4;
    start = new Date(targetYear, targetQuarterInYear * 3, 1);
    end = new Date(targetYear, targetQuarterInYear * 3 + 3, 0);
    label = `${targetQuarterInYear + 1} кв. ${targetYear}`;
  } else {
    const targetYear = now.getFullYear() + offset;
    start = new Date(targetYear, 0, 1);
    end = new Date(targetYear, 11, 31);
    label = String(targetYear);
  }

  return {
    dateFrom: start.toISOString().slice(0, 10),
    dateTo: end.toISOString().slice(0, 10),
    label,
  };
}

function incomeKindLabel(kind: string): string {
  return INCOME_KIND_LABELS[kind] ?? kind.charAt(0).toUpperCase() + kind.slice(1);
}


function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

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

function formatDateLabel(value: string): string {
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date(value));
}

function assetTypeIconColor(code: string): { icon: string; color: string } {
  if (code === 'security') return { icon: 'chart', color: 'b' };
  if (code === 'deposit')  return { icon: 'landmark', color: 'g' };
  if (code === 'crypto')   return { icon: 'coins', color: 'o' };
  if (code === 'collectible') return { icon: 'gift', color: 'v' };
  return { icon: 'package', color: 'p' };
}

function assetTypeLabel(assetTypeCode: string): string {
  const knownLabel = ASSET_TYPE_OPTIONS.find((item) => item.value === assetTypeCode)?.label;
  if (knownLabel) {
    return knownLabel;
  }

  return assetTypeCode
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatUnitPrice(amount: number, quantity: number | null | undefined, currencyCode: string): string | null {
  if (!quantity || quantity <= 0) {
    return null;
  }

  return formatAmount(amount / quantity, currencyCode);
}

function getSecurityKindCode(position: PortfolioPosition): string {
  return typeof position.metadata?.security_kind === 'string' && position.metadata.security_kind.trim()
    ? position.metadata.security_kind
    : 'stock';
}

function getSecurityKindLabel(code: string): string {
  const knownLabel = SECURITY_KIND_OPTIONS.find((option) => option.value === code)?.label;
  if (knownLabel) {
    return knownLabel;
  }

  return code
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function getPositionAccountKey(position: Pick<PortfolioPosition, 'investment_account_owner_type' | 'investment_account_id'>): string {
  return `${position.investment_account_owner_type}:${position.investment_account_id}`;
}

function getInvestmentAccountAssetType(account: BankAccount): string {
  return account.investment_asset_type ?? 'security';
}

function isSameAccountOwner(account: BankAccount, position: PortfolioPosition): boolean {
  return account.owner_type === position.investment_account_owner_type;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Formats a numeric amount as a plain, editable input string (no thousands separators). */
function formatAmountInput(value: number): string {
  if (!Number.isFinite(value) || value === 0) return '';
  return String(round2(value));
}

type DepositCloseInfo = {
  isDeposit: boolean;
  /** Interest is capitalized into the body instead of being credited to the account separately. */
  capitalized: boolean;
  /** Current principal of the deposit. */
  body: number;
  /** Interest accrued from the last accrual date up to the close date. */
  interest: number;
  /** Suggested value for the "Сумма выхода" field. */
  suggestedAmount: number;
  /** Total that will actually land on the linked account. */
  totalToAccount: number;
};

/**
 * Mirrors the backend close flow (portfolio.close_portfolio_position → _accrue_deposit_interest):
 * on close, interest is accrued up to closed_at, then the entered amount is returned as principal.
 * For at_end / monthly deposits the interest is credited to the account on top of the amount;
 * for capitalized deposits it is folded into the body, so the amount must already include it.
 */
function getDepositCloseInfo(
  position: PortfolioPosition,
  closedAtIso: string,
  amountOverride?: number,
): DepositCloseInfo {
  const meta = position.metadata ?? {};
  const kind = meta.deposit_kind as DepositKind | undefined;
  const body = position.amount_in_currency ?? 0;
  const isDeposit = position.asset_type_code === 'deposit'
    && (kind === 'term_deposit' || kind === 'savings_account');

  if (!isDeposit) {
    return { isDeposit: false, capitalized: false, body, interest: 0, suggestedAmount: body, totalToAccount: body };
  }

  const payout = meta.interest_payout as InterestPayout | undefined;
  const capitalized = kind === 'savings_account' || payout === 'capitalize';
  const accrualBase = typeof meta.last_accrual_date === 'string' && meta.last_accrual_date
    ? meta.last_accrual_date
    : position.opened_at;

  const interest = calculateProjectedInterest({
    depositKind: kind as DepositKind,
    principal: body,
    annualRate: Number(meta.interest_rate ?? 0),
    startDate: accrualBase,
    endDate: closedAtIso,
    interestPayout: payout,
    capitalizationPeriod: meta.capitalization_period as CapitalizationPeriod | undefined,
  });

  const suggestedAmount = capitalized ? round2(body + interest) : round2(body);
  const amount = amountOverride ?? suggestedAmount;
  const totalToAccount = capitalized ? round2(amount) : round2(amount + interest);

  return { isDeposit: true, capitalized, body, interest, suggestedAmount, totalToAccount };
}

function createInitialCloseDraft(position: PortfolioPosition): CloseDraft {
  const info = getDepositCloseInfo(position, todayIso());
  return {
    amount: info.isDeposit ? formatAmountInput(info.suggestedAmount) : '',
    amountEdited: false,
    currencyCode: position.currency_code,
    baseAmount: '',
    closedAt: todayIso(),
    comment: '',
  };
}

function createInitialIncomeDraft(position: PortfolioPosition): IncomeDraft {
  return {
    amount: '',
    quantity: '',
    currencyCode: position.currency_code,
    baseAmount: '',
    incomeKind: position.asset_type_code === 'deposit'
      ? 'interest'
      : position.asset_type_code === 'security'
        ? 'dividend'
        : position.asset_type_code === 'crypto'
          ? 'reward'
          : 'other',
    destination: position.asset_type_code === 'deposit' || position.asset_type_code === 'crypto' ? 'position' : 'account',
    receivedAt: todayIso(),
    comment: '',
  };
}

function createInitialTopUpDraft(position: PortfolioPosition): TopUpDraft {
  return {
    amount: '',
    quantity: '',
    currencyCode: position.currency_code,
    toppedUpAt: todayIso(),
    comment: '',
  };
}

function createInitialPartialCloseDraft(position: PortfolioPosition): PartialCloseDraft {
  return {
    returnAmount: '',
    returnCurrencyCode: position.currency_code,
    returnBaseAmount: '',
    principalReduction: '',
    principalEditedManually: false,
    closedQuantity: '',
    closedAt: todayIso(),
    comment: '',
  };
}

function createInitialFeeDraft(position: PortfolioPosition): FeeDraft {
  return {
    amount: '',
    currencyCode: position.currency_code,
    chargedAt: todayIso(),
    comment: '',
  };
}

function createInitialStakingCreateDraft(defaultSourcePositionId?: number): StakingCreateDraft {
  return {
    positionType: 'staking',
    sourcePositionId: defaultSourcePositionId ? String(defaultSourcePositionId) : '',
    protocolName: '',
    quantity: '',
    rewardsUnclaimedInBase: '',
    depositedAt: todayIso(),
    comment: '',
    apr: '',
    borrowedCryptoAssetId: '',
    borrowedQuantity: '',
    poolName: '',
    pairSourcePositionId: '',
    pairQuantity: '',
  };
}

function createInitialStakingUpdateDraft(position: CryptoProtocolPosition): StakingUpdateDraft {
  return {
    currentQuantity: position.current_quantity != null ? String(position.current_quantity) : '',
    rewardsClaimedInBase: String(position.rewards_claimed_in_base ?? 0),
    rewardsUnclaimedInBase: String(position.rewards_unclaimed_in_base ?? 0),
    comment: position.comment ?? '',
  };
}

function createInitialStakingCloseDraft(position: CryptoProtocolPosition): StakingCloseDraft {
  return {
    returnQuantity: trimDecimal(position.current_quantity_exact ?? (position.current_quantity != null ? String(position.current_quantity) : '')),
    withdrawnAt: todayIso(),
    comment: '',
  };
}

function canRecordPositionIncome(position: PortfolioPosition): boolean {
  return position.asset_type_code === 'security'
    || position.asset_type_code === 'deposit'
    || position.asset_type_code === 'crypto'
    || position.asset_type_code === 'other';
}

function getPositionRealizedResult(position: PortfolioPosition): number {
  if (position.asset_type_code === 'crypto') {
    return 0;
  }
  return Number(position.metadata?.income_in_base ?? 0) + Number(position.metadata?.realized_result_in_base ?? 0);
}

// Collection items are acquired, invested in and sold rather than opened and topped up.
const COLLECTIBLE_EVENT_LABELS: Partial<Record<PortfolioEvent['event_type'], string>> = {
  open: 'Приобретение', top_up: 'Вложение', partial_close: 'Частичная продажа', close: 'Продажа',
};

function getEventLabel(item: PortfolioEvent, assetTypeCode?: string): string {
  const collectible = assetTypeCode === 'collectible' ? COLLECTIBLE_EVENT_LABELS[item.event_type] : undefined;
  if (collectible) return collectible;
  switch (item.event_type) {
    case 'transfer_in': return 'Перевод на позицию';
    case 'transfer_out': return 'Перевод с позиции';
    case 'swap_in': return 'Обмен: получено';
    case 'swap_out': return 'Обмен: отдано';
    case 'top_up': return 'Пополнение';
    case 'partial_close': return 'Частичное закрытие';
    case 'fee': return 'Комиссия';
    case 'open': return 'Открытие позиции';
    case 'close': return 'Закрытие позиции';
    case 'income': {
      const kind = item.metadata?.income_kind;
      return kind === 'dividend' ? 'Дивиденды' : kind === 'interest' ? 'Проценты' : 'Доход';
    }
    case 'adjustment': return item.metadata?.action === 'cancel_income' ? 'Отмена дохода' : 'Корректировка';
    default: return 'Операция';
  }
}


// A lending account may hold several collateral assets against one debt.
function lendingGroupKey(position: CryptoProtocolPosition): string {
  const key = position.position_type === 'lending' && position.metadata?.lending_account_key;
  return key ? `${position.investment_account_id}:${position.network_code}:${String(key)}` : `position:${position.id}`;
}

// EVAA pool identity is independent of the collateral symbol (TON can belong to either pool).
function protocolDisplayName(position: CryptoProtocolPosition): string {
  const master = position.metadata?.lending_master_contract;
  if (master === '0:bcad466a47fa565750729565253cd073ca24d856804499090c2100d95c809f9e') return 'EVAA Master';
  if (master === '0:489595f65115a45c24a0dd0176309654fb00b95e40682f0c3e85d5a4d86dfb25') return 'EVAA LP';
  return position.protocol_name;
}

export default function Portfolio({ user, refreshToken }: { user: UserContext; refreshToken: number }) {
  const [correctionsOpen, setCorrectionsOpen] = useState(false);
  const [accounts, setAccounts] = useState<AccountWithBalances[]>([]);
  const [cashAccounts, setCashAccounts] = useState<BankAccount[]>([]);
  const [currencies, setCurrencies] = useState<Currency[]>([]);
  const [positions, setPositions] = useState<PortfolioPosition[]>([]);
  const [cryptoAssets, setCryptoAssets] = useState<CryptoAsset[]>([]);
  const [summaryItems, setSummaryItems] = useState<PortfolioSummaryItem[]>([]);
  const [activeAssetTypeCode, setActiveAssetTypeCode] = useState<string>('all');
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [addSheetOpen, setAddSheetOpen] = useState(false);
  const [addSheetTypeCode, setAddSheetTypeCode] = useState<string | null>(null);
  const [addCryptoMode, setAddCryptoMode] = useState<'pick' | 'asset' | 'defi'>('pick');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [submittingCloseId, setSubmittingCloseId] = useState<number | null>(null);
  const [submittingIncomeId, setSubmittingIncomeId] = useState<number | null>(null);
  const [submittingTopUpId, setSubmittingTopUpId] = useState<number | null>(null);
  const [submittingPartialCloseId, setSubmittingPartialCloseId] = useState<number | null>(null);
  const [submittingFeeId, setSubmittingFeeId] = useState<number | null>(null);
  const [deletingPositionId, setDeletingPositionId] = useState<number | null>(null);
  const [cancellingIncomeEventId, setCancellingIncomeEventId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [closeError, setCloseError] = useState<string | null>(null);
  const [incomeError, setIncomeError] = useState<string | null>(null);
  const [topUpError, setTopUpError] = useState<string | null>(null);
  const [partialCloseError, setPartialCloseError] = useState<string | null>(null);
  const [feeError, setFeeError] = useState<string | null>(null);
  const [rateChangeError, setRateChangeError] = useState<string | null>(null);
  const [submittingRateChangeId, setSubmittingRateChangeId] = useState<number | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [cancelIncomeError, setCancelIncomeError] = useState<string | null>(null);
  const [selectedPositionId, setSelectedPositionId] = useState<number | null>(null);
  const [cryptoAssetSheet, setCryptoAssetSheet] = useState<
    { investmentAccountId: number; cryptoAssetId: number } | null
  >(null);
  const [cryptoSwapSheetPosition, setCryptoSwapSheetPosition] = useState<PortfolioPosition | null>(null);
  const [cryptoWithdrawSheetPosition, setCryptoWithdrawSheetPosition] = useState<PortfolioPosition | null>(null);
  const [cryptoTransferSheetPosition, setCryptoTransferSheetPosition] = useState<PortfolioPosition | null>(null);
  const [cryptoIncomeSheetPosition, setCryptoIncomeSheetPosition] = useState<PortfolioPosition | null>(null);
  const [partialCloseProtocolId, setPartialCloseProtocolId] = useState<number | null>(null);
  const [lpSheet, setLpSheet] = useState<{ kind: 'add' | 'partial' | 'close' | 'claim' | 'snapshot' | 'reward'; positionId: number } | null>(null);
  const [lendingSheet, setLendingSheet] = useState<{ kind: 'top_up' | 'take_debt' | 'repay_debt' | 'adjust' | 'partial' | 'close' | 'interest' | 'liquidate' | 'yield' | 'group'; positionId: number } | null>(null);
  const [feeRefund, setFeeRefund] = useState<{eventId: number; positionId: number; symbol: string} | null>(null);
  const [eventsByPosition, setEventsByPosition] = useState<Record<number, PortfolioEvent[]>>({});
  const [eventsLoadingId, setEventsLoadingId] = useState<number | null>(null);
  const [eventsError, setEventsError] = useState<string | null>(null);
  const [closeDrafts, setCloseDrafts] = useState<Record<number, CloseDraft>>({});
  const [incomeDrafts, setIncomeDrafts] = useState<Record<number, IncomeDraft>>({});
  const [topUpDrafts, setTopUpDrafts] = useState<Record<number, TopUpDraft>>({});
  const [partialCloseDrafts, setPartialCloseDrafts] = useState<Record<number, PartialCloseDraft>>({});
  const [feeDrafts, setFeeDrafts] = useState<Record<number, FeeDraft>>({});
  const [rateChangeDrafts, setRateChangeDrafts] = useState<Record<number, RateChangeDraft>>({});
  const [assetSwipeStartX, setAssetSwipeStartX] = useState<number | null>(null);
  const [accountSwipeStartX, setAccountSwipeStartX] = useState<number | null>(null);
  const [showHiddenWallets, setShowHiddenWallets] = useState<Set<number>>(new Set());
  const [showClosedProtocolAccounts, setShowClosedProtocolAccounts] = useState<Set<number>>(new Set());
  const [walletVisibilityError, setWalletVisibilityError] = useState<string | null>(null);
  const [showClosedPositions, setShowClosedPositions] = useState(false);
  const [moexPrices, setMoexPrices] = useState<Map<string, MoexPrice>>(new Map());
  const [tinkoffLivePrices, setTinkoffLivePrices] = useState<Map<number, TinkoffLivePrice>>(new Map());
  const [cryptoLivePrices, setCryptoLivePrices] = useState<Map<number, CryptoLivePrice>>(new Map());
  const [tinkoffConnections, setTinkoffConnections] = useState<ExternalConnection[]>([]);
  const [syncDialogConnection, setSyncDialogConnection] = useState<ExternalConnection | null>(null);
  const [showAccountsModal, setShowAccountsModal] = useState(false);
  const [heroTypeSheetCode, setHeroTypeSheetCode] = useState<string | null>(null);
  const [valueMode, setValueMode] = useState<'now' | 'potential'>('now');
  const [showIncomePopup, setShowIncomePopup] = useState(false);
  const [portfolioView, setPortfolioView] = useState<'positions' | 'ops' | 'analytics'>('positions');
  const [activeAccountTabKey, setActiveAccountTabKey] = useState('all');
  const [analyticsData, setAnalyticsData] = useState<PortfolioAnalyticsData | null>(null);
  const [cryptoProtocolPositions, setCryptoProtocolPositions] = useState<CryptoProtocolPosition[]>([]);
  const [fundingSymbols, setFundingSymbols] = useState<Map<string, string>>(new Map());
  const [cryptoAssetsByAccount, setCryptoAssetsByAccount] = useState<Map<number, CryptoAccountAssetSummary[]>>(new Map());
  const [stakingCreateAccountId, setStakingCreateAccountId] = useState<number | null>(null);
  const [stakingCreateDraft, setStakingCreateDraft] = useState<StakingCreateDraft>(createInitialStakingCreateDraft());
  const [stakingCreateFeeDraft, setStakingCreateFeeDraft] = useState<DefiFeeDraft>(EMPTY_FEE_DRAFT);
  const [stakingCreateError, setStakingCreateError] = useState<string | null>(null);
  const [submittingStakingCreateAccountId, setSubmittingStakingCreateAccountId] = useState<number | null>(null);
  const [selectedProtocolPositionId, setSelectedProtocolPositionId] = useState<number | null>(null);
  const [stakingUpdateDrafts, setStakingUpdateDrafts] = useState<Record<number, StakingUpdateDraft>>({});
  const [stakingCloseDrafts, setStakingCloseDrafts] = useState<Record<number, StakingCloseDraft>>({});
  const [stakingUpdateError, setStakingUpdateError] = useState<string | null>(null);
  const [stakingCloseError, setStakingCloseError] = useState<string | null>(null);
  const [submittingStakingUpdateId, setSubmittingStakingUpdateId] = useState<number | null>(null);
  const [submittingStakingCloseId, setSubmittingStakingCloseId] = useState<number | null>(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [analyticsPeriodType, setAnalyticsPeriodType] = useState<'month' | 'quarter' | 'year'>('year');
  const [analyticsPeriodOffset, setAnalyticsPeriodOffset] = useState(0);

  // New investment account form
  const [showNewAccountModal, setShowNewAccountModal] = useState(false);
  const collectionActionRequest = useCryptoRequestKey('collectible-action');
  const collectibleDateRequest = useCryptoRequestKey('collectible-date');
  const [collectibleEditingId, setCollectibleEditingId] = useState<number | null>(null);
  const [collectibleOpeningPack, setCollectibleOpeningPack] = useState(false);
  const [collectibleDateSaving, setCollectibleDateSaving] = useState(false);
  const [collectibleDateError, setCollectibleDateError] = useState<string | null>(null);
  const [collectionSoldQuantity, setCollectionSoldQuantity] = useState('');
  const collectibleSaleRequest = useCryptoRequestKey('collectible-sell');
  const [newAccountStep, setNewAccountStep] = useState<'pick' | 'form'>('pick');
  const [newAccountName, setNewAccountName] = useState('');
  const [newAccountOwnerType, setNewAccountOwnerType] = useState<'user' | 'family'>('user');
  const [newAccountAssetType, setNewAccountAssetType] = useState<NonNullable<BankAccount['investment_asset_type']>>('security');
  const [newAccountProvider, setNewAccountProvider] = useState('');
  const [creatingAccount, setCreatingAccount] = useState(false);
  const [createAccountError, setCreateAccountError] = useState<string | null>(null);

  const loadPortfolio = async () => {
    setRefreshing(true);
    setError(null);

    try {
      const [investmentAccounts, loadedCashAccounts, loadedPositions, loadedCurrencies, loadedSummary, loadedConnections, loadedCryptoAssets] = await Promise.all([
        fetchBankAccounts('investment', true),
        fetchBankAccounts('cash'),
        fetchPortfolioPositions(),
        fetchCurrencies(),
        fetchPortfolioSummary(),
        getTinkoffConnections().catch(() => [] as ExternalConnection[]),
        fetchCryptoAssets().catch(() => [] as CryptoAsset[]),
      ]);
      const visibleAccounts = investmentAccounts.filter((account) => !account.is_archived);
      const archivedAccountIds = new Set(investmentAccounts.filter((account) => account.is_archived).map((account) => account.id));
      const snapshots = await Promise.all(
        visibleAccounts.map(async (account) => ({
          account,
          balances: await fetchBankAccountSnapshot(account.id),
        })),
      );

      setAccounts(snapshots);
      setCashAccounts(loadedCashAccounts);
      setPositions(loadedPositions.filter((position) => !archivedAccountIds.has(position.investment_account_id ?? -1)));
      setCurrencies(loadedCurrencies);
      setSummaryItems(loadedSummary);
      setTinkoffConnections(loadedConnections);
      setCryptoAssets(loadedCryptoAssets);
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    void loadPortfolio();
  }, [user.user_id, refreshToken]);

  useEffect(() => {
    const cryptoAccountIds = accounts
      .filter(({ account }) => account.investment_asset_type === 'crypto')
      .map(({ account }) => account.id);
    if (cryptoAccountIds.length === 0) {
      setCryptoProtocolPositions([]);
      setFundingSymbols(new Map());
      setCryptoAssetsByAccount(new Map());
      return;
    }
    void fetchCryptoProtocolPositions()
      .then((items) => {
        // Archived loans can still finance assets held in an active wallet.
        setFundingSymbols(new Map(items.map((item) => [String(item.id),
          String(item.metadata.borrowed_asset_symbol ?? item.metadata.borrowed_asset ?? '?')])));
        setCryptoProtocolPositions(items.filter((item) => cryptoAccountIds.includes(item.investment_account_id)));
      })
      .catch(() => { setCryptoProtocolPositions([]); setFundingSymbols(new Map()); });

    let cancelled = false;
    void Promise.all(
      cryptoAccountIds.map((id) =>
        fetchCryptoAccountAssets(id)
          .then((assets) => [id, assets] as const)
          .catch(() => [id, [] as CryptoAccountAssetSummary[]] as const),
      ),
    ).then((entries) => {
      if (cancelled) return;
      setCryptoAssetsByAccount(new Map(entries));
    });
    return () => { cancelled = true; };
  }, [accounts]);

  // Fetch MOEX prices for open positions that have a ticker in metadata
  useEffect(() => {
    const sharesTickers: string[] = [];
    const bondsTickers: string[] = [];
    for (const pos of positions) {
      if (pos.status !== 'open') continue;
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
    ]).then(([sharesMap, bondsMap]) => {
      setMoexPrices(new Map([...sharesMap, ...bondsMap]));
    }).catch(() => {});
  }, [positions]);

  useEffect(() => {
    const cryptoAssetIds = Array.from(new Set(
      [
        ...positions
          .filter((position) => position.status === 'open' && position.asset_type_code === 'crypto')
          .map((position) => {
            const value = position.metadata?.crypto_asset_id;
            if (typeof value === 'number') return value;
            if (typeof value === 'string' && value.trim()) {
              const parsed = Number(value);
              return Number.isFinite(parsed) ? parsed : null;
            }
            return null;
          }),
        ...cryptoProtocolPositions
          .filter((position) => position.status === 'open')
          .map((position) => position.crypto_asset_id ?? null),
        // Coins held on collection accounts, like bank coins.
        ...accounts.flatMap(({ balances }) => balances
          .filter((balance) => balance.asset_type === 'crypto')
          .map((balance) => balance.crypto_asset_id ?? null)),
        ...cryptoProtocolPositions
          .filter((position) => position.status === 'open' && position.position_type === 'liquidity_pool')
          .map((position) => Number(position.metadata.token1_crypto_asset_id) || null),
        ...cryptoProtocolPositions
          .filter((position) => position.status === 'open' && position.position_type === 'lending')
          .map((position) => {
            const value = position.metadata?.borrowed_crypto_asset_id;
            return typeof value === 'number' ? value : null;
          }),
      ]
        .filter((value): value is number => value !== null),
    ));

    if (cryptoAssetIds.length === 0) {
      setCryptoLivePrices(new Map());
      return;
    }

    void fetchCryptoLivePrices(cryptoAssetIds, user.base_currency_code)
      .then((items) => {
        setCryptoLivePrices((prev) => {
          const next = new Map(prev);
          for (const item of items) {
            next.set(item.crypto_asset_id, item);
          }
          return next;
        });
      })
      .catch(() => {
        // Keep previously loaded prices; they are better than nothing.
      });
  }, [positions, cryptoProtocolPositions, accounts, user.base_currency_code]);

  const excludedAccountIds = useMemo(() => new Set(accounts
    .filter(({ account }) => account.include_in_statistics === false)
    .map(({ account }) => account.id)), [accounts]);

  const totalHistoricalInBase = useMemo(
    () => accounts.filter(({ account }) => account.include_in_statistics !== false).reduce(
      (sum, item) => sum + item.balances.reduce((accountSum, balance) => accountSum + balance.historical_cost_in_base, 0),
      0,
    ),
    [accounts],
  );

  const openPositions = useMemo(
    () => walletPositions(positions),
    [positions],
  );

  useEffect(() => {
    const connectedAccountIds = new Set(
      tinkoffConnections
        .map((connection) => connection.linked_account_id)
        .filter((value): value is number => typeof value === 'number'),
    );
    const hasConnectedAccounts = connectedAccountIds.size > 0;
    const hasConnectedOpenPositions = openPositions.some((position) => connectedAccountIds.has(position.investment_account_id));

    if (!hasConnectedAccounts) {
      setTinkoffLivePrices(new Map());
      return;
    }

    void (hasConnectedOpenPositions
      ? fetchTinkoffLivePrices().catch(() => [] as TinkoffLivePrice[])
      : Promise.resolve([] as TinkoffLivePrice[])
    ).then((prices) => {
      setTinkoffLivePrices(new Map(prices.map((item) => [item.position_id, item])));
    }).catch(() => {
      setTinkoffLivePrices(new Map());
    });
  }, [openPositions, tinkoffConnections]);

  const analyticsPeriodRange = useMemo(
    () => getAnalyticsPeriodRange(analyticsPeriodType, analyticsPeriodOffset),
    [analyticsPeriodType, analyticsPeriodOffset],
  );

  useEffect(() => {
    if (portfolioView !== 'analytics') return;
    setAnalyticsLoading(true);
    fetchPortfolioAnalytics(analyticsPeriodRange.dateFrom, analyticsPeriodRange.dateTo)
      .then(setAnalyticsData)
      .catch(() => setAnalyticsData(null))
      .finally(() => setAnalyticsLoading(false));
  }, [portfolioView, analyticsPeriodRange.dateFrom, analyticsPeriodRange.dateTo]);

  /** Period analytics limited to the open tab: a securities tab must not show deposit coupons. */
  const scopedAnalytics = useMemo<PortfolioAnalyticsData | null>(() => {
    if (!analyticsData || activeAssetTypeCode === 'all') return analyticsData;
    const inScope = (item: { asset_type_code: string }) => item.asset_type_code === activeAssetTypeCode;
    const income = analyticsData.monthly_income.filter(inScope);
    const trades = analyticsData.monthly_trades.filter(inScope);
    const adjustments = analyticsData.monthly_adjustments.filter(inScope);
    const total = (items: PortfolioAnalyticsMonthlyItem[]) => items.reduce((sum, item) => sum + item.total_amount, 0);
    const events = (items: PortfolioAnalyticsMonthlyItem[]) => items.reduce((sum, item) => sum + item.events_count, 0);
    const kinds = new Map<string, PortfolioAnalyticsMonthlyItem[]>();
    for (const item of income) {
      const kind = item.income_kind ?? 'other';
      kinds.set(kind, [...(kinds.get(kind) ?? []), item]);
    }
    const accountIds = new Set([...income, ...trades, ...adjustments].map((item) => item.investment_account_id));
    const byAccount = analyticsData.totals_by_account
      .filter((account) => accountIds.has(account.investment_account_id))
      .map((account) => {
        const own = (items: PortfolioAnalyticsMonthlyItem[]) => items.filter((item) => item.investment_account_id === account.investment_account_id);
        return {
          ...account,
          income_total: total(own(income)),
          trade_total: total(own(trades)),
          adjustment_total: total(own(adjustments)),
          income_count: events(own(income)),
          trade_count: events(own(trades)),
        };
      });
    return {
      ...analyticsData,
      monthly_income: income,
      monthly_trades: trades,
      monthly_adjustments: adjustments,
      totals_by_asset_type: analyticsData.totals_by_asset_type.filter(inScope),
      totals_by_income_kind: Array.from(kinds, ([income_kind, items]) => ({ income_kind, total_amount: total(items), events_count: events(items) })),
      totals_by_account: byAccount,
      income_feed: analyticsData.income_feed.filter(inScope),
    };
  }, [analyticsData, activeAssetTypeCode]);

  const analyticsMonthlyBars = useMemo(() => {
    if (!scopedAnalytics) return [];
    const monthMap = new Map<string, { income: number; trades: number; adjustments: number }>();
    for (const item of scopedAnalytics.monthly_income) {
      const existing = monthMap.get(item.period) ?? { income: 0, trades: 0, adjustments: 0 };
      existing.income += item.total_amount;
      monthMap.set(item.period, existing);
    }
    for (const item of scopedAnalytics.monthly_trades) {
      const existing = monthMap.get(item.period) ?? { income: 0, trades: 0, adjustments: 0 };
      existing.trades += item.total_amount;
      monthMap.set(item.period, existing);
    }
    for (const item of scopedAnalytics.monthly_adjustments) {
      const existing = monthMap.get(item.period) ?? { income: 0, trades: 0, adjustments: 0 };
      existing.adjustments += item.total_amount;
      monthMap.set(item.period, existing);
    }
    const entries = Array.from(monthMap.entries()).sort(([a], [b]) => a.localeCompare(b));
    const monthFormat: Intl.DateTimeFormatOptions['month'] = entries.length > 6 ? 'narrow' : 'short';
    return entries.map(([period, values]) => ({
      period,
      label: new Date(period).toLocaleDateString('ru-RU', { month: monthFormat }).replace('.', ''),
      income: values.income,
      trades: values.trades,
      total: values.income + values.trades + values.adjustments,
    }));
  }, [scopedAnalytics]);

  const analyticsAssetTypeDonut = useMemo(() => {
    if (!scopedAnalytics) return [];
    const totalIncome = scopedAnalytics.totals_by_asset_type.reduce(
      (sum, item) => sum + item.income_total + item.trade_total + item.adjustment_total, 0,
    );
    if (totalIncome <= 0) return [];
    return scopedAnalytics.totals_by_asset_type
      .map((item) => ({
        key: item.asset_type_code,
        label: assetTypeLabel(item.asset_type_code),
        amount: item.income_total + item.trade_total + item.adjustment_total,
        share: (item.income_total + item.trade_total + item.adjustment_total) / totalIncome,
      }))
      .filter((s) => s.amount !== 0)
      .sort((a, b) => b.amount - a.amount);
  }, [scopedAnalytics]);

  const analyticsIncomeKindDonut = useMemo(() => {
    if (!scopedAnalytics) return [];
    const total = scopedAnalytics.totals_by_income_kind.reduce((sum, item) => sum + item.total_amount, 0);
    if (total <= 0) return [];
    return scopedAnalytics.totals_by_income_kind
      .map((item) => ({
        key: item.income_kind,
        label: incomeKindLabel(item.income_kind),
        amount: item.total_amount,
        share: item.total_amount / total,
      }))
      .sort((a, b) => b.amount - a.amount);
  }, [scopedAnalytics]);

  const analyticsTotalIncome = useMemo(() => {
    if (!scopedAnalytics) return 0;
    return scopedAnalytics.totals_by_asset_type.reduce(
      (sum, item) => sum + item.income_total + item.adjustment_total, 0,
    );
  }, [scopedAnalytics]);

  const analyticsTotalTrades = useMemo(() => {
    if (!scopedAnalytics) return 0;
    return scopedAnalytics.totals_by_asset_type.reduce(
      (sum, item) => sum + item.trade_total, 0,
    );
  }, [scopedAnalytics]);

  const closedPositions = useMemo(
    () => positions.filter((position) => position.status === 'closed' && position.asset_type_code !== 'crypto'),
    [positions],
  );

  const getPositionMetadataNumber = (position: PortfolioPosition, key: string): number | null => {
    const value = position.metadata?.[key];
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === 'string' && value.trim() !== '') {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
  };

  const getPositionMetadataText = (position: PortfolioPosition, key: string): string | null => {
    const value = position.metadata?.[key];
    if (typeof value !== 'string') {
      return null;
    }
    const normalized = value.trim();
    return normalized !== '' ? normalized : null;
  };

  const getCryptoAssetId = (position: PortfolioPosition): number | null => (
    getPositionMetadataNumber(position, 'crypto_asset_id')
  );

  const getCryptoPositionGroupingKey = (position: PortfolioPosition): string => {
    const cryptoAssetId = getCryptoAssetId(position);
    const assetSymbol = getPositionMetadataText(position, 'asset_symbol') ?? position.title;
    const networkCode = getPositionMetadataText(position, 'network_code') ?? '';
    const assetKey = cryptoAssetId !== null
      ? `asset:${cryptoAssetId}`
      : `fallback:${assetSymbol.toLowerCase()}:${networkCode.toLowerCase()}`;
    return `${position.investment_account_id}:${assetKey}`;
  };

  const getCryptoLivePrice = (position: PortfolioPosition): CryptoLivePrice | null => {
    const cryptoAssetId = getCryptoAssetId(position);
    const quote = cryptoAssetId !== null ? cryptoLivePrices.get(cryptoAssetId) : null;
    return quote && !quote.is_stale && quote.vs_currency === user.base_currency_code
      && Number.isFinite(quote.price) && quote.price > 0 ? quote : null;
  };

  const getPositionEntryAmount = (position: PortfolioPosition): number => {
    if (position.asset_type_code === 'crypto') {
      return 0;
    }
    if (position.metadata?.moex_market === 'bonds') {
      return getPositionMetadataNumber(position, 'clean_amount_in_base') ?? position.amount_in_currency;
    }
    return position.amount_in_currency;
  };

  const getPositionInvestedPrincipal = (position: PortfolioPosition): number => {
    if (position.asset_type_code === 'crypto') {
      return 0;
    }
    if (position.metadata?.moex_market === 'bonds') {
      return (
        getPositionMetadataNumber(position, 'clean_amount_in_base')
        ?? getPositionEntryAmount(position)
        ?? getPositionMetadataNumber(position, 'amount_in_base')
        ?? position.amount_in_currency
      );
    }

    return (
      getPositionMetadataNumber(position, 'amount_in_base')
      ?? getPositionEntryAmount(position)
    );
  };

  const getResolvedPositionQuote = (position: PortfolioPosition) => {
    const tinkoffPrice = tinkoffLivePrices.get(position.id) ?? null;
    if (tinkoffPrice) {
      const isUnpricedTinkoffPosition = tinkoffPrice.source === 'tinkoff_unpriced';
      return {
        currentPrice: isUnpricedTinkoffPosition ? null : (tinkoffPrice.clean_price ?? tinkoffPrice.price),
        currentTotalValue: tinkoffPrice.current_value,
        performanceCurrentValue: isUnpricedTinkoffPosition
          ? null
          : (tinkoffPrice.clean_current_value ?? tinkoffPrice.current_value),
        isPreviousClose: false,
        source: 'tinkoff' as const,
      };
    }

    const ticker = typeof position.metadata?.ticker === 'string' ? position.metadata.ticker : null;
    const isBond = position.metadata?.moex_market === 'bonds';
    const moexPrice = ticker ? moexPrices.get(ticker) : null;
    const currentPrice = moexPrice?.last ?? moexPrice?.prevClose ?? null;
    const currentTotalValue = !isBond && currentPrice !== null && position.quantity
      ? currentPrice * position.quantity
      : null;

    return {
      currentPrice,
      currentTotalValue,
      performanceCurrentValue: currentTotalValue,
      isPreviousClose: moexPrice?.last === null && moexPrice?.prevClose !== null,
      source: currentPrice !== null ? 'moex' as const : null,
    };
  };

  const isUnpricedTinkoffPosition = (position: PortfolioPosition): boolean => (
    tinkoffLivePrices.get(position.id)?.source === 'tinkoff_unpriced'
  );

  const getPositionVisibleInvestedPrincipal = (position: PortfolioPosition): number => {
    if (position.asset_type_code === 'security' && isUnpricedTinkoffPosition(position)) {
      return 0;
    }
    return getPositionInvestedPrincipal(position);
  };

  const getPositionNkdValue = (position: PortfolioPosition): number => {
    const tinkoffPrice = tinkoffLivePrices.get(position.id);
    if (!tinkoffPrice || tinkoffPrice.clean_current_value === undefined || tinkoffPrice.clean_current_value === null) {
      return 0;
    }
    return tinkoffPrice.current_value - tinkoffPrice.clean_current_value;
  };

  const getResolvedPositionEstimatedValue = (position: PortfolioPosition) => (
    position.asset_type_code === 'collectible' ? 0 : position.asset_type_code === 'crypto'
      ? (walletMarketValue(Number(position.quantity ?? 0), getCryptoAssetId(position), cryptoLivePrices, user.base_currency_code) ?? 0)
      : (getResolvedPositionQuote(position).currentTotalValue ?? position.amount_in_currency)
  );

  const getResolvedPositionCurrentResult = (position: PortfolioPosition): number | null => {
    if (position.asset_type_code === 'crypto' || position.asset_type_code === 'collectible') {
      return null;
    }
    const quote = getResolvedPositionQuote(position);
    if (quote.performanceCurrentValue === null) {
      return null;
    }
    return quote.performanceCurrentValue - getPositionEntryAmount(position);
  };

  // Collection accounts also hold coins: at market when quoted, otherwise at cost.
  const coinValueByAccountId = useMemo(() => new Map(accounts.map(({ account, balances }) => [account.id, balances
    .filter((balance) => balance.asset_type === 'crypto')
    .reduce((sum, balance) => sum + (walletMarketValue(balance.amount, balance.crypto_asset_id ?? null, cryptoLivePrices, user.base_currency_code)
      ?? 0), 0)])), [accounts, cryptoLivePrices, user.base_currency_code]);
  const getAccountCashValue = (accountId: number): number => Number(summaryByAccountId[accountId]?.cash_balance_in_base ?? 0)
    + (coinValueByAccountId.get(accountId) ?? 0);

  const getPositionScopedValue = (position: PortfolioPosition): number => {
    let value = getResolvedPositionEstimatedValue(position);
    if (valueMode === 'potential' && position.asset_type_code === 'deposit') {
      value += typeof position.metadata?.accrued_interest === 'number' ? position.metadata.accrued_interest : 0;
    }
    return value;
  };

  const getPositionUnrealizedDelta = (position: PortfolioPosition): number => {
    if (position.asset_type_code === 'crypto' || position.asset_type_code === 'collectible') {
      return 0;
    }
    if (position.asset_type_code === 'security') {
      return getResolvedPositionCurrentResult(position) ?? 0;
    }
    return getPositionScopedValue(position) - getPositionInvestedPrincipal(position);
  };

  const getPositionDisplayResult = (position: PortfolioPosition): number => {
    const unrealizedDelta = getPositionUnrealizedDelta(position);
    if (position.asset_type_code === 'security') {
      return unrealizedDelta;
    }
    return getPositionRealizedResult(position) + unrealizedDelta;
  };

  const summaryByAccountId = useMemo(
    () => summaryItems.reduce<Record<number, PortfolioSummaryItem>>((acc, item) => {
      acc[item.investment_account_id] = item;
      return acc;
    }, {}),
    [summaryItems],
  );

  const totalInvestedPrincipalInBase = useMemo(
    () => openPositions.filter((p) => !excludedAccountIds.has(p.investment_account_id)).reduce((sum, position) => sum + getPositionInvestedPrincipal(position), 0),
    [openPositions, excludedAccountIds],
  );

  const totalRealizedIncomeInBase = useMemo(
    () => summaryItems.filter((item) => item.include_in_statistics !== false).reduce((sum, item) => sum + item.realized_income_in_base, 0),
    [summaryItems],
  );

  const totalInvestmentCashInBase = useMemo(
    () => summaryItems.filter((item) => item.include_in_statistics !== false)
      .reduce((sum, item) => sum + item.cash_balance_in_base + (coinValueByAccountId.get(item.investment_account_id) ?? 0), 0),
    [summaryItems, coinValueByAccountId],
  );

  const includedCryptoProtocols = cryptoProtocolPositions.filter((p) =>
    p.status === 'open' && !isEmptyProtocolPosition(p) && !excludedAccountIds.has(p.investment_account_id));
  const includedProtocolValues = includedCryptoProtocols.map((p) =>
    protocolMarketValue(p, cryptoLivePrices, user.base_currency_code));
  const knownProtocolValue = includedProtocolValues.reduce((sum, p) => sum + (p.value ?? 0), 0);
  const cryptoValuationIncomplete = includedProtocolValues.some((p) => p.value === null)
    || openPositions.some((p) => p.asset_type_code === 'crypto'
      && !excludedAccountIds.has(p.investment_account_id) && Number(p.quantity ?? 0) !== 0 && !getCryptoLivePrice(p));
  const hasIncludedCrypto = includedCryptoProtocols.length > 0 || openPositions.some((p) =>
    p.asset_type_code === 'crypto' && !excludedAccountIds.has(p.investment_account_id) && Number(p.quantity ?? 0) !== 0);

  const assetTabs = useMemo<PortfolioAssetTab[]>(() => {
    const accountTypeCodes = Array.from(new Set(accounts.map(({ account }) => getInvestmentAccountAssetType(account))));
    const knownCodes = DEFAULT_PORTFOLIO_ASSET_TYPE_CODES.filter((code) => accountTypeCodes.includes(code));
    const extraCodes = accountTypeCodes
      .filter((code) => !knownCodes.includes(code as (typeof DEFAULT_PORTFOLIO_ASSET_TYPE_CODES)[number]))
      .sort((left, right) => assetTypeLabel(left).localeCompare(assetTypeLabel(right), 'ru'));

    const typeTabs = [...knownCodes, ...extraCodes].map((code) => {
      const openTypePositions = openPositions.filter((position) => position.asset_type_code === code);
      const openCount = code === 'crypto'
        ? new Set(openTypePositions.map((position) => getCryptoPositionGroupingKey(position))).size
        : openTypePositions.length;
      const includedPositions = openTypePositions.filter((p) => !excludedAccountIds.has(p.investment_account_id));
      const currentOpenValueInBase = includedPositions.reduce(
        (sum, position) => sum + getPositionScopedValue(position),
        0,
      );
      const cashBalanceInBase = accounts
        .filter(({ account }) => getInvestmentAccountAssetType(account) === code && account.include_in_statistics !== false)
        .reduce((sum, { account }) => sum + (summaryByAccountId[account.id]?.cash_balance_in_base ?? 0) + (coinValueByAccountId.get(account.id) ?? 0), 0);

      return {
        code,
        label: assetTypeLabel(code),
        openCount,
        closedCount: closedPositions.filter((position) => position.asset_type_code === code).length,
        principalInBase: includedPositions
          .reduce((sum, position) => sum + getPositionInvestedPrincipal(position), 0),
        incomeInBase: includedPositions.reduce((sum, position) => sum + getPositionDisplayResult(position), 0),
        totalInBase: currentOpenValueInBase + cashBalanceInBase + (code === 'crypto' ? knownProtocolValue : 0),
        valuationIncomplete: code === 'crypto' && cryptoValuationIncomplete,
      };
    });
    const allTab: PortfolioAssetTab = {
      code: 'all',
      label: 'Все',
      openCount: openPositions.length,
      closedCount: closedPositions.length,
      principalInBase: typeTabs.reduce((s, t) => s + t.principalInBase, 0),
      incomeInBase: typeTabs.reduce((s, t) => s + t.incomeInBase, 0),
      totalInBase: typeTabs.reduce((s, t) => s + t.totalInBase, 0),
      valuationIncomplete: typeTabs.some((t) => t.valuationIncomplete),
    };
    return [allTab, ...typeTabs];
  }, [excludedAccountIds, accounts, closedPositions, openPositions, positions, summaryByAccountId, coinValueByAccountId, moexPrices, tinkoffLivePrices, cryptoLivePrices, user.base_currency_code, valueMode, knownProtocolValue, cryptoValuationIncomplete]);

  useEffect(() => {
    if (activeAssetTypeCode === 'all') return;
    if (!assetTabs.some((tab) => tab.code === activeAssetTypeCode)) {
      setActiveAssetTypeCode('all');
    }
  }, [activeAssetTypeCode, assetTabs]);

  const activeAssetTab = useMemo(
    () => assetTabs.find((tab) => tab.code === activeAssetTypeCode) ?? assetTabs[0] ?? null,
    [activeAssetTypeCode, assetTabs],
  );

  const filteredOpenPositions = useMemo(
    () => activeAssetTypeCode === 'all'
      ? openPositions
      : openPositions.filter((position) => position.asset_type_code === activeAssetTypeCode),
    [activeAssetTypeCode, openPositions],
  );

  const filteredClosedPositions = useMemo(
    () => activeAssetTypeCode === 'all'
      ? closedPositions
      : closedPositions.filter((position) => position.asset_type_code === activeAssetTypeCode),
    [activeAssetTypeCode, closedPositions],
  );

  const filteredAccounts = useMemo(
    () => activeAssetTypeCode === 'all'
      ? accounts
      : accounts.filter(
          ({ account }) => !account.investment_asset_type || account.investment_asset_type === activeAssetTypeCode,
        ),
    [accounts, activeAssetTypeCode],
  );

  // For each open position: priced assets at market value, unpriced non-crypto assets at entry amount.
  const { totalPositionsValue, totalPricedMarketValue, totalPricedEntry, totalUnrealizedPnl, hasPricedPositions } = useMemo(() => {
    let total = 0;
    let pricedMarket = 0;
    let pricedEntry = 0;
    let unrealized = 0;
    let count = 0;
    for (const pos of openPositions.filter((p) => !excludedAccountIds.has(p.investment_account_id))) {
      total += getResolvedPositionEstimatedValue(pos);
      const currentResult = getResolvedPositionCurrentResult(pos);
      if (currentResult !== null) {
        pricedMarket += getPositionEntryAmount(pos) + currentResult;
        pricedEntry += getPositionEntryAmount(pos);
        count++;
        unrealized += currentResult;
      }
    }
    return {
      totalPositionsValue: total,
      totalPricedMarketValue: pricedMarket,
      totalPricedEntry: pricedEntry,
      totalUnrealizedPnl: unrealized,
      hasPricedPositions: count > 0,
    };
  }, [excludedAccountIds, openPositions, moexPrices, tinkoffLivePrices, cryptoLivePrices, user.base_currency_code]);

  // Total = positions at market/cost + uninvested cash
  // Realized income is NOT added separately — it's already in cash or reinvested in positions
  const totalRealPortfolioValue = totalPositionsValue + totalInvestmentCashInBase + knownProtocolValue;

  const totalWithPotential = useMemo(
    () => openPositions.filter((p) => !excludedAccountIds.has(p.investment_account_id)).reduce((sum, pos) => {
      let val = getResolvedPositionEstimatedValue(pos);
      if (pos.asset_type_code === 'deposit') {
        const accrued = typeof pos.metadata?.accrued_interest === 'number' ? pos.metadata.accrued_interest : 0;
        val += accrued;
      }
      return sum + val;
    }, totalInvestmentCashInBase + knownProtocolValue),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [excludedAccountIds, openPositions, moexPrices, tinkoffLivePrices, totalInvestmentCashInBase, cryptoLivePrices, user.base_currency_code, knownProtocolValue],
  );

  const totalPortfolioDisplayResult = useMemo(
    () => openPositions.filter((p) => !excludedAccountIds.has(p.investment_account_id)).reduce((sum, position) => sum + getPositionDisplayResult(position), 0),
    [excludedAccountIds, moexPrices, openPositions, tinkoffLivePrices, valueMode],
  );

  const heroDisplayedPortfolioValue = valueMode === 'potential' ? totalWithPotential : totalRealPortfolioValue;
  const heroPnlValue = totalPortfolioDisplayResult;
  const heroPnlBase = totalInvestedPrincipalInBase;
  const heroPnlPercent = heroPnlBase > 0 ? (heroPnlValue / heroPnlBase) * 100 : 0;
  const shouldShowHeroPnl = heroPnlBase > 0 && !hasIncludedCrypto;

  const depositAccruedItems = useMemo(
    () => openPositions
      .filter((p) => p.asset_type_code === 'deposit' && !excludedAccountIds.has(p.investment_account_id))
      .map((p) => ({ title: p.title, accrued: typeof p.metadata?.accrued_interest === 'number' ? p.metadata.accrued_interest as number : 0, currency: p.currency_code }))
      .filter((p) => p.accrued > 0),
    [excludedAccountIds, openPositions],
  );

  const totalDepositAccrued = useMemo(
    () => depositAccruedItems.reduce((s, p) => s + p.accrued, 0),
    [depositAccruedItems],
  );

  const accountEstimatedValueById = useMemo(
    () => openPositions.reduce<Record<number, number>>((acc, position) => {
      acc[position.investment_account_id] = (acc[position.investment_account_id] ?? 0) + getResolvedPositionEstimatedValue(position);
      return acc;
    }, {}),
    [openPositions, moexPrices, tinkoffLivePrices, cryptoLivePrices, user.base_currency_code],
  );

  const accountOpenPrincipalById = useMemo(
    () => openPositions.reduce<Record<number, number>>((acc, position) => {
      acc[position.investment_account_id] = (acc[position.investment_account_id] ?? 0) + getPositionVisibleInvestedPrincipal(position);
      return acc;
    }, {}),
    [openPositions, tinkoffLivePrices],
  );

  const accountCurrentResultById = useMemo(
    () => openPositions.reduce<Record<number, number>>((acc, position) => {
      const currentResult = getResolvedPositionCurrentResult(position);
      if (currentResult !== null) {
        acc[position.investment_account_id] = (acc[position.investment_account_id] ?? 0) + currentResult;
      }
      return acc;
    }, {}),
    [openPositions, moexPrices, tinkoffLivePrices, cryptoLivePrices, user.base_currency_code],
  );

  const getConnectedSecurityMetrics = (accountId: number) => {
    const estimatedValue = accountEstimatedValueById[accountId] ?? 0;
    const investedPrincipal = accountOpenPrincipalById[accountId] ?? 0;
    return {
      estimatedValue,
      investedPrincipal,
      currentResult: accountCurrentResultById[accountId] ?? 0,
      cashValue: getAccountCashValue(accountId),
    };
  };

  const getAccountBalanceForCurrency = (bankAccountId: number, currencyCode: string): number => (
    accounts.find(({ account }) => account.id === bankAccountId)?.balances.find((balance) => currencyCode.startsWith('crypto:') ? balance.crypto_asset_id === Number(currencyCode.slice(7)) : balance.asset_type !== 'crypto' && balance.currency_code === currencyCode)?.amount ?? 0
  );

  const getDraftPositionFallback = (positionId: number): PortfolioPosition => (
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
    }
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

  const handleOpenPositionDetails = async (positionId: number) => {
    // For crypto positions, route to the new dedicated CryptoAssetSheet that
    // uses the aggregated entry-summary API instead of the generic one-position
    // event list. Other asset types keep the legacy PortfolioPositionDialog.
    const target = positions.find((p) => p.id === positionId);
    if (target && target.asset_type_code === 'crypto') {
      const cryptoAssetId = getCryptoAssetId(target);
      if (cryptoAssetId) {
        setCryptoAssetSheet({
          investmentAccountId: target.investment_account_id,
          cryptoAssetId,
        });
        return;
      }
    }

    setCollectionSoldQuantity('');
    setSelectedPositionId(positionId);
    if (!eventsByPosition[positionId]) {
      await loadEventsForPosition(positionId);
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
      if (draft.currencyCode.startsWith('crypto:')) {
        const sale = {
          crypto_asset_id: Number(draft.currencyCode.slice(7)),
          crypto_quantity: draft.amount.trim(),
          item_quantity: collectionSoldQuantity.trim() || undefined,
          closed_at: draft.closedAt || undefined,
          comment: draft.comment.trim() || undefined,
        };
        await sellCollectibleForCrypto(positionId, { ...sale, request_id: collectibleSaleRequest.requestId({ positionId, ...sale }) });
        collectibleSaleRequest.completed();
      } else await (async () => {
        const payload = {
        close_amount_in_currency: Number(draft.amount),
        close_currency_code: draft.currencyCode,
        close_amount_in_base: draft.currencyCode === user.base_currency_code || !draft.baseAmount.trim()
          ? undefined
          : Number(draft.baseAmount),
        closed_at: draft.closedAt || undefined,
        comment: draft.comment.trim() || undefined,
      };
        await closePortfolioPosition(positionId, { ...payload, request_id: collectionActionRequest.requestId({ action: 'closePortfolioPosition', positionId: positionId, ...payload }) });
        collectionActionRequest.completed();
      })();
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

  const clearPositionDrafts = (positionId: number) => {
    const omit = <T extends object>(rec: Record<number, T>) => {
      const next = { ...rec };
      delete next[positionId];
      return next;
    };
    setCloseDrafts(omit);
    setIncomeDrafts(omit);
    setTopUpDrafts(omit);
    setPartialCloseDrafts(omit);
    setFeeDrafts(omit);
    setRateChangeDrafts(omit);
  };

  const handleOpenCloseForm = (position: PortfolioPosition) => {
    clearPositionDrafts(position.id);
    setCloseError(null);
    setCloseDrafts((prev) => ({ ...prev, [position.id]: createInitialCloseDraft(position) }));
  };

  const handleOpenIncomeForm = (position: PortfolioPosition) => {
    clearPositionDrafts(position.id);
    setIncomeError(null);
    setIncomeDrafts((prev) => ({ ...prev, [position.id]: createInitialIncomeDraft(position) }));
  };

  const handleOpenTopUpForm = (position: PortfolioPosition) => {
    clearPositionDrafts(position.id);
    setTopUpError(null);
    setTopUpDrafts((prev) => ({ ...prev, [position.id]: createInitialTopUpDraft(position) }));
  };

  const handleOpenPartialCloseForm = (position: PortfolioPosition) => {
    clearPositionDrafts(position.id);
    setPartialCloseError(null);
    setPartialCloseDrafts((prev) => ({ ...prev, [position.id]: createInitialPartialCloseDraft(position) }));
  };

  const handleOpenFeeForm = (position: PortfolioPosition) => {
    clearPositionDrafts(position.id);
    setFeeError(null);
    setFeeDrafts((prev) => ({ ...prev, [position.id]: createInitialFeeDraft(position) }));
  };


  const getCryptoInvestmentAccountsForPosition = (position: PortfolioPosition): BankAccount[] => (
    accounts
      .map(({ account }) => account)
      .filter((account) => account.account_kind === 'investment'
        && account.investment_asset_type === 'crypto'
        && isSameAccountOwner(account, position))
  );

  const handleCloseDraftChange = (
    positionId: number,
    patch: Partial<CloseDraft>,
  ) => {
    setCloseDrafts((prev) => {
      const base = prev[positionId] ?? {
        amount: '',
        amountEdited: false,
        currencyCode: positions.find((position) => position.id === positionId)?.currency_code ?? user.base_currency_code,
        baseAmount: '',
        closedAt: todayIso(),
        comment: '',
      };
      const next: CloseDraft = { ...base, ...patch };

      // Manual edits to the amount pin the value; otherwise keep it in sync with the close date.
      if ('amount' in patch) {
        next.amountEdited = true;
      }
      if ('closedAt' in patch && !next.amountEdited) {
        const position = positions.find((item) => item.id === positionId);
        if (position) {
          const info = getDepositCloseInfo(position, next.closedAt);
          if (info.isDeposit) {
            next.amount = formatAmountInput(info.suggestedAmount);
          }
        }
      }

      return { ...prev, [positionId]: next };
    });
  };

  const handleIncomeDraftChange = (
    positionId: number,
    patch: Partial<IncomeDraft>,
  ) => {
    setIncomeDrafts((prev) => ({
      ...prev,
      [positionId]: {
        ...(prev[positionId] ?? createInitialIncomeDraft(getDraftPositionFallback(positionId))),
        ...patch,
      },
    }));
  };

  const handleTopUpDraftChange = (
    positionId: number,
    patch: Partial<TopUpDraft>,
  ) => {
    setTopUpDrafts((prev) => ({
      ...prev,
      [positionId]: {
        ...(prev[positionId] ?? createInitialTopUpDraft(getDraftPositionFallback(positionId))),
        ...patch,
      },
    }));
  };

  const handlePartialCloseDraftChange = (
    positionId: number,
    patch: Partial<PartialCloseDraft>,
  ) => {
    setPartialCloseDrafts((prev) => {
      const currentDraft = prev[positionId] ?? createInitialPartialCloseDraft(getDraftPositionFallback(positionId));
      const nextDraft: PartialCloseDraft = {
        ...currentDraft,
        ...patch,
      };

      if (patch.principalReduction !== undefined) {
        nextDraft.principalEditedManually = true;
      }

      if (patch.returnAmount !== undefined && !currentDraft.principalEditedManually && patch.principalReduction === undefined) {
        nextDraft.principalReduction = patch.returnAmount;
      }

      return {
        ...prev,
        [positionId]: nextDraft,
      };
    });
  };

  const handleFeeDraftChange = (
    positionId: number,
    patch: Partial<FeeDraft>,
  ) => {
    setFeeDrafts((prev) => ({
      ...prev,
      [positionId]: {
        ...(prev[positionId] ?? createInitialFeeDraft(getDraftPositionFallback(positionId))),
        ...patch,
      },
    }));
  };

  const handleRecordIncome = async (position: PortfolioPosition, event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const draft = incomeDrafts[position.id];
    const isCryptoPosition = position.asset_type_code === 'crypto';

    if (!draft || !draft.amount.trim() || (isCryptoPosition && !draft.quantity.trim()) || submittingIncomeId === position.id) {
      return;
    }

    setSubmittingIncomeId(position.id);
    setIncomeError(null);

    try {
      await recordPortfolioIncome(position.id, {
        amount: isCryptoPosition ? 0 : Number(draft.amount),
        currency_code: isCryptoPosition ? user.base_currency_code : draft.currencyCode,
        amount_in_base: isCryptoPosition || draft.currencyCode === user.base_currency_code || !draft.baseAmount.trim()
          ? undefined
          : Number(draft.baseAmount),
        quantity: isCryptoPosition ? Number(draft.quantity) : undefined,
        income_kind: draft.incomeKind,
        destination: isCryptoPosition ? 'position' : draft.destination,
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

  const handleTopUpPosition = async (position: PortfolioPosition, event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const draft = topUpDrafts[position.id];

    if (!draft || !draft.amount.trim() || submittingTopUpId === position.id) {
      return;
    }

    const availableAmount = getAccountBalanceForCurrency(position.investment_account_id, draft.currencyCode);

    if (Number(draft.amount) > availableAmount) {
      setTopUpError('Недостаточно денег на инвестиционном счете для пополнения позиции.');
      return;
    }

    setSubmittingTopUpId(position.id);
    setTopUpError(null);

    try {
      if (position.asset_type_code === 'collectible' && draft.currencyCode.startsWith('crypto:')) {
        const payload = { crypto_asset_id: Number(draft.currencyCode.slice(7)), crypto_quantity: draft.amount,
          resolve_purchase_price: draft.resolvePurchasePrice ?? false,
          allocation_position_ids: draft.allocationPositionIds?.length ? [position.id, ...draft.allocationPositionIds] : undefined,
          kind: 'topup' as const, operated_at: draft.toppedUpAt || undefined, comment: draft.comment.trim() || undefined };
        await chargeCollectibleCoin(position.id, { ...payload, request_id: collectionActionRequest.requestId({ positionId: position.id, ...payload }) });
        collectionActionRequest.completed();
      } else await (async () => {
        const payload = {
        amount_in_currency: Number(draft.amount),
        currency_code: draft.currencyCode,
        quantity: draft.quantity.trim() ? Number(draft.quantity) : undefined,
        resolve_purchase_price: draft.resolvePurchasePrice ?? false,
        topped_up_at: draft.toppedUpAt || undefined,
        comment: draft.comment.trim() || undefined,
      };
        await topUpPortfolioPosition(position.id, { ...payload, request_id: collectionActionRequest.requestId({ action: 'topUpPortfolioPosition', positionId: position.id, ...payload }) });
        collectionActionRequest.completed();
      })();
      setTopUpDrafts((prev) => {
        const nextDrafts = { ...prev };
        delete nextDrafts[position.id];
        return nextDrafts;
      });
      if (selectedPositionId === position.id) {
        await loadEventsForPosition(position.id);
      }
      await loadPortfolio();
    } catch (reason: unknown) {
      setTopUpError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSubmittingTopUpId(null);
    }
  };

  const handlePartialClosePosition = async (position: PortfolioPosition, event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const draft = partialCloseDrafts[position.id];

    if (!draft || !draft.returnAmount.trim() || !draft.principalReduction.trim() || submittingPartialCloseId === position.id) {
      return;
    }

    const principalReduction = Number(draft.principalReduction);
    const closedQuantity = draft.closedQuantity.trim() ? Number(draft.closedQuantity) : undefined;

    if (principalReduction >= position.amount_in_currency) {
      setPartialCloseError('Частичное закрытие должно оставлять положительный остаток. Для полного выхода используй закрытие позиции.');
      return;
    }

    if (position.quantity !== null && position.quantity !== undefined) {
      if (!draft.closedQuantity.trim()) {
        setPartialCloseError('Для позиции с количеством нужно указать, сколько единиц закрывается.');
        return;
      }

      if ((closedQuantity ?? 0) >= position.quantity) {
        setPartialCloseError('Частичное закрытие по количеству должно быть меньше текущего количества.');
        return;
      }
    }

    setSubmittingPartialCloseId(position.id);
    setPartialCloseError(null);

    try {
      await (async () => {
        const payload = {
        return_amount_in_currency: Number(draft.returnAmount),
        return_currency_code: draft.returnCurrencyCode,
        principal_reduction_in_currency: principalReduction,
        return_amount_in_base: draft.returnCurrencyCode === user.base_currency_code || !draft.returnBaseAmount.trim()
          ? undefined
          : Number(draft.returnBaseAmount),
        closed_quantity: closedQuantity,
        closed_at: draft.closedAt || undefined,
        comment: draft.comment.trim() || undefined,
      };
        await partialClosePortfolioPosition(position.id, { ...payload, request_id: collectionActionRequest.requestId({ action: 'partialClosePortfolioPosition', positionId: position.id, ...payload }) });
        collectionActionRequest.completed();
      })();
      setPartialCloseDrafts((prev) => {
        const nextDrafts = { ...prev };
        delete nextDrafts[position.id];
        return nextDrafts;
      });
      if (selectedPositionId === position.id) {
        await loadEventsForPosition(position.id);
      }
      await loadPortfolio();
    } catch (reason: unknown) {
      setPartialCloseError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSubmittingPartialCloseId(null);
    }
  };

  const handleRecordFee = async (position: PortfolioPosition, event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const draft = feeDrafts[position.id];

    if (!draft || !draft.amount.trim() || submittingFeeId === position.id) {
      return;
    }

    const availableAmount = getAccountBalanceForCurrency(position.investment_account_id, draft.currencyCode);
    if (Number(draft.amount) > availableAmount) {
      setFeeError('Недостаточно денег на инвестиционном счете для списания комиссии.');
      return;
    }

    setSubmittingFeeId(position.id);
    setFeeError(null);

    try {
      if (position.asset_type_code === 'collectible' && draft.currencyCode.startsWith('crypto:')) {
        const payload = { crypto_asset_id: Number(draft.currencyCode.slice(7)), crypto_quantity: draft.amount,
          kind: 'fee' as const, operated_at: draft.chargedAt || undefined, comment: draft.comment.trim() || undefined };
        await chargeCollectibleCoin(position.id, { ...payload, request_id: collectionActionRequest.requestId({ positionId: position.id, ...payload }) });
        collectionActionRequest.completed();
      } else await (async () => {
        const payload = {
        amount: Number(draft.amount),
        currency_code: draft.currencyCode,
        charged_at: draft.chargedAt || undefined,
        comment: draft.comment.trim() || undefined,
      };
        await recordPortfolioFee(position.id, { ...payload, request_id: collectionActionRequest.requestId({ action: 'recordPortfolioFee', positionId: position.id, ...payload }) });
        collectionActionRequest.completed();
      })();
      setFeeDrafts((prev) => {
        const nextDrafts = { ...prev };
        delete nextDrafts[position.id];
        return nextDrafts;
      });
      if (selectedPositionId === position.id) {
        await loadEventsForPosition(position.id);
      }
      await loadPortfolio();
    } catch (reason: unknown) {
      setFeeError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSubmittingFeeId(null);
    }
  };

  const handleOpenStakingCreate = (accountId: number) => {
    const defaultSource = positions.find(
      (position) => position.status === 'open'
        && position.asset_type_code === 'crypto'
        && position.investment_account_id === accountId
        && (position.quantity ?? 0) > 0,
    );
    setStakingCreateAccountId(accountId);
    setStakingCreateDraft(createInitialStakingCreateDraft(defaultSource?.id));
    setStakingCreateFeeDraft(EMPTY_FEE_DRAFT);
    setStakingCreateError(null);
  };

  const handleOpenStakingCreateSheet = (accountIds: number[]) => {
    const defaultAccountId = accountIds[0] ?? null;
    if (defaultAccountId) {
      handleOpenStakingCreate(defaultAccountId);
    } else {
      setStakingCreateAccountId(null);
      setStakingCreateDraft(createInitialStakingCreateDraft());
      setStakingCreateFeeDraft(EMPTY_FEE_DRAFT);
      setStakingCreateError('Сначала переведи крипту на crypto-счёт, чтобы открыть staking.');
    }
  };

  const createProtocolRequest = useCryptoRequestKey(`create-protocol:${stakingCreateAccountId}`);

  const handleSubmitStakingCreate = async (accountId: number, event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (submittingStakingCreateAccountId === accountId) {
      return;
    }

    const sourcePosition = positions.find((position) => position.id === Number(stakingCreateDraft.sourcePositionId));
    if (!sourcePosition || sourcePosition.investment_account_id !== accountId || sourcePosition.asset_type_code !== 'crypto') {
      setStakingCreateError('Выбери существующий crypto-актив этого счета.');
      return;
    }

    if (!stakingCreateDraft.protocolName.trim() || !stakingCreateDraft.quantity.trim()) {
      setStakingCreateError('Заполни протокол и количество.');
      return;
    }

    const quantity = Number(stakingCreateDraft.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      setStakingCreateError('Количество должно быть положительным.');
      return;
    }

    if ((sourcePosition.quantity ?? 0) < quantity) {
      setStakingCreateError('Нельзя отправить в staking больше, чем есть в активе.');
      return;
    }

    const positionType = stakingCreateDraft.positionType;
    const sourceAssetSymbol = getPositionMetadataText(sourcePosition, 'asset_symbol') ?? sourcePosition.title;

    let pairPosition: PortfolioPosition | undefined;
    let pairQty = 0;
    if (positionType === 'liquidity_pool') {
      pairPosition = positions.find((p) => p.id === Number(stakingCreateDraft.pairSourcePositionId));
      if (!pairPosition || pairPosition.investment_account_id !== accountId || pairPosition.asset_type_code !== 'crypto') {
        setStakingCreateError('Выбери token B из активов этого счёта.');
        return;
      }
      if (pairPosition.id === sourcePosition.id) {
        setStakingCreateError('Token A и Token B должны различаться.');
        return;
      }
      if (!stakingCreateDraft.pairQuantity.trim()) {
        setStakingCreateError('Укажи количество token B.');
        return;
      }
      pairQty = Number(stakingCreateDraft.pairQuantity);
      if (!Number.isFinite(pairQty) || pairQty <= 0) {
        setStakingCreateError('Количество token B должно быть положительным.');
        return;
      }
      if ((pairPosition.quantity ?? 0) < pairQty) {
        setStakingCreateError('Нельзя отправить в LP больше token B, чем есть в активе.');
        return;
      }
    }

    setSubmittingStakingCreateAccountId(accountId);
    setStakingCreateError(null);

    const metadata: Record<string, unknown> = {};
    let borrowedCryptoAssetId: number | undefined;
    let borrowedQuantity: number | undefined;
    let borrowedValueInBase: number | undefined;
    if (positionType === 'lending') {
      const aprNum = Number(stakingCreateDraft.apr);
      if (stakingCreateDraft.apr.trim() && Number.isFinite(aprNum)) metadata.apr = aprNum;
      const borrowAssetIdNum = Number(stakingCreateDraft.borrowedCryptoAssetId);
      const borrowQtyNum = Number(stakingCreateDraft.borrowedQuantity);
      if (
        stakingCreateDraft.borrowedCryptoAssetId
        && Number.isFinite(borrowAssetIdNum)
        && borrowAssetIdNum > 0
        && stakingCreateDraft.borrowedQuantity.trim()
        && Number.isFinite(borrowQtyNum)
        && borrowQtyNum > 0
      ) {
        borrowedCryptoAssetId = borrowAssetIdNum;
        borrowedQuantity = borrowQtyNum;
        const livePrice = cryptoLivePrices.get(borrowAssetIdNum)?.price;
        if (typeof livePrice === 'number' && livePrice > 0) {
          borrowedValueInBase = Math.round(livePrice * borrowQtyNum * 100) / 100;
        }
      }
    } else if (positionType === 'liquidity_pool') {
      if (stakingCreateDraft.poolName.trim()) metadata.pool_name = stakingCreateDraft.poolName.trim();
    }

    try {
      const payload = {
        investment_account_id: accountId,
        protocol_name: stakingCreateDraft.protocolName.trim(),
        position_type: positionType,
        asset_symbol: sourceAssetSymbol,
        quantity: stakingCreateDraft.quantity,
        current_quantity: stakingCreateDraft.quantity,
        crypto_asset_id: getPositionMetadataNumber(sourcePosition, 'crypto_asset_id') ?? undefined,
        network_code: getPositionMetadataText(sourcePosition, 'network_code') ?? undefined,
        deposited_at: stakingCreateDraft.depositedAt || undefined,
        comment: stakingCreateDraft.comment.trim() || undefined,
        metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
        source_position_id: sourcePosition.id,
        secondary_source_position_id: pairPosition?.id,
        secondary_quantity: pairPosition ? stakingCreateDraft.pairQuantity : undefined,
        borrowed_crypto_asset_id: borrowedCryptoAssetId,
        borrowed_quantity: borrowedQuantity ? stakingCreateDraft.borrowedQuantity : undefined,
        borrowed_value_in_base: borrowedValueInBase,
        fee: manualFee(stakingCreateFeeDraft, positions.filter((p) => p.investment_account_id === accountId)),
      };
      await createCryptoProtocolPosition({ ...payload, request_id: createProtocolRequest.requestId(payload) });
      createProtocolRequest.completed();
    } catch (reason: unknown) {
      setStakingCreateError(reason instanceof Error ? reason.message : String(reason));
      setSubmittingStakingCreateAccountId(null);
      return;
    }
    setStakingCreateAccountId(null);
    setStakingCreateDraft(createInitialStakingCreateDraft());
    setStakingCreateFeeDraft(EMPTY_FEE_DRAFT);
    if (addSheetOpen) {
      setAddSheetOpen(false);
      setAddSheetTypeCode(null);
      setAddCryptoMode('pick');
    }
    await loadPortfolio();
    setSubmittingStakingCreateAccountId(null);
  };

  const handleOpenProtocolDetails = (positionId: number) => {
    setSelectedProtocolPositionId(positionId);
    setStakingUpdateError(null);
    setStakingCloseError(null);
  };

  const handleOpenStakingCloseForm = (position: CryptoProtocolPosition) => {
    setStakingCloseDrafts((prev) => ({
      ...prev,
      [position.id]: createInitialStakingCloseDraft(position),
    }));
    setStakingUpdateDrafts((prev) => {
      const next = { ...prev };
      delete next[position.id];
      return next;
    });
    setStakingCloseError(null);
  };

  const handleStakingUpdateDraftChange = (positionId: number, patch: Partial<StakingUpdateDraft>) => {
    setStakingUpdateDrafts((prev) => ({
      ...prev,
      [positionId]: {
        ...(prev[positionId] ?? createInitialStakingUpdateDraft(
          cryptoProtocolPositions.find((item) => item.id === positionId)
          ?? {
            id: positionId,
            investment_account_id: 0,
            investment_account_name: '',
            owner_type: 'user',
            protocol_name: '',
            position_type: 'staking',
            status: 'open',
            asset_symbol: '',
            cost_basis_in_base: 0,
            current_value_in_base: 0,
            rewards_claimed_in_base: 0,
            rewards_unclaimed_in_base: 0,
            deposited_at: todayIso(),
            metadata: {},
            created_by_user_id: user.user_id,
            created_at: '',
            updated_at: '',
          },
        )),
        ...patch,
      },
    }));
  };

  const handleStakingCloseDraftChange = (positionId: number, patch: Partial<StakingCloseDraft>) => {
    setStakingCloseDrafts((prev) => ({
      ...prev,
      [positionId]: {
        ...(prev[positionId] ?? createInitialStakingCloseDraft(
          cryptoProtocolPositions.find((item) => item.id === positionId)
          ?? {
            id: positionId,
            investment_account_id: 0,
            investment_account_name: '',
            owner_type: 'user',
            protocol_name: '',
            position_type: 'staking',
            status: 'open',
            asset_symbol: '',
            cost_basis_in_base: 0,
            current_value_in_base: 0,
            rewards_claimed_in_base: 0,
            rewards_unclaimed_in_base: 0,
            deposited_at: todayIso(),
            metadata: {},
            created_by_user_id: user.user_id,
            created_at: '',
            updated_at: '',
          },
        )),
        ...patch,
      },
    }));
  };

  const handleSubmitStakingUpdate = async (position: CryptoProtocolPosition, event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const draft = stakingUpdateDrafts[position.id];
    if (!draft || submittingStakingUpdateId === position.id) {
      return;
    }

    if (!draft.currentQuantity.trim()) {
      setStakingUpdateError('Укажи текущее количество.');
      return;
    }

    setSubmittingStakingUpdateId(position.id);
    setStakingUpdateError(null);

    try {
      await updateCryptoProtocolPosition(position.id, {
        current_quantity: draft.currentQuantity.trim() ? Number(draft.currentQuantity) : undefined,
        rewards_claimed_in_base: draft.rewardsClaimedInBase.trim() ? Number(draft.rewardsClaimedInBase) : undefined,
        rewards_unclaimed_in_base: draft.rewardsUnclaimedInBase.trim() ? Number(draft.rewardsUnclaimedInBase) : undefined,
        comment: draft.comment.trim() || undefined,
      });
      setStakingUpdateDrafts((prev) => {
        const next = { ...prev };
        delete next[position.id];
        return next;
      });
      await loadPortfolio();
    } catch (reason: unknown) {
      setStakingUpdateError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSubmittingStakingUpdateId(null);
    }
  };

  const closeProtocolRequest = useCryptoRequestKey(`close-protocol:${selectedProtocolPositionId}`);

  const handleSubmitStakingClose = async (position: CryptoProtocolPosition, event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const draft = stakingCloseDrafts[position.id];
    if (!draft || submittingStakingCloseId === position.id) {
      return;
    }

    if (!draft.returnQuantity.trim()) {
      setStakingCloseError('Укажи итоговое количество.');
      return;
    }

    setSubmittingStakingCloseId(position.id);
    setStakingCloseError(null);

    try {
      const payload = {
        withdrawn_at: draft.withdrawnAt || undefined,
        return_quantity: draft.returnQuantity,
        comment: draft.comment.trim() || undefined,
      };
      await closeCryptoProtocolPosition(position.id, { ...payload, request_id: closeProtocolRequest.requestId(payload) });
      closeProtocolRequest.completed();
      setStakingCloseDrafts((prev) => {
        const next = { ...prev };
        delete next[position.id];
        return next;
      });
      setSelectedProtocolPositionId(null);
      await loadPortfolio();
    } catch (reason: unknown) {
      setStakingCloseError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSubmittingStakingCloseId(null);
    }
  };


  const handleChangeRate = async (position: PortfolioPosition, event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const draft = rateChangeDrafts[position.id];

    if (!draft || !draft.newRate.trim() || submittingRateChangeId === position.id) {
      return;
    }

    setSubmittingRateChangeId(position.id);
    setRateChangeError(null);

    try {
      await changeDepositRate(position.id, {
        new_rate: Number(draft.newRate),
        effective_date: draft.effectiveDate || undefined,
      });
      setRateChangeDrafts((prev) => {
        const nextDrafts = { ...prev };
        delete nextDrafts[position.id];
        return nextDrafts;
      });
      if (selectedPositionId === position.id) {
        await loadEventsForPosition(position.id);
      }
      await loadPortfolio();
    } catch (reason: unknown) {
      setRateChangeError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSubmittingRateChangeId(null);
    }
  };

  const handleDeletePosition = async (position: PortfolioPosition) => {
    const isConfirmed = window.confirm(
      'Удалить незакрытую позицию? Это возможно только если по ней еще нет доходов и других событий.',
    );

    if (!isConfirmed) {
      return;
    }

    setDeletingPositionId(position.id);
    setDeleteError(null);

    try {
      await deletePortfolioPosition(position.id);
      if (selectedPositionId === position.id) {
        setSelectedPositionId(null);
      }
      await loadPortfolio();
    } catch (reason: unknown) {
      setDeleteError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setDeletingPositionId(null);
    }
  };

  const handleCancelIncome = async (positionId: number, eventId: number) => {
    const isConfirmed = window.confirm(
      'Отменить этот доход? На инвестиционном счете будет создана отдельная корректировка.',
    );

    if (!isConfirmed) {
      return;
    }

    setCancellingIncomeEventId(eventId);
    setCancelIncomeError(null);

    try {
      await cancelPortfolioIncome(eventId);
      if (selectedPositionId === positionId) {
        await loadEventsForPosition(positionId);
      }
      await loadPortfolio();
    } catch (reason: unknown) {
      setCancelIncomeError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setCancellingIncomeEventId(null);
    }
  };

  const selectedPosition = useMemo(
    () => positions.find((position) => position.id === selectedPositionId) ?? null,
    [positions, selectedPositionId],
  );

  const selectedProtocolPosition = useMemo(
    () => cryptoProtocolPositions.find((position) => position.id === selectedProtocolPositionId) ?? null,
    [cryptoProtocolPositions, selectedProtocolPositionId],
  );

  const selectedLendingGroup = useMemo(() => selectedProtocolPosition
    ? cryptoProtocolPositions.filter((position) => position.status === 'open'
      && lendingGroupKey(position) === lendingGroupKey(selectedProtocolPosition))
    : [], [cryptoProtocolPositions, selectedProtocolPosition]);

  const selectedPositionEvents = selectedPosition ? (eventsByPosition[selectedPosition.id] ?? []) : [];

  const selectedPositionCancelledIncomeIds = useMemo(
    () => new Set(
      selectedPositionEvents
        .filter((item) => item.event_type === 'adjustment' && item.metadata?.action === 'cancel_income')
        .map((item) => Number(item.metadata?.cancelled_event_id))
        .filter((value) => Number.isFinite(value)),
    ),
    [selectedPositionEvents],
  );

  const coinBalancesByAccountId = useMemo(() => new Map(accounts.map(({ account, balances }) => [
    account.id, balances.filter((balance) => balance.asset_type === 'crypto' && balance.amount > 0),
  ])), [accounts]);

  const filteredOpenPositionGroups = useMemo(() => {
    const grouped = new Map<string, PositionAccountGroup>();

    filteredOpenPositions
      .slice()
      .sort((left, right) => {
        if (left.investment_account_owner_type !== right.investment_account_owner_type) {
          return left.investment_account_owner_type === 'user' ? -1 : 1;
        }

        if (left.investment_account_name !== right.investment_account_name) {
          return left.investment_account_name.localeCompare(right.investment_account_name, 'ru');
        }

        return left.title.localeCompare(right.title, 'ru');
      })
      .forEach((position) => {
        const key = `${position.investment_account_owner_type}:${position.investment_account_id}`;
        const group = grouped.get(key);

        if (group) {
          group.positions.push(position);
          return;
        }

        grouped.set(key, {
          accountId: position.investment_account_id,
          accountName: position.investment_account_name,
          ownerType: position.investment_account_owner_type,
          positions: [position],
        });
      });

    // A collection account holding only coins is still listed with them.
    if (activeAssetTypeCode === 'collectible' || activeAssetTypeCode === 'all') {
      for (const { account, balances } of accounts) {
        const key = `${account.owner_type}:${account.id}`;
        if (account.investment_asset_type === 'collectible' && !grouped.has(key) && balances.some((balance) => balance.amount > 0)) {
          grouped.set(key, { accountId: account.id, accountName: account.name, ownerType: account.owner_type, positions: [] });
        }
      }
    }

    return Array.from(grouped.values());
  }, [filteredOpenPositions, activeAssetTypeCode, accounts, coinBalancesByAccountId]);

  const getProtocolValuation = useCallback((position: CryptoProtocolPosition) =>
    protocolMarketValue(position, cryptoLivePrices, user.base_currency_code), [cryptoLivePrices, user.base_currency_code]);
  const getLendingNetValue = useCallback((position: CryptoProtocolPosition): number | null =>
    getProtocolValuation(position).value, [getProtocolValuation]);
  const formatProtocolValue = (value: number | null) => value === null ? '—' : formatNumericAmount(value, 0);

  const accountTabs = useMemo<PositionAccountTab[]>(() => {
    const getGroupEstimatedValue = (group: PositionAccountGroup): number => {
      const positionsValue = activeAssetTypeCode === 'security'
        ? getConnectedSecurityMetrics(group.accountId).estimatedValue
        : group.positions.reduce((sum, position) => sum + getPositionScopedValue(position), 0);
      return positionsValue + getAccountCashValue(group.accountId);
    };

    const scopedTabs = filteredOpenPositionGroups.map((group) => ({
      key: `${group.ownerType}:${group.accountId}`,
      accountName: group.accountName,
      ownerLabel: group.ownerType === 'family' ? 'Семейный счет' : 'Личный счет',
      openCount: activeAssetTypeCode === 'crypto'
        ? new Set(group.positions.map((position) => getCryptoPositionGroupingKey(position))).size
        : group.positions.length,
      estimatedValue: getGroupEstimatedValue(group),
    }));

    if (activeAssetTypeCode === 'crypto') {
      const existingKeys = new Set(scopedTabs.map((tab) => tab.key));
      const defiOnlyByKey = new Map<string, CryptoProtocolPosition[]>();
      for (const protocol of cryptoProtocolPositions) {
        if (protocol.status !== 'open' || isEmptyProtocolPosition(protocol)) continue;
        const key = `${protocol.owner_type}:${protocol.investment_account_id}`;
        if (existingKeys.has(key)) continue;
        const list = defiOnlyByKey.get(key) ?? [];
        list.push(protocol);
        defiOnlyByKey.set(key, list);
      }
      for (const [key, protocols] of defiOnlyByKey) {
        const head = protocols[0];
        const account = accounts.find((item) => item.account.id === head.investment_account_id)?.account;
        const protocolsValue = protocols.reduce((sum, p) => {
          return sum + (getLendingNetValue(p) ?? 0);
        }, 0);
        scopedTabs.push({
          key,
          accountName: account?.name ?? head.investment_account_name,
          ownerLabel: head.owner_type === 'family' ? 'Семейный счет' : 'Личный счет',
          openCount: 0,
          estimatedValue: protocolsValue + getAccountCashValue(head.investment_account_id),
        });
      }
      scopedTabs.sort((a, b) => {
        const aOwner = a.key.split(':')[0];
        const bOwner = b.key.split(':')[0];
        if (aOwner !== bOwner) return aOwner === 'user' ? -1 : 1;
        return a.accountName.localeCompare(b.accountName, 'ru');
      });
    }

    if (scopedTabs.length <= 1) {
      return scopedTabs;
    }

    return [{
      key: 'all',
      accountName: 'Все счета',
      ownerLabel: null,
      openCount: activeAssetTypeCode === 'crypto'
        ? new Set(filteredOpenPositions.map((position) => getCryptoPositionGroupingKey(position))).size
        : filteredOpenPositions.length,
      estimatedValue: filteredOpenPositionGroups.filter((g) => !excludedAccountIds.has(g.accountId)).reduce((sum, group) => sum + getGroupEstimatedValue(group), 0),
    }, ...scopedTabs];
  }, [
    getLendingNetValue,
    excludedAccountIds,
    accountEstimatedValueById,
    accountOpenPrincipalById,
    accounts,
    activeAssetTypeCode,
    cryptoLivePrices,
    cryptoProtocolPositions,
    filteredOpenPositionGroups,
    filteredOpenPositions,
    moexPrices,
    summaryByAccountId,
    tinkoffLivePrices,
  ]);

  useEffect(() => {
    if (activeAccountTabKey !== 'all' && !accountTabs.some((tab) => tab.key === activeAccountTabKey)) {
      setActiveAccountTabKey('all');
    }
  }, [activeAccountTabKey, accountTabs]);

  useEffect(() => {
    setActiveAccountTabKey('all');
  }, [activeAssetTypeCode]);


  const visibleOpenPositions = useMemo(
    () => (
      activeAccountTabKey === 'all'
        ? filteredOpenPositions
        : filteredOpenPositions.filter((position) => getPositionAccountKey(position) === activeAccountTabKey)
    ),
    [activeAccountTabKey, filteredOpenPositions],
  );

  const visibleClosedPositions = useMemo(
    () => (
      activeAccountTabKey === 'all'
        ? filteredClosedPositions
        : filteredClosedPositions.filter((position) => getPositionAccountKey(position) === activeAccountTabKey)
    ),
    [activeAccountTabKey, filteredClosedPositions],
  );

  const closedCryptoProtocols = cryptoProtocolPositions.filter((p) => p.status === 'closed'
    && activeAssetTypeCode === 'crypto'
    && accounts.some(({ account }) => account.id === p.investment_account_id)
    && (activeAccountTabKey === 'all' || `${p.owner_type}:${p.investment_account_id}` === activeAccountTabKey));

  const isHiddenWalletAsset = (p: PortfolioPosition) => p.asset_type_code === 'crypto'
    && Boolean(cryptoAssetsByAccount.get(p.investment_account_id)?.find((a) => a.crypto_asset_id === getCryptoAssetId(p))?.is_hidden);

  const changeWalletAssetVisibility = async (accountId: number, assetId: number, hidden: boolean) => {
    setWalletVisibilityError(null);
    try {
      await setCryptoAssetHidden(accountId, assetId, hidden);
      setCryptoAssetsByAccount((previous) => {
        const next = new Map(previous);
        next.set(accountId, (next.get(accountId) ?? []).map((a) => a.crypto_asset_id === assetId ? { ...a, is_hidden: hidden } : a));
        return next;
      });
      setCryptoAssetSheet(null);
    } catch (error) {
      setWalletVisibilityError(error instanceof Error ? error.message : String(error));
    }
  };

  const visibleAssetPositions = useMemo(() => {
    const typeFiltered = activeAssetTypeCode === 'all'
      ? positions
      : positions.filter((position) => position.asset_type_code === activeAssetTypeCode);
    return activeAccountTabKey === 'all'
      ? typeFiltered
      : typeFiltered.filter((position) => getPositionAccountKey(position) === activeAccountTabKey);
  }, [activeAccountTabKey, activeAssetTypeCode, positions]);

  const visibleCryptoProtocolPositions = useMemo(() => {
    if (activeAssetTypeCode !== 'crypto') return [];
    const openPositions = cryptoProtocolPositions.filter((position) => position.status === 'open' && !isEmptyProtocolPosition(position) && accounts.some(({ account }) => account.id === position.investment_account_id));
    return activeAccountTabKey === 'all'
      ? openPositions
      : openPositions.filter((position) => {
          const account = accounts.find(({ account }) => account.id === position.investment_account_id)?.account;
          return account ? `${account.owner_type}:${account.id}` === activeAccountTabKey : false;
        });
  }, [accounts, activeAccountTabKey, activeAssetTypeCode, cryptoProtocolPositions]);

  const scopedCryptoProtocols = cryptoProtocolPositions.filter((p) =>
    (activeAssetTypeCode === 'all' || activeAssetTypeCode === 'crypto') && p.status === 'open' && !isEmptyProtocolPosition(p)
    && accounts.some(({ account }) => account.id === p.investment_account_id)
    && (activeAccountTabKey === 'all' ? !excludedAccountIds.has(p.investment_account_id)
      : accounts.some(({ account }) => account.id === p.investment_account_id && `${account.owner_type}:${account.id}` === activeAccountTabKey)));

  const visibleCryptoProtocolPositionsByAccountId = useMemo(() => {
    const grouped = new Map<number, CryptoProtocolPosition[]>();
    for (const position of visibleCryptoProtocolPositions) {
      const items = grouped.get(position.investment_account_id) ?? [];
      const existing = items.findIndex((item) => lendingGroupKey(item) === lendingGroupKey(position));
      if (existing < 0) items.push(position);
      else if ((getLendingMetadata(position).borrowed_quantity ?? 0) > 0) items[existing] = position;
      grouped.set(position.investment_account_id, items);
    }
    return grouped;
  }, [visibleCryptoProtocolPositions]);

  const cryptoProtocolValueInBase = useMemo(
    () => visibleCryptoProtocolPositions
      .filter((position) => position.status === 'open' && (activeAccountTabKey !== 'all' || !excludedAccountIds.has(position.investment_account_id)))
      .reduce((sum, position) => sum + (getLendingNetValue(position) ?? 0), 0),
    [visibleCryptoProtocolPositions, getLendingNetValue, activeAccountTabKey, excludedAccountIds],
  );

  const visibleOpenPositionGroups = useMemo(
    () => (
      activeAccountTabKey === 'all'
        ? filteredOpenPositionGroups
        : filteredOpenPositionGroups.filter((group) => `${group.ownerType}:${group.accountId}` === activeAccountTabKey)
    ),
    [activeAccountTabKey, filteredOpenPositionGroups],
  );

  const aggregateCryptoPositionsByAsset = (positionsForGroup: PortfolioPosition[]): PortfolioPosition[] => {
    const grouped = new Map<string, PortfolioPosition[]>();
    const passthrough: PortfolioPosition[] = [];

    for (const position of positionsForGroup) {
      if (position.asset_type_code !== 'crypto') {
        passthrough.push(position);
        continue;
      }

      const key = getCryptoPositionGroupingKey(position);
      const bucket = grouped.get(key) ?? [];
      bucket.push(position);
      grouped.set(key, bucket);
    }

    const aggregated = Array.from(grouped.values()).map((bucket) => {
      const sortedBucket = bucket.slice().sort((left, right) => {
        const openedDiff = new Date(left.opened_at).getTime() - new Date(right.opened_at).getTime();
        return openedDiff !== 0 ? openedDiff : left.id - right.id;
      });
      const representative = sortedBucket[0];
      const quantity = sortedBucket.reduce((sum, position) => sum + Number(position.quantity ?? 0), 0);

      return {
        ...representative,
        quantity,
        amount_in_currency: 0,
        metadata: {
          ...representative.metadata,
          grouped_position_ids: sortedBucket.map((position) => position.id),
        },
      };
    });

    return [...passthrough, ...aggregated].sort((left, right) => left.title.localeCompare(right.title, 'ru'));
  };

  const renderPositionGroups = useMemo(() => {
    if (activeAssetTypeCode !== 'crypto' && activeAssetTypeCode !== 'all') {
      return visibleOpenPositionGroups;
    }

    const grouped = new Map<string, PositionAccountGroup>();
    for (const group of visibleOpenPositionGroups) {
      grouped.set(`${group.ownerType}:${group.accountId}`, {
        ...group,
        positions: aggregateCryptoPositionsByAsset(group.positions),
      });
    }

    for (const protocol of visibleCryptoProtocolPositions) {
      const key = `${protocol.owner_type}:${protocol.investment_account_id}`;
      if (grouped.has(key)) continue;
      const account = accounts.find((item) => item.account.id === protocol.investment_account_id)?.account;
      grouped.set(key, {
        accountId: protocol.investment_account_id,
        accountName: account?.name ?? protocol.investment_account_name,
        ownerType: protocol.owner_type,
        positions: [],
      });
    }

    return Array.from(grouped.values());
  }, [accounts, activeAssetTypeCode, visibleCryptoProtocolPositions, visibleOpenPositionGroups]);

  const activeScopeDisplayMetrics = useMemo(() => {
    const scopedOpenPositions = (activeAssetTypeCode === 'all' ? openPositions : visibleOpenPositions)
      .filter((p) => activeAssetTypeCode === 'collectible' || activeAccountTabKey !== 'all' || !excludedAccountIds.has(p.investment_account_id));
    const scopedGroups = (activeAssetTypeCode === 'all' ? filteredOpenPositionGroups : visibleOpenPositionGroups)
      .filter((g) => activeAssetTypeCode === 'collectible' || activeAccountTabKey !== 'all' || !excludedAccountIds.has(g.accountId));
    const nkdValue = scopedOpenPositions.reduce((sum, position) => sum + getPositionNkdValue(position), 0);
    const valuedAssets = new Set<string>();
    let cryptoBasis = 0;
    let basisMissing = false;
    let basisEstimated = false;
    const fundingUnits = new Map<string, number>();
    const addFunding = (units: unknown) => {
      if (!units || typeof units !== 'object') return;
      for (const [loan, amount] of Object.entries(units)) {
        const quantity = Number(amount);
        if (Number.isFinite(quantity) && quantity > 0) fundingUnits.set(loan, (fundingUnits.get(loan) ?? 0) + quantity);
      }
    };
    for (const position of scopedOpenPositions.filter((p) => p.asset_type_code === 'crypto')) {
      const assetId = getCryptoAssetId(position);
      const key = `${position.investment_account_id}:${assetId}`;
      if (valuedAssets.has(key)) continue;
      valuedAssets.add(key);
      const entry = cryptoAssetsByAccount.get(position.investment_account_id)?.find((a) => a.crypto_asset_id === assetId);
      addFunding(entry?.funding_units);
      if (!entry || entry.remaining_cost_basis === null || entry.basis_quality === 'unknown' || entry.basis_quality === 'invalid') {
        basisMissing = true;
      } else {
        cryptoBasis += Number(entry.remaining_cost_basis);
        basisEstimated ||= entry.basis_quality === 'estimated';
      }
    }
    for (const protocol of scopedCryptoProtocols) {
      addFunding(protocol.metadata.funding_units0);
      addFunding(protocol.metadata.funding_units1);
      if (protocol.cost_basis_in_base === null) basisMissing = true;
      else cryptoBasis += Number(protocol.cost_basis_in_base);
      basisEstimated ||= protocol.metadata.basis_quality === 'estimated';
    }
    const investedPrincipal = cryptoBasis + scopedOpenPositions.filter((p) => p.asset_type_code !== 'crypto').reduce((sum, position) => sum + (
      activeAssetTypeCode === 'security'
        ? getPositionVisibleInvestedPrincipal(position)
        : getPositionInvestedPrincipal(position)
    ), 0);
    return {
      estimatedValue: scopedOpenPositions.reduce((sum, position) => sum + getPositionScopedValue(position), 0)
        + scopedCryptoProtocols.reduce((sum, p) => sum + (getLendingNetValue(p) ?? 0), 0),
      investedPrincipal,
      basisMissing,
      basisEstimated,
      fundingParts: Array.from(fundingUnits, ([loan, quantity]) => {
        const symbol = fundingSymbols.get(loan) ?? '?';
        return { loan, quantity, symbol };
      }),
      cashValue: activeAssetTypeCode === 'all'
        ? totalInvestmentCashInBase
        : scopedGroups.reduce((sum, group) => sum + getConnectedSecurityMetrics(group.accountId).cashValue, 0),
      resultValue: scopedOpenPositions.reduce((sum, position) => sum + getPositionDisplayResult(position), 0),
      nkdValue,
      resultLabel: 'Доход',
    };
  }, [
    activeAssetTypeCode,
    activeAccountTabKey,
    excludedAccountIds,
    cryptoProtocolValueInBase,
    fundingSymbols,
    cryptoProtocolPositions,
    cryptoAssetsByAccount,
    cryptoLivePrices,
    visibleCryptoProtocolPositions,
    scopedCryptoProtocols,
    filteredOpenPositionGroups,
    moexPrices,
    tinkoffLivePrices,
    totalInvestmentCashInBase,
    visibleOpenPositionGroups,
    visibleOpenPositions,
    openPositions,
  ]);
  const activeScopeCurrentValue = activeScopeDisplayMetrics.estimatedValue + activeScopeDisplayMetrics.cashValue;
  const activeScopeBaseValue = activeScopeDisplayMetrics.investedPrincipal;
  const activeScopeResultValue = activeScopeDisplayMetrics.resultValue;
  const activeScopeResultPct = activeScopeBaseValue > 0 ? (activeScopeResultValue / activeScopeBaseValue) * 100 : 0;
  const activeScopeNkdValue = activeScopeDisplayMetrics.nkdValue;
  const activeScopeHasCrypto = (activeAssetTypeCode === 'all' ? openPositions : visibleOpenPositions)
    .filter((p) => activeAssetTypeCode === 'collectible' || activeAccountTabKey !== 'all' || !excludedAccountIds.has(p.investment_account_id))
    .some((position) => position.asset_type_code === 'crypto')
    || (activeAssetTypeCode === 'crypto' && visibleCryptoProtocolPositions.length > 0);
  const activeScopeMarketIncomplete = (activeAssetTypeCode === 'all' ? openPositions : visibleOpenPositions)
    .filter((p) => activeAssetTypeCode === 'collectible' || activeAccountTabKey !== 'all' || !excludedAccountIds.has(p.investment_account_id))
    .some((position) => position.asset_type_code === 'collectible' || (position.asset_type_code === 'crypto' && Number(position.quantity ?? 0) !== 0 && !(Number(getCryptoLivePrice(position)?.price) > 0)))
    || scopedCryptoProtocols.some((position) => getLendingNetValue(position) === null);
  const activeScopeBasisLabel = ['crypto', 'collectible'].includes(activeAssetTypeCode) || activeScopeHasCrypto ? 'Себестоимость' : 'Вложено';
  const ActiveAssetIcon = (PA_ASSET_TYPE_META[activeAssetTypeCode] ?? PA_ASSET_TYPE_META.security).Icon;

  const portfolioAnalyticsBuckets = useMemo<PortfolioAnalyticsBucket[]>(() => {
    if (activeAssetTypeCode !== 'security') {
      return [];
    }

    const totalEstimated = visibleOpenPositions.filter((p) => activeAccountTabKey !== 'all' || !excludedAccountIds.has(p.investment_account_id)).reduce((sum, position) => sum + getResolvedPositionEstimatedValue(position), 0);
    const buckets = SECURITY_KIND_OPTIONS.map((option) => {
      const sectionPositions = visibleOpenPositions.filter((p) => activeAccountTabKey !== 'all' || !excludedAccountIds.has(p.investment_account_id)).filter((position) => getSecurityKindCode(position) === option.value);
      const estimatedValue = sectionPositions.reduce((sum, position) => sum + getResolvedPositionEstimatedValue(position), 0);
      const investedPrincipal = sectionPositions.reduce((sum, position) => sum + getPositionVisibleInvestedPrincipal(position), 0);
      const nkdValue = sectionPositions.reduce((sum, position) => sum + getPositionNkdValue(position), 0);
      const currentResult = sectionPositions.reduce((sum, position) => sum + (getResolvedPositionCurrentResult(position) ?? 0), 0);
      return {
        key: option.value,
        label: option.label,
        estimatedValue,
        investedPrincipal,
        nkdValue,
        currentResult,
        positionsCount: sectionPositions.length,
        share: totalEstimated > 0 ? estimatedValue / totalEstimated : 0,
      };
    }).filter((bucket) => bucket.positionsCount > 0);

    return buckets.sort((left, right) => right.estimatedValue - left.estimatedValue);
  }, [activeAccountTabKey, excludedAccountIds, activeAssetTypeCode, moexPrices, tinkoffLivePrices, visibleOpenPositions]);

  const portfolioAnalyticsAccounts = useMemo<PortfolioAnalyticsAccountItem[]>(
    () => renderPositionGroups.filter((g) => activeAssetTypeCode === 'collectible' || activeAccountTabKey !== 'all' || !excludedAccountIds.has(g.accountId)).map((group) => {
      const isCrypto = accounts.some(({ account }) => account.id === group.accountId && account.investment_asset_type === 'crypto');
      const isCollection = accounts.some(({ account }) => account.id === group.accountId && account.investment_asset_type === 'collectible');
      const walletAssets = cryptoAssetsByAccount.get(group.accountId) ?? [];
      const protocols = scopedCryptoProtocols.filter((p) => p.investment_account_id === group.accountId);
      const protocolValues = knownProtocolValues(protocols.map(getProtocolValuation));
      const valuationIncomplete = isCrypto && (protocolValues.incomplete || walletAssets.some((a) => walletMarketValue(Number(a.quantity), a.crypto_asset_id, cryptoLivePrices, user.base_currency_code) === null));
      const basisIncomplete = isCrypto && (walletAssets.some((a) => a.remaining_cost_basis === null) || protocols.some((p) => p.cost_basis_in_base === null));
      const cryptoBasis = walletAssets.reduce((sum, a) => sum + Number(a.remaining_cost_basis ?? 0), 0)
        + protocols.reduce((sum, p) => sum + Number(p.cost_basis_in_base ?? 0), 0);
      const estimatedValue = group.positions.reduce((sum, position) => sum + getResolvedPositionEstimatedValue(position), 0);
      const investedPrincipal = group.positions.reduce((sum, position) => sum + (
        activeAssetTypeCode === 'security'
          ? getPositionVisibleInvestedPrincipal(position)
          : getPositionInvestedPrincipal(position)
      ), 0);
      const nkdValue = group.positions.reduce((sum, position) => sum + getPositionNkdValue(position), 0);
      const resultValue = activeAssetTypeCode === 'security'
        ? group.positions.reduce((sum, position) => sum + (getResolvedPositionCurrentResult(position) ?? 0), 0)
        : group.positions.reduce((sum, position) => sum + getPositionRealizedResult(position), 0);
      return {
        isCrypto, isCollection, valuationIncomplete, basisIncomplete,
        key: `${group.ownerType}:${group.accountId}`,
        accountName: group.accountName,
        ownerLabel: group.ownerType === 'family' ? 'Семейный счет' : 'Личный счет',
        estimatedValue: estimatedValue + protocolValues.value,
        investedPrincipal: isCrypto ? cryptoBasis : investedPrincipal,
        nkdValue,
        cashValue: (summaryByAccountId[group.accountId]?.cash_balance_in_base ?? 0) + (coinValueByAccountId.get(group.accountId) ?? 0),
        resultValue,
        positionsCount: group.positions.length + protocols.length,
      };
    }).sort((left, right) => right.estimatedValue - left.estimatedValue),
    [activeAccountTabKey, excludedAccountIds, activeAssetTypeCode, moexPrices, summaryByAccountId, coinValueByAccountId, tinkoffLivePrices, renderPositionGroups, accounts, cryptoAssetsByAccount, scopedCryptoProtocols, getProtocolValuation, cryptoLivePrices, user.base_currency_code],
  );

  const portfolioAnalyticsLeaders = useMemo<PortfolioAnalyticsLeader[]>(() => {
    const totalEstimated = visibleOpenPositions.filter((p) => activeAccountTabKey !== 'all' || !excludedAccountIds.has(p.investment_account_id)).reduce((sum, position) => sum + getResolvedPositionEstimatedValue(position), 0);
    return visibleOpenPositions.filter((p) => activeAccountTabKey !== 'all' || !excludedAccountIds.has(p.investment_account_id))
      .map((position) => {
        const logoName = getPositionMetadataText(position, 'logo_name');
        const isCrypto = position.asset_type_code === 'crypto';
        const cryptoSymbol = getPositionMetadataText(position, 'asset_symbol') ?? position.title;
        return {
          positionId: position.id,
          title: position.title,
          ticker: isCrypto ? null : getPositionMetadataText(position, 'ticker'),
          accountName: position.investment_account_name,
          quantityLabel: !position.quantity ? null : isCrypto
            ? `${formatNumericAmount(position.quantity, 8)} ${cryptoSymbol}`
            : `${formatNumericAmount(position.quantity, 4)} шт.`,
          estimatedValue: getResolvedPositionEstimatedValue(position),
          currentResult: isCrypto ? null : getResolvedPositionCurrentResult(position),
          logoUrl: isCrypto ? getCryptoIconUrl(cryptoSymbol, position.metadata) : logoName ? getTinkoffInstrumentLogoUrl(logoName) : null,
          share: totalEstimated > 0 ? getResolvedPositionEstimatedValue(position) / totalEstimated : 0,
        };
      })
      .sort((left, right) => right.estimatedValue - left.estimatedValue)
      .slice(0, 8);
  }, [activeAccountTabKey, excludedAccountIds, moexPrices, tinkoffLivePrices, cryptoLivePrices, user.base_currency_code, visibleOpenPositions]);

  const hasMultipleOpenPositionOwners = useMemo(
    () => new Set(visibleOpenPositionGroups.map((group) => group.ownerType)).size > 1,
    [visibleOpenPositionGroups],
  );

  const hasMultipleOpenPositionAccounts = visibleOpenPositionGroups.length > 1;

  const getOpenPositionSections = (positionsForGroup: PortfolioPosition[]): SecuritySection[] => {
    if (activeAssetTypeCode === 'deposit') {
      const termDeposits = positionsForGroup.filter((p) => p.metadata?.deposit_kind === 'term_deposit');
      const savingsAccounts = positionsForGroup.filter((p) => p.metadata?.deposit_kind === 'savings_account');
      const other = positionsForGroup.filter(
        (p) => p.metadata?.deposit_kind !== 'term_deposit' && p.metadata?.deposit_kind !== 'savings_account',
      );
      const sections: SecuritySection[] = [];
      if (termDeposits.length > 0) sections.push({ code: 'term_deposit', label: 'Вклады', positions: termDeposits });
      if (savingsAccounts.length > 0) sections.push({ code: 'savings_account', label: 'Накопительные счета', positions: savingsAccounts });
      if (other.length > 0) sections.push({ code: 'deposit', label: 'Депозиты', positions: other });
      return sections.length > 0 ? sections : [{ code: 'deposit', label: 'Депозиты', positions: positionsForGroup }];
    }

    if (activeAssetTypeCode !== 'security') {
      // For crypto, force "Активы" label so it pairs naturally with the "DeFi" subhead.
      const sectionLabel = activeAssetTypeCode === 'crypto'
        ? 'Активы'
        : activeAssetTab?.label ?? assetTypeLabel(activeAssetTypeCode);
      return [{
        code: activeAssetTypeCode,
        label: sectionLabel,
        positions: positionsForGroup,
      }];
    }

    const knownCodes = SECURITY_KIND_OPTIONS.map((option) => option.value);
    const presentCodes = Array.from(new Set(positionsForGroup.map((position) => getSecurityKindCode(position))));
    const extraCodes = presentCodes
      .filter((code) => !knownCodes.includes(code as (typeof SECURITY_KIND_OPTIONS)[number]['value']))
      .sort((left, right) => getSecurityKindLabel(left).localeCompare(getSecurityKindLabel(right), 'ru'));

    return [...knownCodes, ...extraCodes]
      .map((code) => ({
        code,
        label: getSecurityKindLabel(code),
        positions: positionsForGroup.filter((position) => getSecurityKindCode(position) === code),
      }))
      .filter((section) => section.positions.length > 0);
  };

  const switchAssetTab = (direction: 'prev' | 'next') => {
    if (assetTabs.length <= 1) {
      return;
    }

    const currentIndex = assetTabs.findIndex((tab) => tab.code === activeAssetTypeCode);
    const safeIndex = currentIndex >= 0 ? currentIndex : 0;
    const nextIndex = direction === 'next'
      ? (safeIndex + 1) % assetTabs.length
      : (safeIndex - 1 + assetTabs.length) % assetTabs.length;

    setActiveAssetTypeCode(assetTabs[nextIndex].code);
  };

  const handleAssetSwipeStart = (clientX: number) => {
    setAssetSwipeStartX(clientX);
  };

  const handleAssetSwipeEnd = (clientX: number) => {
    if (assetSwipeStartX === null) {
      return;
    }

    const deltaX = clientX - assetSwipeStartX;
    setAssetSwipeStartX(null);

    if (Math.abs(deltaX) < 36) {
      return;
    }

    if (deltaX < 0) {
      switchAssetTab('next');
      return;
    }

    switchAssetTab('prev');
  };

  const switchAccountTab = (direction: 'prev' | 'next') => {
    if (accountTabs.length <= 1) {
      return;
    }

    const currentIndex = accountTabs.findIndex((tab) => tab.key === activeAccountTabKey);
    const safeIndex = currentIndex >= 0 ? currentIndex : 0;
    const nextIndex = direction === 'next'
      ? (safeIndex + 1) % accountTabs.length
      : (safeIndex - 1 + accountTabs.length) % accountTabs.length;

    setActiveAccountTabKey(accountTabs[nextIndex].key);
  };

  const handleAccountSwipeStart = (clientX: number) => {
    setAccountSwipeStartX(clientX);
  };

  const handleAccountSwipeEnd = (clientX: number) => {
    if (accountSwipeStartX === null) {
      return;
    }

    const deltaX = clientX - accountSwipeStartX;
    setAccountSwipeStartX(null);

    if (Math.abs(deltaX) < 36) {
      return;
    }

    if (deltaX < 0) {
      switchAccountTab('next');
      return;
    }

    switchAccountTab('prev');
  };

  const handleCreateAccount = async () => {
    if (!newAccountName.trim() || creatingAccount) return;
    setCreatingAccount(true);
    setCreateAccountError(null);
    try {
      await createBankAccount({
        name: newAccountName.trim(),
        owner_type: newAccountOwnerType,
        account_kind: 'investment',
        investment_asset_type: newAccountAssetType,
        provider_name: newAccountProvider.trim() || undefined,
      });
      setShowNewAccountModal(false);
      setNewAccountStep('pick');
      setNewAccountName('');
      setNewAccountProvider('');
      setNewAccountAssetType('security');
      setNewAccountOwnerType('user');
      await loadPortfolio();
    } catch (err) {
      setCreateAccountError(err instanceof Error ? err.message : 'Ошибка создания счёта');
    } finally {
      setCreatingAccount(false);
    }
  };

  if (loading) {
    return <SplashScreen />;
  }

  // Дальше страница рендерится всегда: обновление данных показывается
  // полосой сверху, а не подменой всего экрана сплэшем.


  const closedProtocolsByAccount = new Map<number, CryptoProtocolPosition[]>();
  for (const protocol of closedCryptoProtocols) {
    closedProtocolsByAccount.set(protocol.investment_account_id, [...(closedProtocolsByAccount.get(protocol.investment_account_id) ?? []), protocol]);
  }
  const positionGroupsShown = accounts.length > 0
    && (visibleOpenPositions.length > 0 || (activeAssetTypeCode === 'crypto' && visibleCryptoProtocolPositions.length > 0));
  const shownGroupIds = new Set(positionGroupsShown ? renderPositionGroups.map((group) => group.accountId) : []);
  const orphanClosedProtocolAccounts = Array.from(closedProtocolsByAccount.keys()).filter((id) => !shownGroupIds.has(id));

  const shortDate = (iso: string) => new Date(iso).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' });
  const renderClosedProtocols = (accountId: number) => {
    const closed = closedProtocolsByAccount.get(accountId) ?? [];
    if (closed.length === 0) return null;
    const open = showClosedProtocolAccounts.has(accountId);
    return (
      <div>
        {open && closed.map((p) => {
          const lp = p.position_type === 'liquidity_pool' ? getLiquidityPoolMetadata(p) : null;
          return (
            <button type="button" className="pf-pos pf-pos--past" key={p.id} onClick={() => handleOpenProtocolDetails(p.id)}>
              <div className="pf-pos__identity">
                <CoinStack symbols={defiCoinSymbols([p])} />
                <div className="pf-pos__copy">
                  <div className="pf-pos__title">{protocolDisplayName(p)}</div>
                  <div className="pf-pos__sub">
                    {PROTOCOL_TYPE_LABELS[p.position_type] ?? p.position_type} · {p.asset_symbol}{lp?.token1_symbol ? `/${lp.token1_symbol}` : ''}
                    {` · ${shortDate(p.deposited_at)}`}{p.withdrawn_at ? `–${shortDate(p.withdrawn_at)}` : ''}
                  </div>
                </div>
              </div>
            </button>
          );
        })}
        <button type="button" className="pf-grp__more" aria-expanded={open} onClick={() => setShowClosedProtocolAccounts((previous) => {
          const next = new Set(previous);
          if (next.has(accountId)) next.delete(accountId); else next.add(accountId);
          return next;
        })}>{open ? 'Свернуть закрытые DeFi' : `Закрытые DeFi · ${closed.length}`}</button>
      </div>
    );
  };

  const scopeSummary = (
    <>
    {activeAssetTypeCode !== 'all' && filteredOpenPositionGroups.length > 0 && (
      <div className="pf-tsum">
        <div className="pf-tsum__head">
          <div className={`pf-tsum__icon pf-tsum__icon--${activeAssetTypeCode}`} aria-hidden="true">
            <ActiveAssetIcon size={22} strokeWidth={2.4} />
          </div>
          <div className="pf-tsum__titlebox">
            <div className="pf-tsum__title">{activeAssetTab?.label ?? assetTypeLabel(activeAssetTypeCode)}</div>
            <div className="pf-tsum__meta">
              {activeAssetTypeCode === 'crypto' ? (() => {
                const coins = filteredOpenPositions.filter((p) => !isHiddenWalletAsset(p)).length;
                return `${coins} ${pluralRu(coins, ['монета', 'монеты', 'монет'])}`;
              })() : `${filteredOpenPositions.length} ${pluralRu(filteredOpenPositions.length, ['позиция', 'позиции', 'позиций'])}`}
              <span>·</span>
              {visibleOpenPositionGroups.length} {pluralRu(visibleOpenPositionGroups.length, ['счёт', 'счёта', 'счетов'])}
            </div>
          </div>
        </div>
        <div className="pf-tsum__now">
            <div className="pf-tsum__now-label">{valueMode === 'now' ? 'Сейчас' : 'С доходом'}</div>
          <div className="pf-tsum__now-row">
            <div className="pf-tsum__now-value">
              {new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(activeScopeCurrentValue)}
              <span className="pf-sym">{currencySymbol(user.base_currency_code)}</span>
            </div>
            {!activeScopeHasCrypto && !activeScopeMarketIncomplete && activeScopeBaseValue > 0 && (() => {
              const rv = activeScopeResultValue;
              const pct = activeScopeResultPct;
              const isPos = rv >= 0;
              return (
                <span className={`pf-tsum__delta${isPos ? ' pf-tsum__delta--pos' : ' pf-tsum__delta--neg'}`}>
                  {isPos ? '+' : ''}{new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(rv)}{currencySymbol(user.base_currency_code)}
                  <span className="pf-tsum__delta-sep">·</span>
                  {isPos ? '+' : ''}{pct.toFixed(1)}%
                </span>
              );
            })()}
          </div>
          <div className="pf-tsum__now-period">{activeScopeMarketIncomplete ? 'Рыночная оценка неполная' : activeScopeDisplayMetrics.resultLabel}</div>
        </div>
        {/* Coins and collection items have no running result: their cells drop it. */}
        <div className={`pf-tsum__grid${activeScopeHasCrypto || activeAssetTypeCode === 'collectible' ? ' pf-tsum__grid--crypto' : ''}`}>
          <div className="pf-tsum__cell">
            <div className="pf-tsum__cell-label">{activeScopeDisplayMetrics.fundingParts.length ? 'Учтённые затраты' : activeScopeBasisLabel}</div>
            <div className="pf-tsum__cell-value">
              {activeScopeDisplayMetrics.basisMissing ? '—' : new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(activeScopeBaseValue)}
              <span className="pf-sym">{currencySymbol(user.base_currency_code)}</span>
            </div>
          </div>
          {activeScopeDisplayMetrics.fundingParts.length > 0 && (
            <div className="pf-tsum__cell">
              <div className="pf-tsum__cell-label">Незакрытое финансирование</div>
              {activeScopeDisplayMetrics.fundingParts.map((part) => (
                <div className="pf-tsum__funding" key={part.loan}>{formatNumericAmount(part.quantity, 8)} {part.symbol}</div>
              ))}
            </div>
          )}
          {!activeScopeHasCrypto && activeAssetTypeCode !== 'collectible' && <div className="pf-tsum__cell pf-tsum__cell--mid">
            <div className="pf-tsum__cell-label">{activeScopeDisplayMetrics.resultLabel}</div>
            <div className={`pf-tsum__cell-value${activeScopeResultValue >= 0 ? ' pf-tsum__cell-value--pos' : ' pf-tsum__cell-value--neg'}`}>
              {!activeScopeHasCrypto && (activeScopeResultValue >= 0 ? '+' : '')}
              {activeScopeHasCrypto ? '—' : new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(activeScopeResultValue)}
              <span className="pf-sym">{currencySymbol(user.base_currency_code)}</span>
            </div>
            {activeAssetTypeCode === 'security' && activeScopeNkdValue > 0 ? (
              <div className="pf-tsum__cell-note">
                НКД +{new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(activeScopeNkdValue)}
                <span className="pf-sym">{currencySymbol(user.base_currency_code)}</span>
              </div>
            ) : !activeScopeHasCrypto && activeScopeBaseValue > 0 && (
              <div className="pf-tsum__cell-note">
                {activeScopeResultValue >= 0 ? '+' : ''}
                {activeScopeResultPct.toFixed(1)}%
              </div>
            )}
          </div>}
          {(!activeScopeHasCrypto || activeScopeDisplayMetrics.cashValue !== 0) && <div className="pf-tsum__cell">
            <div className="pf-tsum__cell-label">Свободно</div>
            <div className="pf-tsum__cell-value">
              {new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(activeScopeDisplayMetrics.cashValue)}
              <span className="pf-sym">{currencySymbol(user.base_currency_code)}</span>
            </div>
          </div>}
        </div>
      </div>
    )}

    {activeAssetTypeCode === 'all' && openPositions.length > 0 && (() => {
      const typeTabs = assetTabs.filter((t) => t.code !== 'all' && t.totalInBase > 0);
      const total = typeTabs.reduce((s, t) => s + t.totalInBase, 0);
      const basisValue = activeScopeBaseValue;
      const income = activeScopeResultValue;
      const incomeIsPos = income >= 0;
      const incomePct = activeScopeResultPct;
      const fmt = (n: number) => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(n);
      const colorMap: Record<string, string> = {
        security: '#0A0B0D', deposit: '#137534', crypto: '#9B1C1C', other: '#4B2D8F', collectible: '#7A2E96',
      };
      return (
        <div
          className="pf-alloc"
        >
          <div className="pf-alloc__head">
            <span className="pf-alloc__tag">{cryptoValuationIncomplete ? 'Оценённые активы' : 'Распределение'}</span>
            <span className="pf-alloc__meta">{typeTabs.length} {typeTabs.length === 1 ? 'тип' : typeTabs.length < 5 ? 'типа' : 'типов'}</span>
          </div>
          <div className="pf-alloc__bar" role="img" aria-label="Распределение по типам активов">
            {typeTabs.map((t) => (
              <span
                key={t.code}
                className="pf-alloc__seg"
                style={{ flex: t.totalInBase, background: colorMap[t.code] ?? '#999' }}
              />
            ))}
          </div>
          <ul className="pf-alloc__legend">
            {typeTabs.map((t) => (
              <li key={t.code}>
                <span className="pf-alloc__dot" style={{ background: colorMap[t.code] ?? '#999' }} />
                {t.label}
                <em>{total > 0 ? ((t.totalInBase / total) * 100).toFixed(1) : '0'}%</em>
              </li>
            ))}
          </ul>
          <div className="pf-alloc__totals">
            <div className="pf-alloc__t-cell">
              <span>{activeScopeBasisLabel}</span>
              <strong>{activeScopeDisplayMetrics.basisMissing ? '—' : fmt(basisValue)}<span className="pf-sym">{currencySymbol(user.base_currency_code)}</span></strong>
              <em className="pf-alloc__t-placeholder" aria-hidden="true">&nbsp;</em>
            </div>
            <span className="pf-alloc__t-sep" />
            <div className="pf-alloc__t-cell">
              <span>Доход</span>
              {activeScopeHasCrypto ? (
                <>
                  <strong className="pf-alloc__t-none">—</strong>
                  <em className="pf-alloc__t-placeholder" aria-hidden="true">&nbsp;</em>
                </>
              ) : (
                <>
                  <strong className={incomeIsPos ? 'pf-alloc__t-pos' : 'pf-alloc__t-neg'}>
                    {`${incomeIsPos ? '+' : ''}${fmt(income)}`}<span className="pf-sym">{currencySymbol(user.base_currency_code)}</span>
                  </strong>
                  <em className={incomeIsPos ? 'pf-alloc__t-pos' : 'pf-alloc__t-neg'}>
                    {`${incomeIsPos ? '+' : ''}${incomePct.toFixed(1)}%`}
                  </em>
                </>
              )}
            </div>
          </div>
        </div>
      );
    })()}
    </>
  );

  return (
    <>
      <RefreshBar active={refreshing} />
      {error && (
        <p style={{ color: 'var(--neg, #f04)', fontSize: '0.85rem', marginBottom: 12 }}>
          {error}
        </p>
      )}

      {/* ── Hero ── */}
      <div className="pf-hero">
        <div className="pf-hero__toprow">
          <span className="pf-hero__eyebrow">
            {cryptoValuationIncomplete ? 'Известная часть оценки' : valueMode === 'potential' ? 'Потенциал с доходом' : 'Сейчас в портфеле'}
          </span>
          <button
            className={`pf-chiptog${valueMode === 'potential' ? ' pf-chiptog--on' : ''}`}
            type="button"
            onClick={() => { setValueMode((v) => v === 'now' ? 'potential' : 'now'); setShowIncomePopup(false); }}
          >
            <span className="pf-chiptog__glyph" aria-hidden="true">{valueMode === 'potential' ? '−' : '+'}</span>
            с доходом
          </button>
        </div>

        <div className="pf-hero__amount">
          <strong className="pf-hero__value">
            {new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(
              heroDisplayedPortfolioValue,
            )}
          </strong>
          <span className="pf-hero__sym">{currencySymbol(user.base_currency_code)}</span>
        </div>


        {shouldShowHeroPnl && (
          <div className={`pf-hero__pnl${heroPnlValue >= 0 ? ' pf-hero__pnl--pos' : ' pf-hero__pnl--neg'}`}>
            <span className="pf-hero__pnl-arrow" aria-hidden="true">
              {heroPnlValue >= 0 ? '↗' : '↘'}
            </span>
            <span>
              {heroPnlValue >= 0 ? '+' : '−'}
              {formatNumericAmount(Math.abs(heroPnlValue), 0)}
              <span className="pf-hero__pnl-sym">{currencySymbol(user.base_currency_code)}</span>
            </span>
            <span className="pf-hero__pnl-sep">·</span>
            <span>
              {heroPnlValue >= 0 ? '+' : '−'}
              {new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 }).format(Math.abs(heroPnlPercent))}%
            </span>
            <span className="pf-hero__pnl-period">к вложенному</span>
          </div>
        )}

        {assetTabs.filter((t) => t.code !== 'all').map((tab) => (
          <button
            key={tab.code}
            type="button"
            className="pf-hero__row"
            onClick={() => setHeroTypeSheetCode(tab.code)}
          >
            <span className={`pf-hero__row-dot pf-hero__row-dot--${tab.code}`} />
            <span className="pf-hero__row-label">{tab.label}</span>
            <span className="pf-hero__row-value">
              {new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(tab.totalInBase)}
              <span className="pf-hero__row-sym">{currencySymbol(user.base_currency_code)}</span>
            </span>
            <span className="pf-hero__row-chev">›</span>
          </button>
        ))}

        {valueMode === 'potential' && totalDepositAccrued > 0 && (
          <div className="pf-hero__income-row">
            <button
              type="button"
              className="pf-hero__income-trigger"
              onClick={() => setShowIncomePopup((v) => !v)}
            >
              <Info size={13} strokeWidth={2.2} className="pf-hero__income-ico" />
              <span className="pf-hero__income-label">
                +{formatAmount(totalDepositAccrued, user.base_currency_code)} начислено
              </span>
              <span className={`pf-hero__income-chev${showIncomePopup ? ' pf-hero__income-chev--open' : ''}`}>›</span>
            </button>
            {showIncomePopup && (
              <div className="pf-income-popup">
                <div className="pf-income-popup__title">Начисленный доход</div>
                <div className="pf-income-popup__rows">
                  {depositAccruedItems.map((item) => (
                    <div key={item.title} className="pf-income-popup__row">
                      <span className="pf-income-popup__row-name">{item.title}</span>
                      <span className="pf-income-popup__row-val">+{formatAmount(item.accrued, item.currency)}</span>
                    </div>
                  ))}
                </div>
                <div className="pf-income-popup__note">
                  Выплатится при закрытии вклада
                </div>
              </div>
            )}
          </div>
        )}

      </div>

      {/* ── Asset type tabs + add button ── */}
      <div className="tabs-row">
        <div
          className="tabs"
          role="tablist"
          onTouchStart={(e) => handleAssetSwipeStart(e.touches[0].clientX)}
          onTouchEnd={(e) => handleAssetSwipeEnd(e.changedTouches[0].clientX)}
        >
          {assetTabs.map((tab) => (
            <button
              key={tab.code}
              role="tab"
              type="button"
              className={`tabs__item${activeAssetTypeCode === tab.code ? ' tabs__item--on' : ''}`}
              aria-selected={activeAssetTypeCode === tab.code}
              onClick={() => setActiveAssetTypeCode(tab.code)}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <button
          className="tabs-add-btn tabs-add-btn--yellow"
          type="button"
          aria-label="Новый инвестиционный счёт"
          onClick={() => {
            setNewAccountAssetType('security');
            setNewAccountStep('pick');
            setShowNewAccountModal(true);
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <path d="M12 5v14M5 12h14" />
          </svg>
        </button>
      </div>

      {/* ── View switcher ── */}
      <div className="pf-viewtog" role="tablist">
        {(['positions', 'ops', 'analytics'] as const).map((view) => (
          <button
            key={view}
            role="tab"
            type="button"
            className={`pf-viewtog__opt${portfolioView === view ? ' pf-viewtog__opt--on' : ''}`}
            aria-selected={portfolioView === view}
            onClick={() => setPortfolioView(view)}
          >
            {view === 'positions' ? 'Позиции' : view === 'ops' ? 'Операции' : 'Аналитика'}
          </button>
        ))}
      </div>

      {['crypto','collectible'].includes(activeAssetTypeCode) && accounts.some(a => a.account.investment_asset_type === activeAssetTypeCode) && (
        <CryptoCorrectionSheet accounts={accounts.filter(a => a.account.investment_asset_type === activeAssetTypeCode).map(a => ({id:a.account.id,name:a.account.name}))} open={correctionsOpen} anchorAccountId={(accounts.find(a => a.account.investment_asset_type === activeAssetTypeCode && a.account.owner_type + ':' + a.account.id === activeAccountTabKey) ?? accounts.find(a => a.account.investment_asset_type === activeAssetTypeCode))!.account.id}
          assetType={activeAssetTypeCode === 'collectible' ? 'collectible' : 'crypto'}
          baseCurrencyCode={user.base_currency_code}
          onClose={() => setCorrectionsOpen(false)} onSuccess={() => void loadPortfolio()} />
      )}

      {/* ══ Positions pane ══ */}
      {portfolioView === 'positions' && (
        <div className="pf-view">
          {scopeSummary}

          <div className="pf-sec__head">
            <div>
              <h2 className="pf-sec__title">Позиции</h2>
              <span className="pf-sec__sub">
                {activeAssetTypeCode === 'all'
                  ? 'Сгруппированы по счёту и типу'
                  : `${activeAssetTab?.label ?? assetTypeLabel(activeAssetTypeCode)} — по счёту`}
              </span>
            </div>
            <button
              className="pf-add-pill"
              type="button"
              onClick={() => {
                setAddSheetTypeCode(activeAssetTypeCode === 'all' ? null : activeAssetTypeCode);
                setAddSheetOpen(true);
              }}
              disabled={accounts.length === 0}
            >
              + Новая
            </button>
          </div>

          {accounts.length === 0 ? (
            <p className="pf-empty">Создай инвестиционный счёт в Настройках, затем добавь позиции.</p>
          ) : renderPositionGroups.length === 0 ? (
            <p className="pf-empty">Открытых позиций нет.</p>
          ) : (
            renderPositionGroups.map((group) => {
              const hiddenAssets = group.positions.filter(isHiddenWalletAsset);
              const showHidden = showHiddenWallets.has(group.accountId);
              const sections = getOpenPositionSections(group.positions.filter((p) => !isHiddenWalletAsset(p)));
              const groupAccount = accounts.find(({ account }) => account.id === group.accountId);
              const isCollectionAccount = groupAccount?.account.investment_asset_type === 'collectible';
              const money = isCollectionAccount ? groupAccount.balances.filter((b) => b.amount !== 0) : [];
              const positionsValue = activeAssetTypeCode === 'security'
                ? getConnectedSecurityMetrics(group.accountId).estimatedValue
                : group.positions.reduce((s, p) => s + getPositionScopedValue(p), 0);
              const protocolsForAccount = cryptoProtocolPositions.filter((item) => item.status === 'open' && !isEmptyProtocolPosition(item) && item.investment_account_id === group.accountId);
              const protocolMarketValue = knownProtocolValues(protocolsForAccount.map(getProtocolValuation));
              const groupValue = positionsValue + getAccountCashValue(group.accountId) + protocolMarketValue.value;
              const groupProtocolPositions = activeAssetTypeCode === 'crypto'
                ? (visibleCryptoProtocolPositionsByAccountId.get(group.accountId) ?? [])
                : [];
              return (
                <div key={`${group.ownerType}-${group.accountId}`} className="pf-grp">
                  <div className="pf-grp__head">
                    <div>
                      <div className="pf-grp__title">{group.accountName}</div>
                      <div className="pf-grp__meta">
                        {group.ownerType === 'family' ? 'Семейный' : 'Личный'}
                        {activeAssetTypeCode === 'crypto' ? (() => {
                          const coins = group.positions.length - hiddenAssets.length;
                          return ` · ${coins} ${pluralRu(coins, ['монета', 'монеты', 'монет'])}`;
                        })() : activeAssetTypeCode === 'collectible'
                          ? ` · ${group.positions.length} ${pluralRu(group.positions.length, ['предмет', 'предмета', 'предметов'])}`
                          : ` · ${group.positions.length} акт.`}
                        {groupProtocolPositions.length > 0 ? ` · ${groupProtocolPositions.length} DeFi` : ''}
                        {excludedAccountIds.has(group.accountId) && <span className="pf-grp__flag">вне статистики</span>}
                      </div>
                    </div>
                    <div className="pf-grp__total">
                      {new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(groupValue)}
                      <span className="pf-sym">{currencySymbol(user.base_currency_code)}</span>
                    </div>
                  </div>
                  {isCollectionAccount && money.length > 0 && <div className="pf-grp__subhead">Деньги на счёте</div>}
                  {accounts.find(({ account }) => account.id === group.accountId && account.investment_asset_type === 'collectible')?.balances.filter((b) => b.asset_type !== 'crypto' && b.amount !== 0).map((balance) => (
                    <div className="pf-pos" key={`cash:${balance.currency_code}`}>
                      <div className="pf-pos__identity"><div className="pf-pos__copy">
                        <div className="pf-pos__title">{balance.currency_code}</div>
                        <div className="pf-pos__sub">Денежный остаток</div>
                      </div></div>
                      <div className="pf-pos__right"><div className="pf-pos__amount">{formatAmount(balance.amount, balance.currency_code)}</div></div>
                    </div>
                  ))}
                  {(coinBalancesByAccountId.get(group.accountId) ?? []).map((coin) => {
                    const symbol = coin.symbol ?? coin.currency_code;
                    const value = walletMarketValue(coin.amount, coin.crypto_asset_id ?? null, cryptoLivePrices, user.base_currency_code);
                    const logoUrl = getCryptoIconUrl(symbol, { network_code: coin.network_code, contract_address: coin.contract_address });
                    return (
                      <div key={coin.crypto_asset_id} className="pf-pos">
                        <div className="pf-pos__identity">
                          {logoUrl
                            ? <img className="pf-pos__logo" src={logoUrl} alt="" loading="lazy" />
                            : <div className="pf-pos__icon pf-pos__icon--crypto">{symbol.slice(0, 1).toUpperCase()}</div>}
                          <div className="pf-pos__copy">
                            <div className="pf-pos__title">{symbol}</div>
                            <div className="pf-pos__sub">
                              {formatNumericAmount(coin.amount, 8)} {symbol}{cryptoNetworkSuffix(coin.network_code, symbol)}
                            </div>
                          </div>
                        </div>
                        <div className="pf-pos__right">
                          {value === null ? (
                            <>
                              <div className="pf-pos__amount pf-pos__amount--none">—</div>
                              <div className="pf-pos__sub">нет курса</div>
                            </>
                          ) : (
                            <div className="pf-pos__amount">
                              {formatNumericAmount(value)}
                              <span className="pf-sym">{currencySymbol(user.base_currency_code)}</span>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                  {isCollectionAccount && group.positions.length > 0 ? (
                    <CollectionShelf positions={group.positions} onOpen={(id) => void handleOpenPositionDetails(id)} />
                  ) : sections.map((section) => (
                    <div key={section.code}>
                      {section.positions.length > 0 && (sections.length > 1
                        || (activeAssetTypeCode === 'crypto' && groupProtocolPositions.length > 0)
                      ) && (
                        <div className="pf-grp__subhead">{section.label}</div>
                      )}
                      {section.positions.map((position) => {
                        const isDeposit = position.asset_type_code === 'deposit' && !!position.metadata?.deposit_kind;
                        const isCrypto = position.asset_type_code === 'crypto';
                        const isBond = position.metadata?.moex_market === 'bonds';
                        const posTicker = typeof position.metadata?.ticker === 'string' ? position.metadata.ticker : null;
                        const moexPrice2 = posTicker ? moexPrices.get(posTicker) : null;
                        const quote = getResolvedPositionQuote(position);
                        const entryAmount = getPositionEntryAmount(position);
                        const unrealizedPnl = getResolvedPositionCurrentResult(position);
                        const pnlPercent = unrealizedPnl !== null && entryAmount > 0
                          ? (unrealizedPnl / entryAmount) * 100 : null;
                        const depositAccrued = isDeposit && typeof position.metadata?.accrued_interest === 'number'
                          ? position.metadata.accrued_interest as number : 0;
                        const cryptoSymbol = getPositionMetadataText(position, 'asset_symbol') ?? position.title;
                        const cryptoNetwork = getPositionMetadataText(position, 'network_code');
                        const logoName = getPositionMetadataText(position, 'logo_name');
                        const logoUrl = isCrypto
                          ? getCryptoIconUrl(cryptoSymbol, position.metadata)
                          : logoName ? getTinkoffInstrumentLogoUrl(logoName) : null;
                        const displayValue = isCrypto
                          ? getResolvedPositionEstimatedValue(position)
                          : isDeposit
                          ? (valueMode === 'potential' ? position.amount_in_currency + depositAccrued : position.amount_in_currency)
                          : (quote.currentTotalValue ?? position.amount_in_currency);
                        const displayCurrencyCode = isCrypto ? user.base_currency_code : position.currency_code;
                        return (
                          <button
                            key={position.id}
                            className="pf-pos"
                            type="button"
                            onClick={() => void handleOpenPositionDetails(position.id)}
                          >
                            <div className="pf-pos__identity">
                              {position.asset_type_code === 'collectible' ? <CollectibleImage metadata={position.metadata} className="pf-pos__logo" /> : logoUrl ? (
                                <img className="pf-pos__logo" src={logoUrl} alt="" loading="lazy" />
                              ) : (
                                <div className={`pf-pos__icon pf-pos__icon--${position.asset_type_code}`}>
                                  {position.title.slice(0, 1).toUpperCase()}
                                </div>
                              )}
                              <div className="pf-pos__copy">
                                <div className="pf-pos__title">{position.title}</div>
                                <div className="pf-pos__sub">
                                  {isCrypto ? (
                                    <>
                                      {formatNumericAmount(position.quantity ?? 0, 8)} {cryptoSymbol}
                                      {cryptoNetworkSuffix(cryptoNetwork, cryptoSymbol)}
                                    </>
                                  ) : isDeposit ? (
                                    <>
                                      {String(position.metadata.interest_rate)}%
                                      {position.metadata.deposit_kind === 'term_deposit' && position.metadata.end_date
                                        ? ` · до ${formatDateLabel(String(position.metadata.end_date))}`
                                        : ''}
                                    </>
                                  ) : position.asset_type_code === 'collectible' ? (
                                    <>
                                      {getCollectibleKind(position.metadata?.item_kind)?.label ?? 'Предмет'}
                                      {Number(position.quantity) > 1 ? ` · ${position.quantity} шт.` : ''}
                                    </>
                                  ) : quote.currentPrice !== null && position.quantity ? (
                                    <>
                                      {quote.source === 'tinkoff'
                                        ? formatAmount(quote.currentPrice, position.currency_code)
                                        : isBond
                                          ? `${quote.currentPrice.toFixed(2)}%`
                                          : formatAmount(quote.currentPrice, position.currency_code)}
                                      {` × ${position.quantity}`}
                                      {quote.source === 'moex' && moexPrice2?.last === null ? ' · посл.' : ''}
                                    </>
                                  ) : position.quantity ? (
                                    `${formatAmount(entryAmount / position.quantity, position.currency_code)} × ${position.quantity}`
                                  ) : (
                                    formatAmount(entryAmount, position.currency_code)
                                  )}
                                </div>
                              </div>
                            </div>
                            <div className="pf-pos__right">
                              {position.asset_type_code === 'collectible' || (isCrypto && Number(position.quantity ?? 0) !== 0 && !getCryptoLivePrice(position)) ? (
                                <>
                                  <div className="pf-pos__amount pf-pos__amount--none">—</div>
                                  <div className="pf-pos__sub">{position.asset_type_code === 'collectible' ? 'нет оценки' : 'нет курса'}</div>
                                </>
                              ) : (
                                <div className="pf-pos__amount">
                                  {formatNumericAmount(displayValue)}
                                  <span className="pf-sym">{currencySymbol(displayCurrencyCode)}</span>
                                </div>
                              )}
                              {isDeposit && depositAccrued > 0 ? (
                                <div className="pf-pos__pnl pf-pos__pnl--pos">
                                  +{formatAmount(depositAccrued, position.currency_code)}
                                </div>
                              ) : unrealizedPnl !== null && pnlPercent !== null ? (
                                <div className={`pf-pos__pnl${unrealizedPnl >= 0 ? ' pf-pos__pnl--pos' : ' pf-pos__pnl--neg'}`}>
                                  {unrealizedPnl >= 0 ? '+' : ''}{unrealizedPnl.toFixed(0)} {currencySymbol(user.base_currency_code)}
                                  {' '}({pnlPercent >= 0 ? '+' : ''}{pnlPercent.toFixed(1)}%)
                                </div>
                              ) : null}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  ))}
                  {hiddenAssets.length > 0 && (
                    <div>
                      {showHidden && hiddenAssets.map((p) => {
                        const symbol = getPositionMetadataText(p, 'asset_symbol') ?? p.title;
                        const iconUrl = getCryptoIconUrl(symbol, p.metadata);
                        return (
                          <div className="pf-pos pf-pos--hidden" key={p.id}>
                            <button type="button" className="pf-pos__identity" onClick={() => void handleOpenPositionDetails(p.id)}>
                              {iconUrl ? <img className="pf-pos__logo" src={iconUrl} alt="" loading="lazy" /> : <div className="pf-pos__icon pf-pos__icon--crypto">{p.title.slice(0, 1).toUpperCase()}</div>}
                              <div className="pf-pos__copy">
                                <div className="pf-pos__title">{p.title}</div>
                                <div className="pf-pos__sub">{formatNumericAmount(Number(p.quantity ?? 0), 8)} {symbol}{cryptoNetworkSuffix(getPositionMetadataText(p, 'network_code'), symbol)}</div>
                              </div>
                            </button>
                            <button type="button" className="pf-pos__show" onClick={() => { const assetId = getCryptoAssetId(p); if (assetId !== null) void changeWalletAssetVisibility(group.accountId, assetId, false); }}>
                              Показать
                            </button>
                          </div>
                        );
                      })}
                      <button type="button" className="pf-grp__more" aria-expanded={showHidden} onClick={() => setShowHiddenWallets((previous) => {
                        const next = new Set(previous);
                        if (next.has(group.accountId)) next.delete(group.accountId); else next.add(group.accountId);
                        return next;
                      })}>{showHidden ? 'Свернуть скрытые' : `Скрытые монеты · ${hiddenAssets.length}`}</button>
                    </div>
                  )}
                  {activeAssetTypeCode === 'crypto' && groupProtocolPositions.length > 0 && (
                    <div>
                      <div className="pf-grp__subhead">DeFi</div>
                      {groupProtocolPositions.length > 0 ? (
                        groupProtocolPositions.map((position) => {
                          const members = visibleCryptoProtocolPositions.filter((item) => lendingGroupKey(item) === lendingGroupKey(position));
                          const protocolValue = sumProtocolValues(members.map(getProtocolValuation));
                          const typeLabel = PROTOCOL_TYPE_LABELS[position.position_type] ?? position.position_type;
                          let extra = '';
                          if (position.position_type === 'liquidity_pool') {
                            const lp = getLiquidityPoolMetadata(position);
                            if (lp.token1_symbol) extra = ` · ${position.asset_symbol}/${lp.token1_symbol}`;
                            else if (position.current_quantity) extra = ` · ${formatNumericAmount(position.current_quantity, 8)} ${position.asset_symbol}`;
                          } else if (position.position_type === 'lending') {
                            const lend = getLendingMetadata(position);
                            const qtyPart = members.map((item) => ` · ${formatNumericAmount(item.current_quantity ?? item.quantity ?? 0, 8)} ${item.asset_symbol}`).join('');
                            const debtPart = (lend.borrowed_quantity ?? 0) > 0
                              ? ` · долг ${formatNumericAmount(lend.borrowed_quantity ?? 0, 8)} ${lend.borrowed_asset_symbol ?? lend.borrowed_asset ?? ''}`
                              : '';
                            const aprPart = lend.apr != null ? ` · ${lend.apr}% APR` : '';
                            extra = `${qtyPart}${debtPart}${aprPart}`;
                          } else if (position.current_quantity) {
                            extra = ` · ${formatNumericAmount(position.current_quantity, 8)} ${position.asset_symbol}`;
                          }
                          return (
                            <button
                              key={position.id}
                              className="pf-pos"
                              type="button"
                              onClick={() => handleOpenProtocolDetails(position.id)}
                            >
                              <div className="pf-pos__identity">
                                <CoinStack symbols={defiCoinSymbols(members)} />
                                <div className="pf-pos__copy">
                                  <div className="pf-pos__title">{protocolDisplayName(position)}</div>
                                  <div className="pf-pos__sub">
                                    {typeLabel}{extra || ` · ${position.asset_symbol}`}
                                  </div>
                                </div>
                              </div>
                              <div className="pf-pos__right">
                                {protocolValue === null ? (
                                  <>
                                    <div className="pf-pos__amount pf-pos__amount--none">—</div>
                                    <div className="pf-pos__sub">нет оценки</div>
                                  </>
                                ) : (
                                  <div className="pf-pos__amount">
                                    {formatProtocolValue(protocolValue)}
                                    <span className="pf-sym">{currencySymbol(user.base_currency_code)}</span>
                                  </div>
                                )}
                              </div>
                            </button>
                          );
                        })
                      ) : null}
                    </div>
                  )}
                  {activeAssetTypeCode === 'crypto' && renderClosedProtocols(group.accountId)}
                </div>
              );
            })
          )}

          {activeAssetTypeCode === 'crypto' && orphanClosedProtocolAccounts.map((accountId) => {
            const account = accounts.find((item) => item.account.id === accountId)?.account;
            const sample = closedProtocolsByAccount.get(accountId)?.[0];
            return (
              <div key={`closed-${accountId}`} className="pf-grp">
                <div className="pf-grp__head">
                  <div>
                    <div className="pf-grp__title">{account?.name ?? sample?.investment_account_name}</div>
                    <div className="pf-grp__meta">{(account?.owner_type ?? sample?.owner_type) === 'family' ? 'Семейный' : 'Личный'} · нет открытых позиций</div>
                  </div>
                </div>
                {renderClosedProtocols(accountId)}
              </div>
            );
          })}

          {walletVisibilityError && <p className="pf-empty" role="alert">{walletVisibilityError}</p>}
          {visibleClosedPositions.length > 0 && (
            <div className="pf-closed">
              <button
                className="pf-closed__toggle"
                type="button"
                onClick={() => setShowClosedPositions((prev) => !prev)}
              >
                {showClosedPositions ? 'Скрыть закрытые' : `Закрытые (${visibleClosedPositions.length})`}
              </button>
              {showClosedPositions && (
                <div className="pf-grp pf-grp--muted">
                  {visibleClosedPositions.map((position) => position.asset_type_code === 'collectible' ? (
                    <button key={position.id} type="button" className="pf-pos pf-pos--sold" onClick={() => void handleOpenPositionDetails(position.id)}>
                      <div className="pf-pos__identity">
                        <span className="clx-thumb"><CollectibleImage metadata={position.metadata} className="clx-tile__img" /></span>
                        <div className="pf-pos__copy">
                          <div className="pf-pos__title">{position.title}</div>
                          <div className="pf-pos__sub">
                            {position.closed_at ? `Продан ${formatDateLabel(position.closed_at)}` : 'Продан'}
                          </div>
                        </div>
                      </div>
                      <div className="pf-pos__right"><div className="pf-pos__amount">{collectibleSaleLabel(position)}</div></div>
                    </button>
                  ) : (
                    <div key={position.id} className="pf-pos pf-pos--closed">
                      <div className="pf-pos__copy">
                        <div className="pf-pos__title">{position.title}</div>
                        <div className="pf-pos__sub">
                          {position.investment_account_name}
                          {' · '}{formatAmount(position.amount_in_currency, position.currency_code)}
                          {position.close_amount_in_currency && position.close_currency_code
                            ? ` → ${formatAmount(position.close_amount_in_currency, position.close_currency_code)}`
                            : ''}
                          {position.closed_at ? ` · ${formatDateLabel(position.closed_at)}` : ''}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ══ Operations pane ══ */}
      {portfolioView === 'ops' && (
        <div className="pf-view">
          {['crypto','collectible'].includes(activeAssetTypeCode) && accounts.some(a => a.account.investment_asset_type === activeAssetTypeCode) && (
            <div className="pf-ops-tools">
              <button type="button" className="credits-textbtn" onClick={() => setCorrectionsOpen(true)}>
                <Pencil strokeWidth={2} /> Исправить операцию
              </button>
            </div>
          )}
          <Operations
            user={user}
            embedded
            initialViewMode="investment"
            allowedModes={['investment']}
            investmentAssetTypeCode={activeAssetTypeCode}
          />
        </div>
      )}

      {/* ══ Analytics pane ══ */}
      {portfolioView === 'analytics' && (() => {
        const sym = currencySymbol(user.base_currency_code);
        const money = (value: number) => `${formatNumericAmount(value, 0)} ${sym}`;
        const signed = (value: number) => `${value > 0 ? '+' : value < 0 ? '−' : ''}${formatNumericAmount(Math.abs(value), 0)} ${sym}`;
        const tone = (value: number) => (value > 0 ? 'pos' : value < 0 ? 'neg' : undefined);
        const accountsTotal = portfolioAnalyticsAccounts.reduce((sum, account) => sum + Math.max(account.estimatedValue, 0), 0);
        const periodTotal = analyticsTotalIncome + analyticsTotalTrades;
        const monthMax = Math.max(...analyticsMonthlyBars.map((bar) => Math.abs(bar.total)), 1);
        return (
          <div className="pf-view pa-view">
            {scopeSummary}
            {(activeAssetTypeCode === 'crypto' || activeAssetTypeCode === 'collectible') && (
              <InvestmentCostAnalytics assetType={activeAssetTypeCode}
                accountId={activeAccountTabKey === 'all' ? undefined : Number(activeAccountTabKey.split(':')[1])}
                baseCurrencyCode={user.base_currency_code} />
            )}

            {activeAssetTypeCode !== 'crypto' && activeAssetTypeCode !== 'collectible' && (
              <section className="pa-card">
                <div className="pa-card__head"><h3 className="pa-card__title">Доход за период</h3></div>
                <div className="ana-scope">
                  {(['month', 'quarter', 'year'] as const).map((pt) => (
                    <button
                      key={pt}
                      type="button"
                      className={`ana-scope__chip${analyticsPeriodType === pt ? ' ana-scope__chip--active' : ''}`}
                      onClick={() => { setAnalyticsPeriodType(pt); setAnalyticsPeriodOffset(0); }}
                    >
                      {pt === 'month' ? 'Месяц' : pt === 'quarter' ? 'Квартал' : 'Год'}
                    </button>
                  ))}
                </div>
                <div className="trend">
                  <div className="trend__nav">
                    <button className="trend__nav-btn" type="button" aria-label="Предыдущий период" onClick={() => setAnalyticsPeriodOffset((o) => o - 1)}>‹</button>
                    <span className="trend__period-label">{analyticsPeriodRange.label}</span>
                    <button className="trend__nav-btn" type="button" aria-label="Следующий период" onClick={() => setAnalyticsPeriodOffset((o) => o + 1)}>›</button>
                  </div>
                  {!analyticsLoading && analyticsMonthlyBars.length > 1 && (
                    <div className="trend__bars" style={{ gridTemplateColumns: `repeat(${analyticsMonthlyBars.length}, minmax(0, 1fr))` }}>
                      {analyticsMonthlyBars.map((bar) => (
                        <div key={bar.period} className="trend__bar" title={`${bar.label}: ${signed(bar.total)}`}>
                          <div className={`trend__fill pa-trend__fill--${bar.total < 0 ? 'neg' : 'pos'}`} style={{ height: `${Math.max((Math.abs(bar.total) / monthMax) * 100, 3)}%` }} />
                          <span className="trend__lbl">{bar.label}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {analyticsLoading ? (
                  <p className="pa-empty">Собираем аналитику…</p>
                ) : !scopedAnalytics ? (
                  <p className="pa-empty">Нет данных за выбранный период</p>
                ) : (
                  <>
                    <div className="ana-hero">
                      <div className="ana-hero__val">
                        <span className={`ana-hero__num${periodTotal < 0 ? ' pa-amt--neg' : ''}`}>{periodTotal < 0 ? '−' : ''}{formatNumericAmount(Math.abs(periodTotal), 0)}</span>
                        <span className="ana-hero__sym"> {sym}</span>
                      </div>
                      <div className="ana-hero__meta">
                        <span>Доход {signed(analyticsTotalIncome)}</span>
                        <span>·</span>
                        <span>Сделки {signed(analyticsTotalTrades)}</span>
                      </div>
                    </div>

                    {analyticsAssetTypeDonut.length > 0 && activeAssetTypeCode === 'all' && (
                      <>
                        <div className="pa-group-label">По типам активов</div>
                        <div className="ana-cats">
                          {analyticsAssetTypeDonut.map((segment) => {
                            const meta = PA_ASSET_TYPE_META[segment.key] ?? PA_ASSET_TYPE_META.other;
                            return (
                              <PaRow key={segment.key} icon={<meta.Icon />} color={meta.color} title={segment.label}
                                amount={signed(segment.amount)} amountTone={tone(segment.amount)} share={segment.share}
                                footRight={`${(segment.share * 100).toFixed(1)}%`} />
                            );
                          })}
                        </div>
                      </>
                    )}

                    {analyticsIncomeKindDonut.length > 0 && (
                      <>
                        <div className="pa-group-label">По видам дохода</div>
                        <div className="ana-cats">
                          {analyticsIncomeKindDonut.map((segment) => {
                            const meta = PA_INCOME_KIND_META[segment.key] ?? PA_INCOME_KIND_META.other;
                            return (
                              <PaRow key={segment.key} icon={<meta.Icon />} color={meta.color} title={segment.label}
                                amount={money(segment.amount)} share={segment.share}
                                footRight={`${(segment.share * 100).toFixed(1)}%`} />
                            );
                          })}
                        </div>
                      </>
                    )}

                    {scopedAnalytics.totals_by_account.length > 0 && (
                      <>
                        <div className="pa-group-label">По счетам</div>
                        <div className="ana-cats">
                          {scopedAnalytics.totals_by_account.map((account, index) => {
                            const accountTotal = account.income_total + account.trade_total + account.adjustment_total;
                            return (
                              <PaRow key={account.investment_account_id} icon={account.account_name.slice(0, 1).toUpperCase()}
                                color={PA_COLORS[index % PA_COLORS.length]} title={account.account_name}
                                amount={signed(accountTotal)} amountTone={tone(accountTotal)}
                                foot={`${account.income_count} ${pluralRu(account.income_count, ['выплата', 'выплаты', 'выплат'])} · ${account.trade_count} ${pluralRu(account.trade_count, ['сделка', 'сделки', 'сделок'])}`}
                                footRight={`доход ${signed(account.income_total)}`} />
                            );
                          })}
                        </div>
                      </>
                    )}
                  </>
                )}
              </section>
            )}

            {portfolioAnalyticsBuckets.length > 0 && (
              <section className="pa-card">
                <div className="pa-card__head"><h3 className="pa-card__title">Структура по типам бумаг</h3></div>
                <div className="ana-cats">
                  {portfolioAnalyticsBuckets.map((bucket) => {
                    const meta = PA_SECURITY_KIND_META[bucket.key] ?? PA_ASSET_TYPE_META.security;
                    return (
                      <PaRow key={bucket.key} icon={<meta.Icon />} color={meta.color} title={bucket.label}
                        amount={money(bucket.estimatedValue)} share={bucket.share}
                        foot={`${bucket.positionsCount} поз. · вложено ${money(bucket.investedPrincipal)}${bucket.nkdValue > 0 ? ` · НКД ${money(bucket.nkdValue)}` : ''}`}
                        footRight={<span className={`pa-foot--${tone(bucket.currentResult) ?? 'mute'}`}>{signed(bucket.currentResult)}</span>} />
                    );
                  })}
                </div>
              </section>
            )}

            {portfolioAnalyticsAccounts.length > 0 && (
              <section className="pa-card">
                <div className="pa-card__head"><h3 className="pa-card__title">Счета</h3></div>
                <div className="ana-cats">
                  {portfolioAnalyticsAccounts.map((account, index) => account.isCollection ? (
                    // Items have no market price yet: show what is known instead of a zero value and result.
                    <PaRow key={account.key} icon={account.accountName.slice(0, 1).toUpperCase()}
                      color={PA_COLORS[index % PA_COLORS.length]} title={account.accountName}
                      amount="—" amountTone="mute"
                      foot={`себестоимость ${money(account.investedPrincipal)}${account.cashValue !== 0 ? ` · деньги ${money(account.cashValue)}` : ''}`} />
                  ) : (
                    <PaRow key={account.key} icon={account.accountName.slice(0, 1).toUpperCase()}
                      color={PA_COLORS[index % PA_COLORS.length]} title={account.accountName}
                      amount={`${money(account.estimatedValue)}`}
                      share={accountsTotal > 0 ? Math.max(account.estimatedValue, 0) / accountsTotal : 0}
                      foot={`${account.isCrypto ? 'затраты' : 'вложено'} ${money(account.investedPrincipal)}${!account.isCrypto || account.cashValue !== 0 ? ` · остаток ${money(account.cashValue)}` : ''}`}
                      footRight={account.isCrypto ? undefined : <span className={`pa-foot--${tone(account.resultValue) ?? 'mute'}`}>{signed(account.resultValue)}</span>} />
                  ))}
                </div>
              </section>
            )}

            {activeAssetTypeCode === 'crypto' && visibleCryptoProtocolPositions.length > 0 && (
              <section className="pa-card">
                <div className="pa-card__head"><h3 className="pa-card__title">Размещено в DeFi</h3></div>
                <div className="ana-cats">
                  {visibleCryptoProtocolPositions.map((position, index) => {
                    const protocolValue = getLendingNetValue(position);
                    let detail = position.asset_symbol;
                    if (position.position_type === 'liquidity_pool') {
                      const lp = getLiquidityPoolMetadata(position);
                      detail = lp.token1_symbol ? `${position.asset_symbol}/${lp.token1_symbol}` : position.asset_symbol;
                    } else if (position.position_type === 'lending') {
                      const lend = getLendingMetadata(position);
                      detail = `${formatNumericAmount(position.current_quantity ?? 0, 8)} ${position.asset_symbol}${(lend.borrowed_quantity ?? 0) > 0 ? ` · долг ${formatNumericAmount(lend.borrowed_quantity ?? 0, 8)} ${lend.borrowed_asset_symbol ?? lend.borrowed_asset ?? ''}` : ''}`;
                    } else if (position.current_quantity) {
                      detail = `${formatNumericAmount(position.current_quantity, 8)} ${position.asset_symbol}`;
                    }
                    return (
                      <PaRow key={position.id} onClick={() => handleOpenProtocolDetails(position.id)}
                        icon={<CoinStack symbols={defiCoinSymbols([position])} />}
                        color={PA_COLORS[index % PA_COLORS.length]} title={protocolDisplayName(position)}
                        amount={protocolValue === null ? '—' : money(protocolValue)} amountTone={protocolValue === null ? 'mute' : undefined}
                        foot={`${PROTOCOL_TYPE_LABELS[position.position_type] ?? position.position_type} · ${detail}`} />
                    );
                  })}
                </div>
              </section>
            )}

            {portfolioAnalyticsLeaders.length > 0 && (
              <section className="pa-card">
                <div className="pa-card__head"><h3 className="pa-card__title">{activeAssetTypeCode === 'crypto' ? 'Монеты кошельков' : 'Крупнейшие позиции'}</h3></div>
                <div className="ana-cats">
                  {portfolioAnalyticsLeaders.map((item, index) => (
                    <PaRow key={item.positionId} onClick={() => void handleOpenPositionDetails(item.positionId)}
                      icon={item.logoUrl ? <img src={item.logoUrl} alt="" loading="lazy" /> : item.title.slice(0, 1).toUpperCase()}
                      color={PA_COLORS[index % PA_COLORS.length]} title={item.title}
                      amount={money(item.estimatedValue)} share={item.share}
                      foot={[item.accountName, item.quantityLabel, item.ticker].filter(Boolean).join(' · ')}
                      footRight={item.currentResult !== null
                        ? <span className={`pa-foot--${tone(item.currentResult) ?? 'mute'}`}>{signed(item.currentResult)}</span>
                        : `${(item.share * 100).toFixed(1)}%`} />
                  ))}
                </div>
              </section>
            )}
          </div>
        );
      })()}

      {(() => {
        const posIconColor = selectedPosition ? assetTypeIconColor(selectedPosition.asset_type_code) : { icon: 'chart', color: 'b' };
        const posLogoName = selectedPosition ? getPositionMetadataText(selectedPosition, 'logo_name') : null;
        const posCryptoSymbol = selectedPosition
          ? getPositionMetadataText(selectedPosition, 'asset_symbol') ?? selectedPosition.title
          : null;
        const posLogoUrl = selectedPosition?.asset_type_code === 'crypto'
          ? getCryptoIconUrl(posCryptoSymbol, selectedPosition.metadata)
          : posLogoName ? getTinkoffInstrumentLogoUrl(posLogoName) : null;
        return (
      <BottomSheet
        open={!!selectedPosition}
        gray
        tag={selectedPosition ? `${selectedPosition.investment_account_owner_type === 'family' ? 'Семейный' : 'Личный'} · ${selectedPosition.investment_account_name}` : ''}
        title={selectedPosition?.title ?? ''}
        icon={selectedPosition?.asset_type_code === 'collectible' ? undefined : selectedPosition ? (posLogoUrl ? <img src={posLogoUrl} alt="" /> : <CategorySvgIcon code={posIconColor.icon} />) : undefined}
        iconColor={posLogoUrl ? undefined : posIconColor.color}
        onClose={() => {
          if (selectedPosition) clearPositionDrafts(selectedPosition.id);
          setSelectedPositionId(null);
        }}
      >
        {selectedPosition && (
          <div className="pf-detail-body">
            {selectedPosition.asset_type_code === 'collectible' && <CollectibleHero key={selectedPosition.id} position={selectedPosition} />}
            {(() => {
              const detailTicker = typeof selectedPosition.metadata?.ticker === 'string' ? selectedPosition.metadata.ticker : null;
              const detailMoexPrice = detailTicker ? moexPrices.get(detailTicker) : null;
              const detailQuote = getResolvedPositionQuote(selectedPosition);
              const detailCurrentTotal = selectedPosition.asset_type_code === 'collectible' ? null : selectedPosition.asset_type_code === 'crypto'
                ? getResolvedPositionEstimatedValue(selectedPosition)
                : detailQuote.currentTotalValue;
              const detailEntryAmount = getPositionEntryAmount(selectedPosition);
              const detailPnl = getResolvedPositionCurrentResult(selectedPosition);
              const detailPnlPct = detailPnl !== null && detailEntryAmount > 0
                ? (detailPnl / detailEntryAmount) * 100
                : null;
              const isClosingHint = detailQuote.source === 'moex' && detailMoexPrice?.last === null && detailMoexPrice?.prevClose !== null;
              const ccy = selectedPosition.currency_code;
              const pnlSign = detailPnl !== null && detailPnl >= 0 ? 'pos' : 'neg';
              const detailCryptoSymbol = getPositionMetadataText(selectedPosition, 'asset_symbol') ?? selectedPosition.title;
              const detailCryptoNetwork = getPositionMetadataText(selectedPosition, 'network_code');
              const detailMetaCurrency = selectedPosition.asset_type_code === 'crypto' ? user.base_currency_code : ccy;
              const detailCryptoLivePrice = selectedPosition.asset_type_code === 'crypto' ? getCryptoLivePrice(selectedPosition) : null;
              return (
                <>
                  {(selectedPosition.asset_type_code === 'crypto' || detailTicker || isClosingHint) && (
                    <div className="pf-detail-meta-row">
                      {selectedPosition.asset_type_code === 'crypto' ? (
                        <>
                          <span className="pf-detail-ticker">{detailCryptoSymbol}</span>
                          {detailCryptoNetwork && <span className="pf-detail-pill">{detailCryptoNetwork}</span>}
                        </>
                      ) : detailTicker && <span className="pf-detail-ticker">{detailTicker}</span>}
                      <span className="pf-detail-pill">{detailMetaCurrency}</span>
                      {isClosingHint && <span className="pf-detail-hint-pill">цена закрытия</span>}
                    </div>
                  )}
                  <div className="pf-dstats">
                    <div className="pf-dstats__cell">
                      <span className="pf-dstats__label">{selectedPosition.asset_type_code === 'crypto' ? 'Количество' : selectedPosition.asset_type_code === 'collectible' ? 'Себестоимость' : 'Вложено'}</span>
                      <span className="pf-dstats__value">
                        {selectedPosition.asset_type_code === 'crypto'
                          ? formatNumericAmount(selectedPosition.quantity ?? 0, 8)
                          : formatNumericAmount(detailEntryAmount, 0)}
                      </span>
                      <span className="pf-dstats__sub">{selectedPosition.asset_type_code === 'crypto' ? detailCryptoSymbol : detailMetaCurrency}</span>
                    </div>
                    {selectedPosition.asset_type_code === 'collectible' && selectedPosition.status === 'closed' ? (
                      <div className="pf-dstats__cell">
                        <span className="pf-dstats__label">Продан за</span>
                        <span className="pf-dstats__value">{collectibleSaleLabel(selectedPosition)}</span>
                      </div>
                    ) : (
                    <div className="pf-dstats__cell">
                      <span className="pf-dstats__label">Стоимость</span>
                      <span className="pf-dstats__value">
                        {detailCurrentTotal !== null ? formatNumericAmount(detailCurrentTotal, 0) : '—'}
                      </span>
                      <span className="pf-dstats__sub">{detailCurrentTotal !== null ? 'текущая' : selectedPosition.asset_type_code === 'collectible' ? 'рыночной цены нет' : 'нет данных'}</span>
                    </div>
                    )}
                    {selectedPosition.asset_type_code !== 'collectible' && <div className="pf-dstats__cell">
                      <span className="pf-dstats__label">{selectedPosition.asset_type_code === 'crypto' ? 'Курс' : 'P&L'}</span>
                      {selectedPosition.asset_type_code === 'crypto' ? (
                        <>
                          <span className="pf-dstats__value">
                            {detailCryptoLivePrice ? formatNumericAmount(detailCryptoLivePrice.price, detailCryptoLivePrice.price < 1 ? 6 : 2) : '—'}
                          </span>
                          <span className="pf-dstats__sub">{detailCryptoLivePrice ? `${user.base_currency_code} · онлайн` : 'нет данных'}</span>
                        </>
                      ) : (
                        <>
                          <span className={`pf-dstats__value pf-dstats__value--${pnlSign}`}>
                            {detailPnl !== null ? `${detailPnl >= 0 ? '+' : ''}${formatNumericAmount(detailPnl, 0)}` : '—'}
                          </span>
                          <span className="pf-dstats__sub">
                            {detailPnlPct !== null ? `${detailPnlPct >= 0 ? '+' : ''}${detailPnlPct.toFixed(1)}%` : '—'}
                          </span>
                        </>
                      )}
                    </div>}
                  </div>
                </>
              );
            })()}

            {(() => {
              const isDeposit = selectedPosition.asset_type_code === 'deposit' && !!selectedPosition.metadata?.deposit_kind;
              const accrued = typeof selectedPosition.metadata?.accrued_interest === 'number' ? Number(selectedPosition.metadata.accrued_interest) : 0;
              if (!isDeposit || accrued <= 0) return null;
              return (
                <div className="pf-dnext">
                  <div className="pf-dnext__left">
                    <span className="pf-dnext__label">Накоплено сегодня</span>
                    <span className="pf-dnext__date">проценты к получению</span>
                  </div>
                  <span className="pf-dnext__amount">+{formatNumericAmount(accrued, 0)} {currencySymbol(selectedPosition.currency_code)}</span>
                </div>
              );
            })()}

            <div className="pf-dcond">
              <div className="pf-dcond__head">
                <span className="sec-tag">Параметры</span>
                {selectedPosition.asset_type_code === 'collectible' && collectibleEditingId !== selectedPosition.id && (
                  <button type="button" className="clx-pencil" aria-label="Изменить описание"
                    onClick={() => { setCollectibleOpeningPack(false); setCollectibleEditingId(selectedPosition.id); setCollectibleDateError(null); }}>
                    <Pencil strokeWidth={2} />
                  </button>
                )}
              </div>
              <div className="pf-dcond__row">
                <span className="pf-dcond__row-label">Дата входа</span>
                <span className="pf-dcond__row-value">{formatDateLabel(selectedPosition.opened_at)}</span>
              </div>
              {selectedPosition.asset_type_code === 'deposit' && selectedPosition.metadata?.deposit_kind ? (
                <>
                  {typeof selectedPosition.metadata.interest_rate === 'number' && (
                    <div className="pf-dcond__row">
                      <span className="pf-dcond__row-label">Ставка</span>
                      <span className="pf-dcond__row-value">{selectedPosition.metadata.interest_rate}% годовых</span>
                    </div>
                  )}
                  {selectedPosition.metadata.deposit_kind === 'term_deposit' && selectedPosition.metadata.end_date && (
                    <div className="pf-dcond__row">
                      <span className="pf-dcond__row-label">Срок до</span>
                      <span className="pf-dcond__row-value">{formatDateLabel(String(selectedPosition.metadata.end_date))}</span>
                    </div>
                  )}
                  {selectedPosition.metadata.deposit_kind === 'term_deposit' && selectedPosition.metadata.interest_payout && (
                    <div className="pf-dcond__row">
                      <span className="pf-dcond__row-label">Выплата</span>
                      <span className="pf-dcond__row-value">{
                        selectedPosition.metadata.interest_payout === 'at_end' ? 'в конце срока'
                          : selectedPosition.metadata.interest_payout === 'monthly_to_account' ? 'ежемесячно на счёт'
                            : selectedPosition.metadata.interest_payout === 'capitalize'
                              ? `капитализация ${selectedPosition.metadata.capitalization_period === 'daily' ? 'ежедневно' : 'ежемесячно'}`
                              : String(selectedPosition.metadata.interest_payout)
                      }</span>
                    </div>
                  )}
                  {selectedPosition.metadata.deposit_kind === 'savings_account' && selectedPosition.metadata.capitalization_period && (
                    <div className="pf-dcond__row">
                      <span className="pf-dcond__row-label">Капитализация</span>
                      <span className="pf-dcond__row-value">{selectedPosition.metadata.capitalization_period === 'daily' ? 'ежедневно' : 'ежемесячно'}</span>
                    </div>
                  )}
                  {selectedPosition.metadata.deposit_kind === 'term_deposit' && selectedPosition.metadata.end_date && (() => {
                    const projected = calculateProjectedInterest({
                      depositKind: 'term_deposit',
                      principal: selectedPosition.amount_in_currency,
                      annualRate: Number(selectedPosition.metadata.interest_rate),
                      startDate: selectedPosition.opened_at,
                      endDate: String(selectedPosition.metadata.end_date),
                      interestPayout: selectedPosition.metadata.interest_payout as 'at_end' | 'monthly_to_account' | 'capitalize' | undefined,
                      capitalizationPeriod: selectedPosition.metadata.capitalization_period as 'daily' | 'monthly' | undefined,
                    });
                    return projected > 0 ? (
                      <div className="pf-dcond__row">
                        <span className="pf-dcond__row-label">Доход за срок</span>
                        <span className="pf-dcond__row-value pf-dcond__row-value--pos">+{formatAmount(projected, selectedPosition.currency_code)}</span>
                      </div>
                    ) : null;
                  })()}
                </>
              ) : (
                <>
                  {selectedPosition.quantity && !(selectedPosition.asset_type_code === 'collectible' && Number(selectedPosition.quantity) === 1) ? (
                    <div className="pf-dcond__row">
                      <span className="pf-dcond__row-label">Количество</span>
                      <span className="pf-dcond__row-value">
                        {formatNumericAmount(selectedPosition.quantity, 8)} {selectedPosition.asset_type_code === 'crypto' ? (getPositionMetadataText(selectedPosition, 'asset_symbol') ?? selectedPosition.title) : 'шт.'}
                      </span>
                    </div>
                  ) : null}
                  {selectedPosition.asset_type_code === 'collectible' ? (() => {
                    const itemLink = safeItemLink(selectedPosition.metadata?.item_link);
                    return (
                      <>
                        {['unknown', 'free'].includes(String(selectedPosition.metadata?.acquisition_kind)) && (
                          <div className="pf-dcond__row"><span className="pf-dcond__row-label">Цена покупки</span><span className="pf-dcond__row-value">{selectedPosition.metadata?.acquisition_kind === 'free' ? 'Получен бесплатно' : 'Неизвестна'}</span></div>
                        )}
                        <div className="pf-dcond__row"><span className="pf-dcond__row-label">Дата приобретения</span><span className="pf-dcond__row-value">{typeof selectedPosition.metadata?.acquired_at === 'string' ? selectedPosition.metadata.acquired_at.split('-').reverse().join('.') : '—'}</span></div>
                        {(['paid_crypto', 'sold_for_crypto'] as const).map((key) => {
                          const coins = selectedPosition.metadata?.[key] as { symbol?: string; quantity?: string } | undefined;
                          return coins?.quantity ? (
                            <div className="pf-dcond__row" key={key}>
                              <span className="pf-dcond__row-label">{key === 'paid_crypto' ? 'Куплено за' : 'Продано за'}</span>
                              <span className="pf-dcond__row-value">{formatNumericAmount(Number(coins.quantity), 4)} {coins.symbol}</span>
                            </div>
                          ) : null;
                        })}
                        {itemLink && (
                          <div className="pf-dcond__row">
                            <span className="pf-dcond__row-label">Ссылка</span>
                            <a className="pf-dcond__row-value" href={itemLink.href} target="_blank" rel="noopener noreferrer">{itemLink.host}</a>
                          </div>
                        )}
                        {collectibleEditingId !== selectedPosition.id && isSealedPack(selectedPosition.metadata) && (
                          <div className="clx-edit-actions">
                            <button className="sh-btn clx-open-btn" type="button" onClick={() => { setCollectibleOpeningPack(true); setCollectibleEditingId(selectedPosition.id); setCollectibleDateError(null); }}>Пак открыт</button>
                          </div>
                        )}
                        {collectibleEditingId === selectedPosition.id && <form className="clx-editor" key={`details-${selectedPosition.id}-${collectibleOpeningPack}`} onSubmit={async (event) => {
                          event.preventDefault();
                          const form = new FormData(event.currentTarget);
                          const text = (key: string) => String(form.get(key) ?? '').trim();
                          const attributes = { ...(selectedPosition.metadata?.item_attributes as Record<string, string> ?? {}) };
                          for (const field of getCollectibleKind(selectedPosition.metadata?.item_kind)?.fields ?? []) {
                            const value = text(`attribute-${field.key}`);
                            if (field.flag) attributes[field.key] = value ? 'yes' : 'no';
                            else if (value) attributes[field.key] = value; else delete attributes[field.key];
                          }
                          const details = { title: text('title'), comment: text('comment') || null,
                            acquired_at: text('acquired_at') || null, item_kind: String(selectedPosition.metadata?.item_kind ?? 'other'),
                            item_link: text('item_link') || null, image_url: text('image_url') || null, item_attributes: attributes };
                          const positionId = selectedPosition.id;
                          setCollectibleDateSaving(true); setCollectibleDateError(null);
                          try {
                            await editCollectibleDetails(positionId, { ...details, request_id: collectibleDateRequest.requestId({ positionId, ...details }) });
                            collectibleDateRequest.completed(); setCollectibleEditingId(null);
                            await loadPortfolio();
                          } catch (reason: unknown) { setCollectibleDateError(reason instanceof Error ? reason.message : String(reason)); }
                          finally { setCollectibleDateSaving(false); }
                        }}>
                          <label className="apf-label">Название<input className="apf-input" name="title" defaultValue={selectedPosition.title} required maxLength={200} autoFocus={!collectibleOpeningPack} /></label>
                          <label className="apf-label">Дата приобретения<input className="apf-input" type="date" name="acquired_at" defaultValue={String(selectedPosition.metadata?.acquired_at ?? '')} /></label>
                          {(getCollectibleKind(selectedPosition.metadata?.item_kind)?.fields ?? []).map(field => field.flag
                            ? <label className="apf-check" key={field.key}><input type="checkbox" name={`attribute-${field.key}`} value="yes" defaultChecked={collectibleFlag(selectedPosition.metadata, field.key) && !(field.key === 'sealed' && collectibleOpeningPack)} />{field.label}</label>
                            : <label className="apf-label" key={field.key}>{field.label}<input className="apf-input" name={`attribute-${field.key}`} maxLength={200} autoFocus={field.key === 'number' && collectibleOpeningPack} defaultValue={String((selectedPosition.metadata?.item_attributes as Record<string, unknown>)?.[field.key] ?? '')} /></label>)}
                          <label className="apf-label">Ссылка на предмет<input className="apf-input" type="url" name="item_link" defaultValue={String(selectedPosition.metadata?.item_link ?? '')} /></label>
                          <label className="apf-label">Ссылка на изображение<input className="apf-input" type="url" name="image_url" defaultValue={String(selectedPosition.metadata?.image_url ?? '')} /></label>
                          <label className="apf-label">Комментарий<textarea className="apf-input" name="comment" maxLength={2000} defaultValue={selectedPosition.comment ?? ''} /></label>
                          <div className="clx-edit-actions"><button type="button" className="sh-btn sh-btn--ghost" disabled={collectibleDateSaving} onClick={() => setCollectibleEditingId(null)}>Отмена</button><button type="submit" className="sh-btn sh-btn--primary" disabled={collectibleDateSaving}>Сохранить</button></div>
                          {collectibleDateError && <div className="apf-error">{collectibleDateError}</div>}
                        </form>}
                      </>
                    );
                  })() : null}
                  {selectedPosition.asset_type_code === 'crypto' && getPositionMetadataText(selectedPosition, 'network_code') ? (
                    <div className="pf-dcond__row">
                      <span className="pf-dcond__row-label">Сеть</span>
                      <span className="pf-dcond__row-value">{getPositionMetadataText(selectedPosition, 'network_code')}</span>
                    </div>
                  ) : null}
                  {selectedPosition.asset_type_code === 'crypto' ? (() => {
                    const livePrice = getCryptoLivePrice(selectedPosition);
                    const cryptoCurrentRate = formatUnitPrice(
                      getResolvedPositionEstimatedValue(selectedPosition),
                      selectedPosition.quantity,
                      user.base_currency_code,
                    );
                    const cryptoSymbol = getPositionMetadataText(selectedPosition, 'asset_symbol') ?? selectedPosition.title;
                    return (
                      <>
                        <div className="pf-dcond__row">
                          <span className="pf-dcond__row-label">Текущая оценка</span>
                          <span className="pf-dcond__row-value">{livePrice ? formatAmount(getResolvedPositionEstimatedValue(selectedPosition), user.base_currency_code) : 'Нет свежей котировки'}</span>
                        </div>
                        {livePrice && (
                          <div className="pf-dcond__row">
                            <span className="pf-dcond__row-label">Котировка</span>
                            <span className="pf-dcond__row-value">{livePrice.source === 'tonapi' ? 'TonAPI' : livePrice.source === 'coingecko' ? 'CoinGecko' : livePrice.source} · {new Date(livePrice.fetched_at).toLocaleString('ru-RU')}</span>
                          </div>
                        )}
                        {livePrice && cryptoCurrentRate ? (
                        <div className="pf-dcond__row">
                          <span className="pf-dcond__row-label">Текущий курс</span>
                          <span className="pf-dcond__row-value">
                            {cryptoCurrentRate} за {cryptoSymbol} · онлайн
                          </span>
                        </div>
                      ) : null}
                      </>
                    );
                  })() : null}
                  {getPositionInvestedPrincipal(selectedPosition) > 0 ? (
                    <div className="pf-dcond__row">
                      <span className="pf-dcond__row-label">Себестоимость</span>
                      <span className="pf-dcond__row-value">{formatAmount(getPositionInvestedPrincipal(selectedPosition), user.base_currency_code)}</span>
                    </div>
                  ) : null}
                  {(getPositionMetadataNumber(selectedPosition, 'accrued_interest_paid_in_base') ?? 0) > 0 ? (
                    <div className="pf-dcond__row">
                      <span className="pf-dcond__row-label">НКД при покупке</span>
                      <span className="pf-dcond__row-value">{formatAmount(getPositionMetadataNumber(selectedPosition, 'accrued_interest_paid_in_base') ?? 0, user.base_currency_code)}</span>
                    </div>
                  ) : null}
                  {typeof selectedPosition.metadata?.fees_in_base === 'number' && Number(selectedPosition.metadata.fees_in_base) > 0 ? (
                    <div className="pf-dcond__row">
                      <span className="pf-dcond__row-label">Комиссии</span>
                      <span className="pf-dcond__row-value">{formatAmount(Number(selectedPosition.metadata.fees_in_base), user.base_currency_code)}</span>
                    </div>
                  ) : null}
                  {getPositionRealizedResult(selectedPosition) !== 0 ? (
                    <div className="pf-dcond__row">
                      <span className="pf-dcond__row-label">Реализованный результат</span>
                      <span className={`pf-dcond__row-value pf-dcond__row-value--${getPositionRealizedResult(selectedPosition) >= 0 ? 'pos' : 'neg'}`}>
                        {getPositionRealizedResult(selectedPosition) >= 0 ? '+' : ''}{formatAmount(getPositionRealizedResult(selectedPosition), user.base_currency_code)}
                      </span>
                    </div>
                  ) : null}
                </>
              )}
              {selectedPosition.comment ? (
                <div className="pf-dcond__row pf-dcond__row--comment">
                  <span className="pf-dcond__row-label">Комментарий</span>
                  <span className="pf-dcond__row-value pf-dcond__row-value--text">{selectedPosition.comment}</span>
                </div>
              ) : null}
            </div>

              {selectedPosition.status === 'open' && (() => {
                const isDepositPosition = selectedPosition.asset_type_code === 'deposit' && !!selectedPosition.metadata?.deposit_kind;
                const isTermDeposit = selectedPosition.metadata?.deposit_kind === 'term_deposit';
                const isCryptoPosition = selectedPosition.asset_type_code === 'crypto';
                const tile = (label: string, Icon: LucideIcon, onClick: () => void, primary = false) => (
                  <button key={label} className={`cat-act${primary ? ' cat-act--primary' : ''}`} type="button" onClick={onClick}>
                    <span className="cat-act__ico"><Icon strokeWidth={primary ? 2.2 : 2} /></span>
                    <span className="cat-act__label">{label}</span>
                  </button>
                );
                const canAdjustPrincipal = !isCryptoPosition && !(isDepositPosition && isTermDeposit);
                const tiles = [
                  canAdjustPrincipal && { label: selectedPosition.asset_type_code === 'collectible' ? 'Вложить' : 'Пополнить', Icon: Plus, run: () => handleOpenTopUpForm(selectedPosition) },
                  !isDepositPosition && canRecordPositionIncome(selectedPosition) && { label: 'Доход', Icon: HandCoins, run: () => handleOpenIncomeForm(selectedPosition) },
                  canAdjustPrincipal && { label: selectedPosition.asset_type_code !== 'collectible' ? 'Снять' : Number(selectedPosition.quantity) > 1 ? 'Продать часть' : 'Вернуть часть', Icon: ArrowUpFromLine, run: () => handleOpenPartialCloseForm(selectedPosition) },
                  isDepositPosition && {
                    label: 'Ставка',
                    Icon: Percent,
                    run: () => {
                      clearPositionDrafts(selectedPosition.id);
                      setRateChangeDrafts((prev) => ({
                        ...prev,
                        [selectedPosition.id]: {
                          newRate: String(selectedPosition.metadata?.interest_rate ?? ''),
                          effectiveDate: todayIso(),
                        },
                      }));
                    },
                  },
                  !isCryptoPosition && !isDepositPosition && { label: 'Комиссия', Icon: Coins, run: () => handleOpenFeeForm(selectedPosition) },
                ].filter((item) => item !== false);
                return (
                  <>
                    {tiles.length > 0 && (
                      <div className="cat-actions cat-actions--crypto" role="group" aria-label="Действия с позицией">
                        {tiles.map((item, index) => tile(item.label, item.Icon, item.run, index === 0))}
                      </div>
                    )}
                    <div className="pf-sheet-actions">
                      <button className="btn btn--ghost" type="button" onClick={() => handleOpenCloseForm(selectedPosition)}>
                        {selectedPosition.asset_type_code === 'collectible' ? 'Продать' : 'Закрыть позицию'}
                      </button>
                    </div>
                  </>
                );
              })()}

              {closeDrafts[selectedPosition.id] && (
                <form className="pf-pos-form" onSubmit={(event) => void handleClosePosition(selectedPosition.id, event)}>
                  <div className="apf-row">
                    <div className="apf-field" style={{ flex: 2 }}>
                      <label className="apf-label">{selectedPosition.asset_type_code === 'collectible' ? 'Сумма продажи' : 'Сумма выхода'}</label>
                      <input
                        className="apf-input"
                        type="text"
                        inputMode="decimal"
                        placeholder="0"
                        value={closeDrafts[selectedPosition.id].amount}
                        onChange={(event) => handleCloseDraftChange(selectedPosition.id, { amount: event.target.value })}
                        disabled={submittingCloseId === selectedPosition.id}
                      />
                    </div>
                    <div className="apf-field" style={{ flex: 1 }}>
                      <label className="apf-label">Валюта</label>
                      <select
                        className="apf-input"
                        value={closeDrafts[selectedPosition.id].currencyCode}
                        onChange={(event) => handleCloseDraftChange(selectedPosition.id, { currencyCode: event.target.value })}
                        disabled={submittingCloseId === selectedPosition.id}
                      >
                        {currencies.map((currency) => (
                          <option key={currency.code} value={currency.code}>
                            {currency.code}
                          </option>
                        ))}
                        {selectedPosition.asset_type_code === 'collectible' && cryptoAssets.map((asset) => (
                          <option key={asset.id} value={`crypto:${asset.id}`}>
                            {asset.symbol} · {asset.network_code}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="apf-field" style={{ flex: 1 }}>
                      <label className="apf-label">Дата</label>
                      <input
                        className="apf-input"
                        type="date"
                        value={closeDrafts[selectedPosition.id].closedAt}
                        onChange={(event) => handleCloseDraftChange(selectedPosition.id, { closedAt: event.target.value })}
                        disabled={submittingCloseId === selectedPosition.id}
                      />
                    </div>
                  </div>
                  {(() => {
                    const draft = closeDrafts[selectedPosition.id];
                    if (draft.currencyCode !== selectedPosition.currency_code) return null;
                    const info = getDepositCloseInfo(
                      selectedPosition,
                      draft.closedAt,
                      Number(draft.amount) || 0,
                    );
                    if (!info.isDeposit || info.interest <= 0) return null;
                    const cur = selectedPosition.currency_code;
                    return (
                      <div className="pf-close-sum">
                        <div className="pf-close-sum__row">
                          <span className="pf-close-sum__label">Возврат тела</span>
                          <span className="pf-close-sum__value">{formatAmount(Number(draft.amount) || 0, cur)}</span>
                        </div>
                        <div className="pf-close-sum__row">
                          <span className="pf-close-sum__label">
                            {info.capitalized ? 'в т.ч. проценты (капитализация)' : 'Проценты за период'}
                          </span>
                          <span className="pf-close-sum__value pf-close-sum__value--pos">
                            +{formatAmount(info.interest, cur)}
                          </span>
                        </div>
                        <div className="pf-close-sum__row pf-close-sum__row--total">
                          <span className="pf-close-sum__label">Зачислится на счёт</span>
                          <span className="pf-close-sum__value">{formatAmount(info.totalToAccount, cur)}</span>
                        </div>
                      </div>
                    );
                  })()}
                  {selectedPosition.asset_type_code === 'collectible' && closeDrafts[selectedPosition.id].currencyCode.startsWith('crypto:') && Number(selectedPosition.quantity) > 1 && (
                    <div className="apf-field">
                      <label className="apf-label">Количество предметов</label>
                      <input className="apf-input" inputMode="decimal" placeholder={`Все (${selectedPosition.quantity})`}
                        value={collectionSoldQuantity} onChange={(e) => setCollectionSoldQuantity(sanitizeDecimalInput(e.target.value))} />
                    </div>
                  )}
                  {closeDrafts[selectedPosition.id].currencyCode !== user.base_currency_code
                    && !closeDrafts[selectedPosition.id].currencyCode.startsWith('crypto:') && (
                    <div className="apf-field">
                      <label className="apf-label">Историческая стоимость в {user.base_currency_code}</label>
                      <input
                        className="apf-input"
                        type="text"
                        inputMode="decimal"
                        placeholder="0"
                        value={closeDrafts[selectedPosition.id].baseAmount}
                        onChange={(event) => handleCloseDraftChange(selectedPosition.id, { baseAmount: event.target.value })}
                        disabled={submittingCloseId === selectedPosition.id}
                      />
                    </div>
                  )}
                  <div className="apf-field">
                    <label className="apf-label">Комментарий</label>
                    <input
                      className="apf-input"
                      type="text"
                      placeholder="Необязательно"
                      value={closeDrafts[selectedPosition.id].comment}
                      onChange={(event) => handleCloseDraftChange(selectedPosition.id, { comment: event.target.value })}
                      disabled={submittingCloseId === selectedPosition.id}
                    />
                  </div>
                  <div className="apf-actions">
                    <button className="apf-submit" type="submit" disabled={submittingCloseId === selectedPosition.id}>
                      {submittingCloseId === selectedPosition.id ? 'Закрываем…' : 'Подтвердить закрытие'}
                    </button>
                  </div>
                </form>
              )}

              {partialCloseDrafts[selectedPosition.id] && (
                <form className="pf-pos-form" onSubmit={(event) => void handlePartialClosePosition(selectedPosition, event)}>
                  <div className="apf-row">
                    <div className="apf-field" style={{ flex: 2 }}>
                      <label className="apf-label">Сумма возврата</label>
                      <input
                        className="apf-input"
                        type="text"
                        inputMode="decimal"
                        placeholder="0"
                        value={partialCloseDrafts[selectedPosition.id].returnAmount}
                        onChange={(event) => handlePartialCloseDraftChange(selectedPosition.id, { returnAmount: event.target.value })}
                        disabled={submittingPartialCloseId === selectedPosition.id}
                      />
                    </div>
                    <div className="apf-field" style={{ flex: 1 }}>
                      <label className="apf-label">Валюта</label>
                      <select
                        className="apf-input"
                        value={partialCloseDrafts[selectedPosition.id].returnCurrencyCode}
                        onChange={(event) => handlePartialCloseDraftChange(selectedPosition.id, { returnCurrencyCode: event.target.value })}
                        disabled={submittingPartialCloseId === selectedPosition.id}
                      >
                        {currencies.map((currency) => (
                          <option key={currency.code} value={currency.code}>
                            {currency.code}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div className="apf-row">
                    <div className="apf-field" style={{ flex: 1 }}>
                      <label className="apf-label">Списать principal</label>
                      <input
                        className="apf-input"
                        type="text"
                        inputMode="decimal"
                        placeholder="0"
                        value={partialCloseDrafts[selectedPosition.id].principalReduction}
                        onChange={(event) => handlePartialCloseDraftChange(selectedPosition.id, { principalReduction: event.target.value })}
                        disabled={submittingPartialCloseId === selectedPosition.id}
                      />
                    </div>
                    {selectedPosition.quantity !== null && selectedPosition.quantity !== undefined && (
                      <div className="apf-field" style={{ flex: 1 }}>
                        <label className="apf-label">Списать количество</label>
                        <input
                          className="apf-input"
                          type="text"
                          inputMode="decimal"
                          placeholder="0"
                          value={partialCloseDrafts[selectedPosition.id].closedQuantity}
                          onChange={(event) => handlePartialCloseDraftChange(selectedPosition.id, { closedQuantity: event.target.value })}
                          disabled={submittingPartialCloseId === selectedPosition.id}
                        />
                      </div>
                    )}
                    <div className="apf-field" style={{ flex: 1 }}>
                      <label className="apf-label">Дата</label>
                      <input
                        className="apf-input"
                        type="date"
                        value={partialCloseDrafts[selectedPosition.id].closedAt}
                        onChange={(event) => handlePartialCloseDraftChange(selectedPosition.id, { closedAt: event.target.value })}
                        disabled={submittingPartialCloseId === selectedPosition.id}
                      />
                    </div>
                  </div>
                  {partialCloseDrafts[selectedPosition.id].returnCurrencyCode !== user.base_currency_code && (
                    <div className="apf-field">
                      <label className="apf-label">Историческая стоимость возврата в {user.base_currency_code}</label>
                      <input
                        className="apf-input"
                        type="text"
                        inputMode="decimal"
                        placeholder="0"
                        value={partialCloseDrafts[selectedPosition.id].returnBaseAmount}
                        onChange={(event) => handlePartialCloseDraftChange(selectedPosition.id, { returnBaseAmount: event.target.value })}
                        disabled={submittingPartialCloseId === selectedPosition.id}
                      />
                    </div>
                  )}
                  <div className="apf-field">
                    <label className="apf-label">Комментарий</label>
                    <input
                      className="apf-input"
                      type="text"
                      placeholder="Необязательно"
                      value={partialCloseDrafts[selectedPosition.id].comment}
                      onChange={(event) => handlePartialCloseDraftChange(selectedPosition.id, { comment: event.target.value })}
                      disabled={submittingPartialCloseId === selectedPosition.id}
                    />
                  </div>
                  <div className="apf-actions">
                    <button className="apf-submit" type="submit" disabled={submittingPartialCloseId === selectedPosition.id}>
                      {submittingPartialCloseId === selectedPosition.id ? 'Проводим…' : 'Подтвердить частичное закрытие'}
                    </button>
                  </div>
                </form>
              )}

              {incomeDrafts[selectedPosition.id] && (
                <form className="pf-pos-form" onSubmit={(event) => void handleRecordIncome(selectedPosition, event)}>
                  {selectedPosition.asset_type_code === 'crypto' ? (
                    <div className="apf-field">
                      <label className="apf-label">Количество дохода</label>
                      <input
                        className="apf-input"
                        type="text"
                        inputMode="decimal"
                        placeholder="0"
                        value={incomeDrafts[selectedPosition.id].quantity}
                        onChange={(event) => handleIncomeDraftChange(selectedPosition.id, { quantity: sanitizeDecimalInput(event.target.value) })}
                        disabled={submittingIncomeId === selectedPosition.id}
                      />
                    </div>
                  ) : (
                    <div className="apf-row">
                      <div className="apf-field" style={{ flex: 2 }}>
                        <label className="apf-label">
                          {selectedPosition.asset_type_code === 'deposit' ? 'Сумма процентов' : selectedPosition.asset_type_code === 'security' ? 'Сумма дивидендов' : 'Сумма дохода'}
                        </label>
                        <input
                          className="apf-input"
                          type="text"
                          inputMode="decimal"
                          placeholder="0"
                          value={incomeDrafts[selectedPosition.id].amount}
                          onChange={(event) => handleIncomeDraftChange(selectedPosition.id, { amount: event.target.value })}
                          disabled={submittingIncomeId === selectedPosition.id}
                        />
                      </div>
                      <div className="apf-field" style={{ flex: 1 }}>
                        <label className="apf-label">Валюта</label>
                        <select
                          className="apf-input"
                          value={incomeDrafts[selectedPosition.id].currencyCode}
                          onChange={(event) => handleIncomeDraftChange(selectedPosition.id, { currencyCode: event.target.value })}
                          disabled={submittingIncomeId === selectedPosition.id}
                        >
                          {currencies.map((currency) => (
                            <option key={currency.code} value={currency.code}>
                              {currency.code}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  )}
                  <div className="apf-field">
                    <label className="apf-label">Тип дохода</label>
                    <select
                      className="apf-input"
                      value={incomeDrafts[selectedPosition.id].incomeKind}
                      onChange={(event) => handleIncomeDraftChange(selectedPosition.id, { incomeKind: event.target.value })}
                      disabled={submittingIncomeId === selectedPosition.id}
                    >
                      {selectedPosition.asset_type_code === 'deposit' ? (
                        <>
                          <option value="interest">Проценты</option>
                          <option value="other">Другой доход</option>
                        </>
                      ) : selectedPosition.asset_type_code === 'security' ? (
                        <>
                          <option value="dividend">Дивиденды</option>
                          <option value="coupon">Купон</option>
                          <option value="other">Другой доход</option>
                        </>
                      ) : selectedPosition.asset_type_code === 'crypto' ? (
                        <>
                          <option value="reward">Награда</option>
                          <option value="staking">Стейкинг</option>
                          <option value="lending">Лендинг</option>
                          <option value="liquidity">Пул ликвидности</option>
                          <option value="other">Другой доход</option>
                        </>
                      ) : (
                        <>
                          <option value="other">Другой доход</option>
                          <option value="interest">Проценты</option>
                        </>
                      )}
                    </select>
                  </div>
                  {selectedPosition.asset_type_code !== 'crypto' && (
                    <div className="apf-field">
                      <label className="apf-label">Назначение</label>
                      <select
                        className="apf-input"
                        value={incomeDrafts[selectedPosition.id].destination}
                        onChange={(event) => handleIncomeDraftChange(selectedPosition.id, { destination: event.target.value as 'account' | 'position' })}
                        disabled={submittingIncomeId === selectedPosition.id}
                      >
                        <option value="account">На счёт</option>
                        <option value="position">Оставить в активе</option>
                      </select>
                    </div>
                  )}
                  <div className="apf-field">
                    <label className="apf-label">Дата</label>
                    <input
                      className="apf-input"
                      type="date"
                      value={incomeDrafts[selectedPosition.id].receivedAt}
                      onChange={(event) => handleIncomeDraftChange(selectedPosition.id, { receivedAt: event.target.value })}
                      disabled={submittingIncomeId === selectedPosition.id}
                    />
                  </div>
                  {incomeDrafts[selectedPosition.id].currencyCode !== user.base_currency_code && (
                    <div className="apf-field">
                      <label className="apf-label">Историческая стоимость в {user.base_currency_code}</label>
                      <input
                        className="apf-input"
                        type="text"
                        inputMode="decimal"
                        placeholder="0"
                        value={incomeDrafts[selectedPosition.id].baseAmount}
                        onChange={(event) => handleIncomeDraftChange(selectedPosition.id, { baseAmount: event.target.value })}
                        disabled={submittingIncomeId === selectedPosition.id}
                      />
                    </div>
                  )}
                  <div className="apf-field">
                    <label className="apf-label">Комментарий</label>
                    <input
                      className="apf-input"
                      type="text"
                      placeholder="Необязательно"
                      value={incomeDrafts[selectedPosition.id].comment}
                      onChange={(event) => handleIncomeDraftChange(selectedPosition.id, { comment: event.target.value })}
                      disabled={submittingIncomeId === selectedPosition.id}
                    />
                  </div>
                  <div className="apf-actions">
                    <button
                      className="apf-submit"
                      type="submit"
                      disabled={submittingIncomeId === selectedPosition.id
                        || !incomeDrafts[selectedPosition.id].amount.trim()
                        || (selectedPosition.asset_type_code === 'crypto' && !incomeDrafts[selectedPosition.id].quantity.trim())}
                    >
                      {submittingIncomeId === selectedPosition.id ? 'Начисляем…' : 'Подтвердить доход'}
                    </button>
                  </div>
                </form>
              )}

              {topUpDrafts[selectedPosition.id] && (
                <form className="pf-pos-form" onSubmit={(event) => void handleTopUpPosition(selectedPosition, event)}>
                  {selectedPosition.asset_type_code === 'collectible' && (
                    <div className="apf-field">
                      <label className="apf-label">Валюта доплаты</label>
                      <select className="apf-input" value={topUpDrafts[selectedPosition.id].currencyCode}
                        onChange={(e) => handleTopUpDraftChange(selectedPosition.id, { currencyCode: e.target.value })}>
                        {currencies.map((c) => <option key={c.code} value={c.code}>{c.code}</option>)}
                        {(coinBalancesByAccountId.get(selectedPosition.investment_account_id) ?? []).map((coin) => (
                          <option key={`crypto:${coin.crypto_asset_id}`} value={`crypto:${coin.crypto_asset_id}`}>{coin.symbol}</option>
                        ))}
                      </select>
                    </div>
                  )}
                  {selectedPosition.metadata?.acquisition_kind === 'unknown' && <label className="apf-label"><input type="checkbox" checked={topUpDrafts[selectedPosition.id].resolvePurchasePrice ?? false} onChange={e => handleTopUpDraftChange(selectedPosition.id, { resolvePurchasePrice: e.target.checked, allocationPositionIds: [], quantity: '' })} /> Это найденная цена покупки</label>}
                  {selectedPosition.asset_type_code === 'collectible' && !topUpDrafts[selectedPosition.id].resolvePurchasePrice && topUpDrafts[selectedPosition.id].currencyCode.startsWith('crypto:') && (
                    <div className="apf-field">
                      <label className="apf-label">Распределить затраты поровну на единицу</label>
                      <button className="sh-btn sh-btn--ghost" type="button" disabled={submittingTopUpId === selectedPosition.id}
                        onClick={() => handleTopUpDraftChange(selectedPosition.id, { allocationPositionIds: positions.filter((p) => p.asset_type_code === 'collectible' && p.status === 'open' && p.investment_account_id === selectedPosition.investment_account_id && p.id !== selectedPosition.id).map((p) => p.id) })}>Выбрать все</button>
                      <span>{selectedPosition.title}</span>
                      {positions.filter((p) => p.asset_type_code === 'collectible' && p.status === 'open' && p.investment_account_id === selectedPosition.investment_account_id && p.id !== selectedPosition.id).map((p) => (
                        <label key={p.id}>
                          <input type="checkbox" disabled={submittingTopUpId === selectedPosition.id}
                            checked={topUpDrafts[selectedPosition.id].allocationPositionIds?.includes(p.id) ?? false}
                            onChange={(event) => {
                              const ids = topUpDrafts[selectedPosition.id].allocationPositionIds ?? [];
                              handleTopUpDraftChange(selectedPosition.id, { allocationPositionIds: event.target.checked ? [...ids, p.id] : ids.filter((id) => id !== p.id) });
                            }} /> {p.title}
                        </label>
                      ))}
                    </div>
                  )}
                  <div className="apf-field">
                    <label className="apf-label">{selectedPosition.asset_type_code === 'collectible' ? 'Сумма в стоимость предмета' : 'Сумма пополнения'}</label>
                    <input
                      className="apf-input"
                      type="text"
                      inputMode="decimal"
                      placeholder="0"
                      value={topUpDrafts[selectedPosition.id].amount}
                      onChange={(event) => handleTopUpDraftChange(selectedPosition.id, { amount: event.target.value })}
                      disabled={submittingTopUpId === selectedPosition.id}
                    />
                  </div>
                  <div className="apf-row apf-row--compact-labels">
                    {!topUpDrafts[selectedPosition.id].resolvePurchasePrice && !(selectedPosition.asset_type_code === 'collectible' && topUpDrafts[selectedPosition.id].currencyCode.startsWith('crypto:')) && <div className="apf-field" style={{ flex: 1 }}>
                      <label className="apf-label">Количество</label>
                      <input
                        className="apf-input"
                        type="text"
                        inputMode="decimal"
                        placeholder="—"
                        value={topUpDrafts[selectedPosition.id].quantity}
                        onChange={(event) => handleTopUpDraftChange(selectedPosition.id, { quantity: event.target.value })}
                        disabled={submittingTopUpId === selectedPosition.id}
                      />
                    </div>}
                    <div className="apf-field" style={{ flex: 1 }}>
                      <label className="apf-label">Дата</label>
                      <input
                        className="apf-input"
                        type="date"
                        value={topUpDrafts[selectedPosition.id].toppedUpAt}
                        onChange={(event) => handleTopUpDraftChange(selectedPosition.id, { toppedUpAt: event.target.value })}
                        disabled={submittingTopUpId === selectedPosition.id}
                      />
                    </div>
                  </div>
                  <div className="apf-field">
                    <label className="apf-label">Комментарий</label>
                    <input
                      className="apf-input"
                      type="text"
                      placeholder="Необязательно"
                      value={topUpDrafts[selectedPosition.id].comment}
                      onChange={(event) => handleTopUpDraftChange(selectedPosition.id, { comment: event.target.value })}
                      disabled={submittingTopUpId === selectedPosition.id}
                    />
                  </div>
                  <div className="apf-actions">
                    <button className="apf-submit" type="submit" disabled={submittingTopUpId === selectedPosition.id}>
                      {submittingTopUpId === selectedPosition.id ? 'Пополняем…' : 'Подтвердить пополнение'}
                    </button>
                  </div>
                </form>
              )}


              {feeDrafts[selectedPosition.id] && (
                <form className="pf-pos-form" onSubmit={(event) => void handleRecordFee(selectedPosition, event)}>
                  <div className="apf-row">
                    <div className="apf-field" style={{ flex: 2 }}>
                      <label className="apf-label">Сумма комиссии</label>
                      <input
                        className="apf-input"
                        type="text"
                        inputMode="decimal"
                        placeholder="0"
                        value={feeDrafts[selectedPosition.id].amount}
                        onChange={(event) => handleFeeDraftChange(selectedPosition.id, { amount: event.target.value })}
                        disabled={submittingFeeId === selectedPosition.id}
                      />
                    </div>
                    <div className="apf-field" style={{ flex: 1 }}>
                      <label className="apf-label">Валюта</label>
                      <select
                        className="apf-input"
                        value={feeDrafts[selectedPosition.id].currencyCode}
                        onChange={(event) => handleFeeDraftChange(selectedPosition.id, { currencyCode: event.target.value })}
                        disabled={submittingFeeId === selectedPosition.id}
                      >
                        {currencies.map((currency) => (
                          <option key={currency.code} value={currency.code}>
                            {currency.code}
                          </option>
                        ))}
                        {selectedPosition.asset_type_code === 'collectible' && (coinBalancesByAccountId.get(selectedPosition.investment_account_id) ?? []).map((coin) => (
                          <option key={`crypto:${coin.crypto_asset_id}`} value={`crypto:${coin.crypto_asset_id}`}>{coin.symbol}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div className="apf-field">
                    <label className="apf-label">Дата</label>
                    <input
                      className="apf-input"
                      type="date"
                      value={feeDrafts[selectedPosition.id].chargedAt}
                      onChange={(event) => handleFeeDraftChange(selectedPosition.id, { chargedAt: event.target.value })}
                      disabled={submittingFeeId === selectedPosition.id}
                    />
                  </div>
                  <div className="apf-balance">
                    Доступно: {formatAmount(getAccountBalanceForCurrency(selectedPosition.investment_account_id, feeDrafts[selectedPosition.id].currencyCode), feeDrafts[selectedPosition.id].currencyCode)}
                  </div>
                  <div className="apf-field">
                    <label className="apf-label">Комментарий</label>
                    <input
                      className="apf-input"
                      type="text"
                      placeholder="Необязательно"
                      value={feeDrafts[selectedPosition.id].comment}
                      onChange={(event) => handleFeeDraftChange(selectedPosition.id, { comment: event.target.value })}
                      disabled={submittingFeeId === selectedPosition.id}
                    />
                  </div>
                  <div className="apf-actions">
                    <button className="apf-submit" type="submit" disabled={submittingFeeId === selectedPosition.id}>
                      {submittingFeeId === selectedPosition.id ? 'Списываем…' : 'Подтвердить комиссию'}
                    </button>
                  </div>
                </form>
              )}

              {rateChangeDrafts[selectedPosition.id] && (
                <form className="pf-pos-form" onSubmit={(event) => void handleChangeRate(selectedPosition, event)}>
                  <div className="apf-row">
                    <div className="apf-field" style={{ flex: 1 }}>
                      <label className="apf-label">Новая ставка, % годовых</label>
                      <input
                        className="apf-input"
                        type="text"
                        inputMode="decimal"
                        placeholder="0.0"
                        value={rateChangeDrafts[selectedPosition.id].newRate}
                        onChange={(event) => setRateChangeDrafts((prev) => ({
                          ...prev,
                          [selectedPosition.id]: { ...prev[selectedPosition.id], newRate: event.target.value },
                        }))}
                        disabled={submittingRateChangeId === selectedPosition.id}
                      />
                    </div>
                    <div className="apf-field" style={{ flex: 1 }}>
                      <label className="apf-label">Дата вступления</label>
                      <input
                        className="apf-input"
                        type="date"
                        value={rateChangeDrafts[selectedPosition.id].effectiveDate}
                        onChange={(event) => setRateChangeDrafts((prev) => ({
                          ...prev,
                          [selectedPosition.id]: { ...prev[selectedPosition.id], effectiveDate: event.target.value },
                        }))}
                        disabled={submittingRateChangeId === selectedPosition.id}
                      />
                    </div>
                  </div>
                  <div className="apf-actions">
                    <button className="apf-submit" type="submit" disabled={submittingRateChangeId === selectedPosition.id}>
                      {submittingRateChangeId === selectedPosition.id ? 'Сохраняем…' : 'Изменить ставку'}
                    </button>
                  </div>
                </form>
              )}

              {closeError && <p className="pf-detail-error">{closeError}</p>}
              {incomeError && <p className="pf-detail-error">{incomeError}</p>}
              {topUpError && <p className="pf-detail-error">{topUpError}</p>}
              {partialCloseError && <p className="pf-detail-error">{partialCloseError}</p>}
              {feeError && <p className="pf-detail-error">{feeError}</p>}
              {rateChangeError && <p className="pf-detail-error">{rateChangeError}</p>}
              {deleteError && <p className="pf-detail-error">{deleteError}</p>}
              {cancelIncomeError && <p className="pf-detail-error">{cancelIncomeError}</p>}

              <div className="ca-sheet__hist">
                <div className="ca-sheet__hist-toggle">
                  <h3 className="ca-sheet__hist-title">История · <span className="ca-sheet__hist-count">{selectedPositionEvents.length}</span></h3>
                </div>
                {eventsError && <p className="pf-detail-error">{eventsError}</p>}
                {eventsLoadingId === selectedPosition.id ? (
                  <p className="ca-sheet__hist-empty" role="status">Загружаем историю…</p>
                ) : selectedPositionEvents.length === 0 ? (
                  <p className="ca-sheet__hist-empty">Событий пока нет.</p>
                ) : (
                  selectedPositionEvents.map((item) => {
                    const coinMovement = (item.metadata?.sold_for_crypto ?? item.metadata?.paid_crypto) as { quantity?: number | string; symbol?: string; crypto_asset_id?: number } | undefined;
                    const coinSymbol = coinMovement?.symbol ?? cryptoAssets.find((asset) => asset.id === coinMovement?.crypto_asset_id)?.symbol;
                    const coinLabel = coinMovement && coinSymbol ? `${formatNumericAmount(Number(coinMovement.quantity), 8)} ${coinSymbol}` : null;
                    const details = [
                      coinLabel && item.amount != null && item.currency_code ? `Себестоимость: ${formatAmount(item.amount, item.currency_code)}` : null,
                      typeof item.metadata?.destination === 'string' ? (item.metadata.destination === 'position' ? 'В актив' : 'На счёт') : null,
                      item.quantity ? `Количество: ${item.quantity}` : null,
                      item.event_type === 'swap_out' && typeof item.metadata?.to_asset_symbol === 'string' && item.metadata?.to_amount
                        ? `Получено: ${item.metadata.to_amount} ${item.metadata.to_asset_symbol}` : null,
                      item.event_type === 'swap_in' && typeof item.metadata?.from_asset_symbol === 'string' && item.metadata?.from_amount
                        ? `Отдано: ${item.metadata.from_amount} ${item.metadata.from_asset_symbol}` : null,
                      selectedPosition.asset_type_code !== 'crypto' && item.event_type === 'partial_close'
                        && typeof item.metadata?.principal_amount_in_currency === 'number'
                        ? `Вложено: ${formatAmount(Number(item.metadata.principal_amount_in_currency), selectedPosition.currency_code)}` : null,
                      selectedPosition.asset_type_code !== 'crypto' && !coinLabel && (item.event_type === 'close' || item.event_type === 'partial_close')
                        && typeof item.metadata?.realized_result_in_base === 'number'
                        ? `Результат: ${formatAmount(Number(item.metadata.realized_result_in_base), user.base_currency_code)}` : null,
                      item.comment && !item.comment_is_system ? item.comment : null,
                    ].filter(Boolean);
                    return (
                      <div className="ca-sheet__row" key={item.id}>
                        <div className="ca-sheet__row-date">{new Date(item.event_at).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' })}</div>
                        <div className="ca-sheet__row-body">
                          <div className="ca-sheet__row-line">
                            <span className="ca-sheet__row-qty">{getEventLabel(item, selectedPosition?.asset_type_code)}</span>
                            {selectedPosition.asset_type_code !== 'crypto' && item.amount !== null && item.amount !== undefined && item.currency_code && (
                              <span className="ca-sheet__row-val">{coinLabel ?? formatAmount(item.amount, item.currency_code)}</span>
                            )}
                          </div>
                          {details.length > 0 && (
                            <div className="ca-sheet__row-meta">
                              {details.map((text) => <span className="ca-sheet__row-cp" key={String(text)}>{text}</span>)}
                            </div>
                          )}
                          {item.event_type === 'income' && (
                            selectedPositionCancelledIncomeIds.has(item.id) ? (
                              <span className="ca-sheet__row-legacy">Уже отменён</span>
                            ) : (
                              <button
                                className="credits-textbtn credits-textbtn--danger"
                                type="button"
                                disabled={cancellingIncomeEventId === item.id}
                                onClick={() => void handleCancelIncome(selectedPosition.id, item.id)}
                              >
                                {cancellingIncomeEventId === item.id ? 'Отменяем...' : 'Отменить доход'}
                              </button>
                            )
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              <button
                className="credits-textbtn credits-textbtn--danger ca-sheet__hide"
                type="button"
                disabled={deletingPositionId === selectedPosition.id}
                onClick={() => void handleDeletePosition(selectedPosition)}
              >
                <Trash2 size={15} strokeWidth={2} /> {deletingPositionId === selectedPosition.id ? 'Удаляем...' : 'Удалить позицию'}
              </button>
          </div>
        )}
      </BottomSheet>
        );
      })()}

      {selectedProtocolPosition && (
        <BottomSheet
          open={!!selectedProtocolPosition}
          gray
          tag={`${selectedProtocolPosition.owner_type === 'family' ? 'Семейный' : 'Личный'} · ${selectedProtocolPosition.investment_account_name}`}
          title={protocolDisplayName(selectedProtocolPosition)}
          icon={<CategorySvgIcon code="coins" />}
          iconColor="o"
          onClose={() => {
            setSelectedProtocolPositionId(null);
            setStakingUpdateError(null);
            setStakingCloseError(null);
          }}
        >
          <div className="pf-detail-body">
            <div className="pf-detail-meta-row">
              <span className="pf-detail-ticker pf-detail-ticker--raw">
                {selectedLendingGroup.length > 1
                  ? selectedLendingGroup.map((item) => item.asset_symbol).join(' + ')
                  : selectedProtocolPosition.position_type === 'liquidity_pool' && getLiquidityPoolMetadata(selectedProtocolPosition).token1_symbol
                    ? `${selectedProtocolPosition.asset_symbol}/${getLiquidityPoolMetadata(selectedProtocolPosition).token1_symbol}`
                    : selectedProtocolPosition.asset_symbol}
              </span>
              {selectedProtocolPosition.network_code && <span className="pf-detail-pill">{cryptoNetworkLabel(selectedProtocolPosition.network_code)}</span>}
              <span className="pf-detail-pill">{(PROTOCOL_TYPE_LABELS[selectedProtocolPosition.position_type] ?? selectedProtocolPosition.position_type).toLowerCase()}</span>
            </div>

            <div className={`pf-dstats${(selectedLendingGroup.length > 1 || selectedProtocolPosition.position_type === 'liquidity_pool') ? " pf-dstats--lending-group" : ""}`}>
              {selectedProtocolPosition.position_type === 'liquidity_pool' ? (() => {
                const lp = getLiquidityPoolMetadata(selectedProtocolPosition);
                const composition = selectedProtocolPosition.metadata.lp_composition as { quantity0: string; quantity1: string; observed_at: string } | undefined;
                return (
                  <>
                    <div className="pf-dstats__cell">
                      <span className="pf-dstats__label">{selectedProtocolPosition.asset_symbol}</span>
                      <span className="pf-dstats__value">{formatNumericAmount(Number(composition?.quantity0 ?? selectedProtocolPosition.current_quantity ?? selectedProtocolPosition.quantity ?? 0), 8)}</span>
                      <span className="pf-dstats__sub">{composition ? `на ${formatDateLabel(composition.observed_at)}` : 'по внесениям'}</span>
                    </div>
                    {lp.token1_symbol && (
                      <div className="pf-dstats__cell">
                        <span className="pf-dstats__label">{lp.token1_symbol}</span>
                        <span className="pf-dstats__value">{formatNumericAmount(Number(composition?.quantity1 ?? lp.token1_quantity ?? 0), 8)}</span>
                        <span className="pf-dstats__sub">{composition ? `на ${formatDateLabel(composition.observed_at)}` : 'по внесениям'}</span>
                      </div>
                    )}
                    <div className="pf-dstats__cell">
                      <span className="pf-dstats__label">Рыночная оценка</span>
                      <span className="pf-dstats__value">{formatProtocolValue(getLendingNetValue(selectedProtocolPosition))}</span>
                      <span className="pf-dstats__sub">{user.base_currency_code}</span>
                    </div>
                    {lp.fees_earned_in_base != null && (
                      <div className="pf-dstats__cell">
                        <span className="pf-dstats__label">Комиссии</span>
                        <span className="pf-dstats__value">{formatNumericAmount(lp.fees_earned_in_base, 0)}</span>
                        <span className="pf-dstats__sub">заработано</span>
                      </div>
                    )}
                  </>
                );
              })() : selectedProtocolPosition.position_type === 'lending' && selectedLendingGroup.length > 1 ? (
                <>
                  {selectedLendingGroup.map((item) => (
                    <div className="pf-dstats__cell" key={item.id}>
                      <span className="pf-dstats__label">Залог</span>
                      <span className="pf-dstats__value">{formatNumericAmount(item.current_quantity ?? item.quantity ?? 0, 8)}</span>
                      <span className="pf-dstats__sub">{item.asset_symbol}</span>
                    </div>
                  ))}
                  {selectedLendingGroup.filter((item) => (getLendingMetadata(item).borrowed_quantity ?? 0) > 0).map((item) => {
                    const debt = getLendingMetadata(item);
                    return <div className="pf-dstats__cell" key={`debt:${item.id}`}>
                      <span className="pf-dstats__label">Общий долг</span>
                      <span className="pf-dstats__value">{formatNumericAmount(debt.borrowed_quantity ?? 0, 8)}</span>
                      <span className="pf-dstats__sub">{debt.borrowed_asset_symbol ?? debt.borrowed_asset}</span>
                    </div>;
                  })}
                  <div className="pf-dstats__cell">
                    <span className="pf-dstats__label">Залог − долг</span>
                    <span className="pf-dstats__value">{formatProtocolValue(sumProtocolValues(selectedLendingGroup.map(getProtocolValuation)))}</span>
                    <span className="pf-dstats__sub">{user.base_currency_code}</span>
                  </div>
                </>
              ) : selectedProtocolPosition.position_type === 'lending' ? (() => {
                const lend = getLendingMetadata(selectedProtocolPosition);
                const borrowQty = lend.borrowed_quantity ?? 0;
                const netValue = getLendingNetValue(selectedProtocolPosition);
                return (
                  <>
                    <div className="pf-dstats__cell">
                      <span className="pf-dstats__label">Поставлено</span>
                      <span className="pf-dstats__value">{formatNumericAmount(selectedProtocolPosition.current_quantity ?? selectedProtocolPosition.quantity ?? 0, 8)}</span>
                      <span className="pf-dstats__sub">{selectedProtocolPosition.asset_symbol}</span>
                    </div>
                    {borrowQty > 0 ? (
                      <div className="pf-dstats__cell">
                        <span className="pf-dstats__label">Долг</span>
                        <span className="pf-dstats__value">{formatNumericAmount(borrowQty, 8)}</span>
                        <span className="pf-dstats__sub">{lend.borrowed_asset_symbol ?? lend.borrowed_asset ?? ''}</span>
                      </div>
                    ) : null}
                    <div className="pf-dstats__cell">
                      <span className="pf-dstats__label">Залог − долг</span>
                      <span className="pf-dstats__value">{formatProtocolValue(netValue)}</span>
                      <span className="pf-dstats__sub">{user.base_currency_code}</span>
                    </div>
                    {lend.apr != null && (
                      <div className="pf-dstats__cell">
                        <span className="pf-dstats__label">APR</span>
                        <span className="pf-dstats__value">{lend.apr}</span>
                        <span className="pf-dstats__sub">% годовых</span>
                      </div>
                    )}
                  </>
                );
              })() : (
                <>
                  <div className="pf-dstats__cell">
                    <span className="pf-dstats__label">Количество</span>
                    <span className="pf-dstats__value">{formatNumericAmount(selectedProtocolPosition.current_quantity ?? selectedProtocolPosition.quantity ?? 0, 8)}</span>
                    <span className="pf-dstats__sub">{selectedProtocolPosition.asset_symbol}</span>
                  </div>
                  <div className="pf-dstats__cell">
                    <span className="pf-dstats__label">Рыночная оценка</span>
                    <span className="pf-dstats__value">{formatProtocolValue(getLendingNetValue(selectedProtocolPosition))}</span>
                    <span className="pf-dstats__sub">{user.base_currency_code}</span>
                  </div>
                  <div className="pf-dstats__cell">
                    <span className="pf-dstats__label">Награды</span>
                    <span className="pf-dstats__value">{formatNumericAmount(selectedProtocolPosition.rewards_unclaimed_in_base, 0)}</span>
                    <span className="pf-dstats__sub">к получению</span>
                  </div>
                </>
              )}
            </div>

            <div className="pf-dcond">
              <div className="pf-dcond__head"><span className="sec-tag">Себестоимость и оценка</span></div>
              <div className="pf-dcond__row">
                <span className="pf-dcond__row-label">{selectedProtocolPosition.status === 'closed' ? 'Затраты до закрытия' : selectedLendingGroup.length > 1 ? `Затраты залога ${selectedProtocolPosition.asset_symbol}` : 'Учтённые затраты'}</span>
                <span className="pf-dcond__row-value">{selectedProtocolPosition.cost_basis_in_base === null ? 'Не определены' : formatAmount(selectedProtocolPosition.cost_basis_in_base, user.base_currency_code)}</span>
              </div>
              {[selectedProtocolPosition.metadata.funding_units0, selectedProtocolPosition.metadata.funding_units1].some((units) =>
                units && typeof units === 'object' && Object.values(units).some((amount) => Number(amount) > 0)) && (
                <div className="pf-dcond__row"><span className="pf-dcond__row-label">Финансирование</span><span className="pf-dcond__row-value">Открыто</span></div>
              )}
              {getProtocolValuation(selectedProtocolPosition).reason && (
                <div className="pf-dcond__row"><span className="pf-dcond__row-label">Оценка</span><span className="pf-dcond__row-value">{getProtocolValuation(selectedProtocolPosition).reason}</span></div>
              )}
              {getProtocolValuation(selectedProtocolPosition).quotes.map((quote) => (
                <div className="pf-dcond__row" key={quote.crypto_asset_id}>
                  <span className="pf-dcond__row-label">Курс {quote.symbol}</span>
                  <span className="pf-dcond__row-value">
                    {formatNumericAmount(quote.price, quote.price < 1 ? 6 : 2)} {currencySymbol(user.base_currency_code)}
                    <span className="pf-dcond__row-note">{cryptoPriceSourceLabel(quote.source)}, {cryptoQuoteTime(quote.fetched_at)}</span>
                  </span>
                </div>
              ))}
            </div>

            {selectedLendingGroup.length > 1 && (
              <div className="pf-dcond">
                <div className="pf-dcond__head"><span className="sec-tag">Залоги счёта</span></div>
                {selectedLendingGroup.map((item) => (
                  <button type="button" className="pf-dcond__row pf-dcond__row--pick" key={item.id}
                    aria-pressed={item.id === selectedProtocolPosition.id}
                    onClick={() => handleOpenProtocolDetails(item.id)}>
                    <span className="pf-dcond__row-label">{item.asset_symbol}</span>
                    <span className="pf-dcond__row-value">
                      {formatNumericAmount(item.current_quantity ?? item.quantity ?? 0, 8)}
                      {item.id === selectedProtocolPosition.id ? <Check size={14} strokeWidth={2.4} aria-label="открыт" /> : <ChevronRight size={14} strokeWidth={2} aria-hidden="true" />}
                    </span>
                  </button>
                ))}
              </div>
            )}

            <div className="pf-dcond">
              <div className="pf-dcond__head">
                <span className="sec-tag">Параметры</span>
              </div>
              <div className="pf-dcond__row">
                <span className="pf-dcond__row-label">Дата входа</span>
                <span className="pf-dcond__row-value">{formatDateLabel(selectedProtocolPosition.deposited_at)}</span>
              </div>
              {selectedProtocolPosition.position_type !== 'liquidity_pool' && selectedProtocolPosition.current_quantity != null && (
                <div className="pf-dcond__row">
                  <span className="pf-dcond__row-label">Текущее количество</span>
                  <span className="pf-dcond__row-value">{formatNumericAmount(selectedProtocolPosition.current_quantity, 8)} {selectedProtocolPosition.asset_symbol}</span>
                </div>
              )}
              {selectedProtocolPosition.position_type !== 'liquidity_pool' && selectedProtocolPosition.rewards_claimed_in_base > 0 && (
                <div className="pf-dcond__row">
                  <span className="pf-dcond__row-label">Полученные награды</span>
                  <span className="pf-dcond__row-value">{formatAmount(selectedProtocolPosition.rewards_claimed_in_base, user.base_currency_code)}</span>
                </div>
              )}
              {selectedProtocolPosition.position_type !== 'liquidity_pool' && selectedProtocolPosition.rewards_unclaimed_in_base > 0 && (
                <div className="pf-dcond__row">
                  <span className="pf-dcond__row-label">Награды к получению</span>
                  <span className="pf-dcond__row-value">{formatAmount(selectedProtocolPosition.rewards_unclaimed_in_base, user.base_currency_code)}</span>
                </div>
              )}
              {selectedProtocolPosition.metadata?.source_position_id ? (
                <div className="pf-dcond__row">
                  <span className="pf-dcond__row-label">Источник</span>
                  <span className="pf-dcond__row-value">{(selectedProtocolPosition.metadata.source_asset_symbol as string | undefined) ?? selectedProtocolPosition.asset_symbol}</span>
                </div>
              ) : null}
              {selectedProtocolPosition.position_type === 'lending' && (() => {
                const lend = getLendingMetadata(selectedProtocolPosition);
                return (
                  <>
                    {lend.collateral_asset && (
                      <div className="pf-dcond__row">
                        <span className="pf-dcond__row-label">Залог</span>
                        <span className="pf-dcond__row-value">{lend.collateral_quantity != null ? `${formatNumericAmount(lend.collateral_quantity, 8)} ` : ''}{lend.collateral_asset}</span>
                      </div>
                    )}
                    {lend.borrowed_asset && (
                      <div className="pf-dcond__row">
                        <span className="pf-dcond__row-label">Заём</span>
                        <span className="pf-dcond__row-value">{lend.borrowed_quantity != null ? `${formatNumericAmount(lend.borrowed_quantity, 8)} ` : ''}{lend.borrowed_asset}</span>
                      </div>
                    )}
                  </>
                );
              })()}
              {selectedProtocolPosition.position_type === 'liquidity_pool' && (() => {
                const lp = getLiquidityPoolMetadata(selectedProtocolPosition);
                return (
                  <>
                    {lp.pool_name && (
                      <div className="pf-dcond__row">
                        <span className="pf-dcond__row-label">Пул</span>
                        <span className="pf-dcond__row-value">{lp.pool_name}</span>
                      </div>
                    )}
                    {lp.lp_token_symbol && (
                      <div className="pf-dcond__row">
                        <span className="pf-dcond__row-label">LP-токен</span>
                        <span className="pf-dcond__row-value">{lp.lp_token_symbol}</span>
                      </div>
                    )}
                  </>
                );
              })()}
              {selectedProtocolPosition.comment && !selectedProtocolPosition.comment_is_system ? (
                <div className="pf-dcond__row pf-dcond__row--comment">
                  <span className="pf-dcond__row-label">Комментарий</span>
                  <span className="pf-dcond__row-value pf-dcond__row-value--text">{selectedProtocolPosition.comment}</span>
                </div>
              ) : null}
            </div>

            {selectedProtocolPosition.status === 'open' && selectedProtocolPosition.position_type === 'liquidity_pool' && (
              <>
                <div className="cat-actions cat-actions--crypto" role="group" aria-label="Действия с позицией">
                  <button className="cat-act cat-act--primary" type="button" onClick={() => setLpSheet({ kind: 'add', positionId: selectedProtocolPosition.id })}>
                    <span className="cat-act__ico"><Plus strokeWidth={2.2} /></span>
                    <span className="cat-act__label">Добавить</span>
                  </button>
                  <button className="cat-act" type="button" onClick={() => setLpSheet({ kind: 'reward', positionId: selectedProtocolPosition.id })}>
                    <span className="cat-act__ico"><Gift strokeWidth={2} /></span>
                    <span className="cat-act__label">Награда</span>
                  </button>
                  <button className="cat-act" type="button" onClick={() => setLpSheet({ kind: 'partial', positionId: selectedProtocolPosition.id })}>
                    <span className="cat-act__ico"><ArrowUpFromLine strokeWidth={2} /></span>
                    <span className="cat-act__label">Снять</span>
                  </button>
                  <button className="cat-act" type="button" onClick={() => setLpSheet({ kind: 'snapshot', positionId: selectedProtocolPosition.id })}>
                    <span className="cat-act__ico"><RefreshCw strokeWidth={2} /></span>
                    <span className="cat-act__label">Состав</span>
                  </button>
                </div>
                <div className="pf-sheet-actions">
                  <button className="btn btn--ghost" type="button" onClick={() => setLpSheet({ kind: 'close', positionId: selectedProtocolPosition.id })}>
                    Закрыть позицию
                  </button>
                </div>
              </>
            )}

            {selectedProtocolPosition.status === 'open' && selectedProtocolPosition.position_type !== 'liquidity_pool' && (() => {
              const isLending = selectedProtocolPosition.position_type === 'lending';
              const debtPosition = selectedLendingGroup.find((item) => (getLendingMetadata(item).borrowed_quantity ?? 0) > 0) ?? selectedProtocolPosition;
              const hasDebt = (getLendingMetadata(debtPosition).borrowed_quantity ?? 0) > 0;
              const openLendingSheet = (kind: 'top_up' | 'take_debt' | 'repay_debt' | 'adjust' | 'partial' | 'close' | 'interest' | 'liquidate' | 'yield' | 'group') => {
                setSelectedProtocolPositionId(null);
                setLendingSheet({ kind, positionId: kind === 'take_debt' || kind === 'repay_debt' || kind === 'interest' || kind === 'liquidate' ? debtPosition.id : selectedProtocolPosition.id });
              };
              if (isLending) {
                return (
                  <>
                    <div className="pf-act-group">
                      <span className="sec-tag">Залог</span>
                      <div className="cat-actions pf-act-group__tiles" role="group" aria-label="Залог">
                        <button className="cat-act cat-act--primary" type="button" onClick={() => openLendingSheet('yield')}>
                          <span className="cat-act__ico"><TrendingUp strokeWidth={2.2} /></span>
                          <span className="cat-act__label">Доход</span>
                        </button>
                        <button className="cat-act" type="button" onClick={() => openLendingSheet('top_up')}>
                          <span className="cat-act__ico"><Plus strokeWidth={2} /></span>
                          <span className="cat-act__label">Добавить</span>
                        </button>
                        <button className="cat-act" type="button" onClick={() => openLendingSheet('partial')}>
                          <span className="cat-act__ico"><ArrowUpFromLine strokeWidth={2} /></span>
                          <span className="cat-act__label">Снять</span>
                        </button>
                      </div>
                    </div>
                    <div className="pf-act-group">
                      <span className="sec-tag">Долг</span>
                      <div className="cat-actions pf-act-group__tiles" role="group" aria-label="Долг">
                        <button className="cat-act" type="button" onClick={() => openLendingSheet('take_debt')}>
                          <span className="cat-act__ico"><HandCoins strokeWidth={2} /></span>
                          <span className="cat-act__label">{hasDebt ? 'Занять ещё' : 'Занять'}</span>
                        </button>
                        {hasDebt && (
                          <button className="cat-act" type="button" onClick={() => openLendingSheet('repay_debt')}>
                            <span className="cat-act__ico"><ArrowDownToLine strokeWidth={2} /></span>
                            <span className="cat-act__label">Погасить</span>
                          </button>
                        )}
                        {hasDebt && (
                          <button className="cat-act" type="button" onClick={() => openLendingSheet('interest')}>
                            <span className="cat-act__ico"><Percent strokeWidth={2} /></span>
                            <span className="cat-act__label">Проценты</span>
                          </button>
                        )}
                      </div>
                    </div>
                    <div className="pf-sheet-actions">
                      {hasDebt && (
                        <button className="btn btn--ghost" type="button" onClick={() => openLendingSheet('liquidate')}>
                          <Zap size={15} strokeWidth={2} /> Учесть ликвидацию
                        </button>
                      )}
                      <button className="btn btn--ghost" type="button" onClick={() => openLendingSheet('group')}>
                        <Link2 size={15} strokeWidth={2} /> Общий счёт протокола
                      </button>
                      <button className="btn btn--ghost" type="button" disabled={hasDebt} title={hasDebt ? 'Сначала погаси долг' : undefined} onClick={() => openLendingSheet('close')}>
                        <X size={15} strokeWidth={2} /> Закрыть лендинг
                      </button>
                    </div>
                  </>
                );
              }
              return (
                <div className="cat-actions cat-actions--crypto" role="group" aria-label="Действия с позицией">
                  <button className="cat-act cat-act--primary" type="button" onClick={() => openLendingSheet('yield')}>
                    <span className="cat-act__ico"><Plus strokeWidth={2.2} /></span>
                    <span className="cat-act__label">Начислить</span>
                  </button>
                  <button className="cat-act" type="button" onClick={() => {
                    setSelectedProtocolPositionId(null);
                    setPartialCloseProtocolId(selectedProtocolPosition.id);
                  }}>
                    <span className="cat-act__ico"><ArrowUpFromLine strokeWidth={2} /></span>
                    <span className="cat-act__label">Снять</span>
                  </button>
                  <button className="cat-act" type="button" onClick={() => handleOpenStakingCloseForm(selectedProtocolPosition)}>
                    <span className="cat-act__ico"><ArrowDownToLine strokeWidth={2} /></span>
                    <span className="cat-act__label">Вывести всё</span>
                  </button>
                </div>
              );
            })()}

            {stakingUpdateDrafts[selectedProtocolPosition.id] && (
              <form className="pf-pos-form" onSubmit={(event) => void handleSubmitStakingUpdate(selectedProtocolPosition, event)}>
                <div className="apf-field">
                  <label className="apf-label">Текущее количество</label>
                  <input
                    className="apf-input"
                    type="text"
                    inputMode="decimal"
                    value={stakingUpdateDrafts[selectedProtocolPosition.id].currentQuantity}
                    onChange={(event) => handleStakingUpdateDraftChange(selectedProtocolPosition.id, { currentQuantity: sanitizeDecimalInput(event.target.value) })}
                    disabled={submittingStakingUpdateId === selectedProtocolPosition.id}
                  />
                </div>
                <div className="apf-row">
                  <div className="apf-field" style={{ flex: 1 }}>
                    <label className="apf-label">Полученные награды</label>
                    <input
                      className="apf-input"
                      type="text"
                      inputMode="decimal"
                      value={stakingUpdateDrafts[selectedProtocolPosition.id].rewardsClaimedInBase}
                      onChange={(event) => handleStakingUpdateDraftChange(selectedProtocolPosition.id, { rewardsClaimedInBase: sanitizeDecimalInput(event.target.value) })}
                      disabled={submittingStakingUpdateId === selectedProtocolPosition.id}
                    />
                  </div>
                  <div className="apf-field" style={{ flex: 1 }}>
                    <label className="apf-label">Награды к получению</label>
                    <input
                      className="apf-input"
                      type="text"
                      inputMode="decimal"
                      value={stakingUpdateDrafts[selectedProtocolPosition.id].rewardsUnclaimedInBase}
                      onChange={(event) => handleStakingUpdateDraftChange(selectedProtocolPosition.id, { rewardsUnclaimedInBase: sanitizeDecimalInput(event.target.value) })}
                      disabled={submittingStakingUpdateId === selectedProtocolPosition.id}
                    />
                  </div>
                </div>
                <div className="apf-field">
                  <label className="apf-label">Комментарий</label>
                  <input
                    className="apf-input"
                    type="text"
                    value={stakingUpdateDrafts[selectedProtocolPosition.id].comment}
                    onChange={(event) => handleStakingUpdateDraftChange(selectedProtocolPosition.id, { comment: event.target.value })}
                    disabled={submittingStakingUpdateId === selectedProtocolPosition.id}
                  />
                </div>
                {stakingUpdateError && <p className="pf-new-account-form__error">{stakingUpdateError}</p>}
                <div className="apf-actions">
                  <button className="apf-submit" type="submit" disabled={submittingStakingUpdateId === selectedProtocolPosition.id}>
                    {submittingStakingUpdateId === selectedProtocolPosition.id ? 'Сохраняем…' : 'Сохранить'}
                  </button>
                </div>
              </form>
            )}

            {stakingCloseDrafts[selectedProtocolPosition.id] && (
              <form className="pf-pos-form" onSubmit={(event) => void handleSubmitStakingClose(selectedProtocolPosition, event)}>
                <div className="apf-field">
                  <label className="apf-label">Вернется количество</label>
                  <input
                    className="apf-input"
                    type="text"
                    inputMode="decimal"
                    value={stakingCloseDrafts[selectedProtocolPosition.id].returnQuantity}
                    onChange={(event) => handleStakingCloseDraftChange(selectedProtocolPosition.id, { returnQuantity: sanitizeDecimalInput(event.target.value) })}
                    disabled={submittingStakingCloseId === selectedProtocolPosition.id}
                  />
                </div>
                <div className="apf-field">
                  <label className="apf-label">Дата</label>
                  <input
                    className="apf-input"
                    type="date"
                    value={stakingCloseDrafts[selectedProtocolPosition.id].withdrawnAt}
                    onChange={(event) => handleStakingCloseDraftChange(selectedProtocolPosition.id, { withdrawnAt: event.target.value })}
                    disabled={submittingStakingCloseId === selectedProtocolPosition.id}
                  />
                </div>
                <div className="apf-field">
                  <label className="apf-label">Комментарий</label>
                  <input
                    className="apf-input"
                    type="text"
                    value={stakingCloseDrafts[selectedProtocolPosition.id].comment}
                    onChange={(event) => handleStakingCloseDraftChange(selectedProtocolPosition.id, { comment: event.target.value })}
                    disabled={submittingStakingCloseId === selectedProtocolPosition.id}
                  />
                </div>
                {stakingCloseError && <p className="pf-new-account-form__error">{stakingCloseError}</p>}
                <div className="apf-actions">
                  <button className="apf-submit" type="submit" disabled={submittingStakingCloseId === selectedProtocolPosition.id}>
                    {submittingStakingCloseId === selectedProtocolPosition.id ? 'Выводим…' : 'Подтвердить вывод'}
                  </button>
                </div>
              </form>
            )}
            <CryptoProtocolHistory
              key={`${selectedProtocolPosition.id}:${selectedProtocolPosition.updated_at}`}
              positionId={selectedProtocolPosition.id}
              baseCurrencyCode={user.base_currency_code}
            />
          </div>
        </BottomSheet>
      )}

      {/* ── Add position sheet ── */}
      {(() => {
        const resolvedTypeCode = addSheetTypeCode ?? DEFAULT_PORTFOLIO_ASSET_TYPE_CODES[0];
        const resolvedTypeLabel = assetTypeLabel(resolvedTypeCode);
        const sheetTitle = addSheetTypeCode === 'crypto'
          ? addCryptoMode === 'asset'
            ? 'Новая крипта · Актив'
            : addCryptoMode === 'defi'
              ? 'Новая крипта · DeFi'
              : 'Новая крипта'
          : addSheetTypeCode
            ? `Новая позиция · ${resolvedTypeLabel}`
            : 'Добавить позицию';
        const sheetAccounts = addSheetTypeCode
          ? accounts.filter(({ account }) =>
              !account.investment_asset_type || account.investment_asset_type === addSheetTypeCode,
            )
          : accounts;
        const cryptoSheetAccounts = sheetAccounts.filter(({ account }) => account.investment_asset_type === 'crypto');
        const cryptoSheetSourcePositions = positions.filter((position) => (
          position.status === 'open'
          && position.asset_type_code === 'crypto'
          && position.investment_account_id === stakingCreateAccountId
          && (position.quantity ?? 0) > 0
        ));
        const addSheetIconColor = addSheetTypeCode ? assetTypeIconColor(addSheetTypeCode) : { icon: 'briefcase', color: 'r' };
        const resetAddSheet = () => {
          setAddSheetOpen(false);
          setAddSheetTypeCode(null);
          setAddCryptoMode('pick');
          setStakingCreateAccountId(null);
          setStakingCreateDraft(createInitialStakingCreateDraft());
          setStakingCreateFeeDraft(EMPTY_FEE_DRAFT);
          setStakingCreateError(null);
        };
        return (
          <BottomSheet
            open={addSheetOpen}
            tag="Портфель"
            title={sheetTitle}
            icon={<CategorySvgIcon code={addSheetIconColor.icon} />}
            iconColor={addSheetIconColor.color}
            onClose={resetAddSheet}
          >
            {addSheetTypeCode === null ? (
              <div className="add-pos-types">
                {TYPE_TILES.map((t) => (
                  <button
                    key={t.code}
                    type="button"
                    className="add-pos-type-tile"
                    onClick={() => {
                      setAddSheetTypeCode(t.code);
                      if (t.code === 'crypto') {
                        setAddCryptoMode('pick');
                        setStakingCreateError(null);
                      }
                    }}
                  >
                    <span className={`add-pos-type-tile__icon add-pos-type-tile__icon--${t.tint}`}>{t.icon}</span>
                    <div className="add-pos-type-tile__copy">
                      <span className="add-pos-type-tile__label">{t.label}</span>
                      <span className="add-pos-type-tile__sub">{t.sub}</span>
                    </div>
                    <span className="add-pos-type-tile__chev">›</span>
                  </button>
                ))}
              </div>
            ) : addSheetTypeCode === 'crypto' ? (
              addCryptoMode === 'pick' ? (
                <div className="add-pos-types">
                  <button
                    type="button"
                    className="add-pos-type-tile"
                    onClick={() => setAddCryptoMode('asset')}
                  >
                    <span className="add-pos-type-tile__icon add-pos-type-tile__icon--o"><Coins size={20} strokeWidth={2} /></span>
                    <div className="add-pos-type-tile__copy">
                      <span className="add-pos-type-tile__label">Актив</span>
                      <span className="add-pos-type-tile__sub">Обмен и перевод из банка</span>
                    </div>
                    <span className="add-pos-type-tile__chev">›</span>
                  </button>
                  <button
                    type="button"
                    className="add-pos-type-tile"
                    onClick={() => {
                      setAddCryptoMode('defi');
                      handleOpenStakingCreateSheet(cryptoSheetAccounts.map((item) => item.account.id));
                    }}
                  >
                    <span className="add-pos-type-tile__icon add-pos-type-tile__icon--o"><Package size={20} strokeWidth={2} /></span>
                    <div className="add-pos-type-tile__copy">
                      <span className="add-pos-type-tile__label">DeFi</span>
                      <span className="add-pos-type-tile__sub">Стейкинг, лендинг, ликвидность</span>
                    </div>
                    <span className="add-pos-type-tile__chev">›</span>
                  </button>
                </div>
              ) : addCryptoMode === 'asset' ? (
                <div className="pf-new-account-form apf-body">
                  <p className="list-row__sub" style={{ lineHeight: 1.5 }}>
                    Crypto-актив пока нельзя создать вручную из портфеля. Сначала купи или обменяй крипту в банковом контуре, затем переведи ее на crypto-счёт в инвестициях.
                  </p>
                  <div className="apf-actions">
                    <button type="button" className="apf-cancel" onClick={() => setAddCryptoMode('pick')}>
                      Назад
                    </button>
                    <button type="button" className="apf-submit" onClick={resetAddSheet}>
                      Понятно
                    </button>
                  </div>
                </div>
              ) : (
                <form className="pf-pos-form" onSubmit={(event) => void handleSubmitStakingCreate(stakingCreateAccountId ?? 0, event)}>
                  <div className="apf-field">
                    <label className="apf-label">Счёт</label>
                    <ApfSelect
                      value={stakingCreateAccountId ? String(stakingCreateAccountId) : ''}
                      onChange={(value) => handleOpenStakingCreate(Number(value))}
                      disabled={submittingStakingCreateAccountId !== null}
                      options={[
                        { value: '', label: 'Выбери crypto-счёт' },
                        ...cryptoSheetAccounts.map(({ account }) => ({
                          value: String(account.id),
                          label: `${account.name} · ${account.owner_type === 'family' ? 'семейный' : 'личный'}`,
                        })),
                      ]}
                    />
                  </div>
                  <div className="apf-field">
                    <label className="apf-label">Тип позиции</label>
                    <div className="seg-row" role="tablist">
                      {([
                        { value: 'staking', label: 'Стейкинг' },
                        { value: 'lending', label: 'Лендинг' },
                        { value: 'liquidity_pool', label: 'Ликвидность' },
                      ] as const).map((opt) => (
                        <button
                          key={opt.value}
                          type="button"
                          className={`seg-row__btn${stakingCreateDraft.positionType === opt.value ? ' is-active' : ''}`}
                          onClick={() => setStakingCreateDraft((prev) => ({ ...prev, positionType: opt.value }))}
                          disabled={submittingStakingCreateAccountId !== null}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="apf-field">
                    <label className="apf-label">Протокол</label>
                    <input
                      className="apf-input"
                      type="text"
                      placeholder={
                        stakingCreateDraft.positionType === 'lending' ? 'Aave, EVAA, JustLend…'
                        : stakingCreateDraft.positionType === 'liquidity_pool' ? 'STON.fi, DeDust, Uniswap…'
                        : 'Tonstakers, Hipo…'
                      }
                      value={stakingCreateDraft.protocolName}
                      onChange={(event) => setStakingCreateDraft((prev) => ({ ...prev, protocolName: event.target.value }))}
                      disabled={submittingStakingCreateAccountId !== null}
                    />
                  </div>

                  {stakingCreateDraft.positionType === 'liquidity_pool' && (
                    <div className="apf-field">
                      <label className="apf-label">Имя пула</label>
                      <input
                        className="apf-input"
                        type="text"
                        placeholder="Например: GRAM/USDT"
                        value={stakingCreateDraft.poolName}
                        onChange={(event) => setStakingCreateDraft((prev) => ({ ...prev, poolName: event.target.value }))}
                        disabled={submittingStakingCreateAccountId !== null}
                      />
                    </div>
                  )}

                  {stakingCreateAccountId && cryptoSheetSourcePositions.length === 0 && (
                    <p className="list-row__sub" style={{ marginTop: -4, marginBottom: 4 }}>
                      На выбранном crypto-счёте пока нет активов, которые можно отправить в DeFi.
                    </p>
                  )}

                  {(() => {
                    const selectedA = cryptoSheetSourcePositions.find((p) => String(p.id) === stakingCreateDraft.sourcePositionId);
                    const symbolA = selectedA ? (getPositionMetadataText(selectedA, 'asset_symbol') ?? selectedA.title) : '';
                    const availableA = selectedA?.quantity ?? 0;
                    const tokenALabel = stakingCreateDraft.positionType === 'lending'
                      ? 'Сумма поставки'
                      : stakingCreateDraft.positionType === 'liquidity_pool'
                        ? 'Token A'
                        : 'Актив';
                    return (
                      <div className="apf-field">
                        <label className="apf-label">{tokenALabel}</label>
                        <div className="tok-row">
                          <div className="tok-row__pick">
                            <ApfSelect
                              value={stakingCreateDraft.sourcePositionId}
                              onChange={(value) => setStakingCreateDraft((prev) => ({
                                ...prev,
                                sourcePositionId: value,
                                pairSourcePositionId: prev.pairSourcePositionId === value ? '' : prev.pairSourcePositionId,
                              }))}
                              disabled={submittingStakingCreateAccountId !== null || !stakingCreateAccountId || cryptoSheetSourcePositions.length === 0}
                              options={[
                                { value: '', label: cryptoSheetSourcePositions.length > 0 ? 'Актив' : 'Нет активов' },
                                ...cryptoSheetSourcePositions.map((position) => ({
                                  value: String(position.id),
                                  label: getPositionMetadataText(position, 'asset_symbol') ?? position.title,
                                })),
                              ]}
                            />
                          </div>
                          <input
                            className="apf-input tok-row__amt"
                            type="text"
                            inputMode="decimal"
                            placeholder="0"
                            value={stakingCreateDraft.quantity}
                            onChange={(event) => setStakingCreateDraft((prev) => ({ ...prev, quantity: sanitizeDecimalInput(event.target.value) }))}
                            disabled={submittingStakingCreateAccountId !== null || !selectedA}
                          />
                        </div>
                        {selectedA && (
                          <span className="tok-row__hint">Доступно: {formatNumericAmount(availableA, 8)} {symbolA}</span>
                        )}
                      </div>
                    );
                  })()}

                  {stakingCreateDraft.positionType === 'liquidity_pool' && (() => {
                    const pairCandidates = cryptoSheetSourcePositions.filter((p) => String(p.id) !== stakingCreateDraft.sourcePositionId);
                    const selectedB = pairCandidates.find((p) => String(p.id) === stakingCreateDraft.pairSourcePositionId);
                    const symbolB = selectedB ? (getPositionMetadataText(selectedB, 'asset_symbol') ?? selectedB.title) : '';
                    const availableB = selectedB?.quantity ?? 0;
                    return (
                      <div className="apf-field">
                        <label className="apf-label">Token B</label>
                        <div className="tok-row">
                          <div className="tok-row__pick">
                            <ApfSelect
                              value={stakingCreateDraft.pairSourcePositionId}
                              onChange={(value) => setStakingCreateDraft((prev) => ({ ...prev, pairSourcePositionId: value }))}
                              disabled={submittingStakingCreateAccountId !== null || pairCandidates.length === 0}
                              options={[
                                { value: '', label: pairCandidates.length > 0 ? 'Актив' : 'Нет других активов' },
                                ...pairCandidates.map((position) => ({
                                  value: String(position.id),
                                  label: getPositionMetadataText(position, 'asset_symbol') ?? position.title,
                                })),
                              ]}
                            />
                          </div>
                          <input
                            className="apf-input tok-row__amt"
                            type="text"
                            inputMode="decimal"
                            placeholder="0"
                            value={stakingCreateDraft.pairQuantity}
                            onChange={(event) => setStakingCreateDraft((prev) => ({ ...prev, pairQuantity: sanitizeDecimalInput(event.target.value) }))}
                            disabled={submittingStakingCreateAccountId !== null || !selectedB}
                          />
                        </div>
                        {selectedB ? (
                          <span className="tok-row__hint">Доступно: {formatNumericAmount(availableB, 8)} {symbolB}</span>
                        ) : pairCandidates.length === 0 && stakingCreateAccountId ? (
                          <span className="tok-row__hint tok-row__hint--muted">На этом счёте только один актив — нужно минимум два для пула</span>
                        ) : null}
                      </div>
                    );
                  })()}

                  {stakingCreateDraft.positionType === 'lending' && (() => {
                    const sortedAssets = [...cryptoAssets].sort((a, b) => a.symbol.localeCompare(b.symbol));
                    const selectedBorrowAsset = sortedAssets.find((asset) => String(asset.id) === stakingCreateDraft.borrowedCryptoAssetId);
                    const borrowQtyNum = Number(stakingCreateDraft.borrowedQuantity);
                    const livePrice = selectedBorrowAsset
                      ? cryptoLivePrices.get(selectedBorrowAsset.id)?.price ?? null
                      : null;
                    const borrowValueHint = (selectedBorrowAsset && Number.isFinite(borrowQtyNum) && borrowQtyNum > 0 && livePrice && livePrice > 0)
                      ? `${formatNumericAmount(livePrice * borrowQtyNum, 2)} ${currencySymbol(user.base_currency_code)}`
                      : null;
                    return (
                      <>
                        <div className="apf-field">
                          <label className="apf-label">Заём (опционально)</label>
                          <div className="tok-row">
                            <div className="tok-row__pick">
                              <ApfSelect
                                value={stakingCreateDraft.borrowedCryptoAssetId}
                                onChange={(value) => setStakingCreateDraft((prev) => ({ ...prev, borrowedCryptoAssetId: value }))}
                                disabled={submittingStakingCreateAccountId !== null}
                                options={[
                                  { value: '', label: 'Без заёма' },
                                  ...sortedAssets.map((asset) => ({
                                    value: String(asset.id),
                                    label: cryptoAssetLabel(asset, sortedAssets),
                                  })),
                                ]}
                              />
                            </div>
                            <input
                              className="apf-input tok-row__amt"
                              type="text"
                              inputMode="decimal"
                              placeholder="0"
                              value={stakingCreateDraft.borrowedQuantity}
                              onChange={(event) => setStakingCreateDraft((prev) => ({ ...prev, borrowedQuantity: sanitizeDecimalInput(event.target.value) }))}
                              disabled={submittingStakingCreateAccountId !== null || !selectedBorrowAsset}
                            />
                          </div>
                          {borrowValueHint ? (
                            <span className="tok-row__hint">{borrowValueHint}</span>
                          ) : selectedBorrowAsset ? (
                            <span className="tok-row__hint tok-row__hint--muted">Заёмные монеты появятся на счёте</span>
                          ) : null}
                        </div>

                        <div className="apf-field">
                          <label className="apf-label">APR, % (опционально)</label>
                          <input
                            className="apf-input"
                            type="text"
                            inputMode="decimal"
                            placeholder="0"
                            value={stakingCreateDraft.apr}
                            onChange={(event) => setStakingCreateDraft((prev) => ({ ...prev, apr: sanitizeDecimalInput(event.target.value) }))}
                            disabled={submittingStakingCreateAccountId !== null}
                          />
                        </div>
                      </>
                    );
                  })()}



                  <div className="apf-field">
                    <label className="apf-label">Дата</label>
                    <input
                      className="apf-input"
                      type="date"
                      value={stakingCreateDraft.depositedAt}
                      onChange={(event) => setStakingCreateDraft((prev) => ({ ...prev, depositedAt: event.target.value }))}
                      disabled={submittingStakingCreateAccountId !== null}
                    />
                  </div>

                  <div className="apf-field">
                    <label className="apf-label">Комментарий</label>
                    <input
                      className="apf-input"
                      type="text"
                      placeholder="Необязательно"
                      value={stakingCreateDraft.comment}
                      onChange={(event) => setStakingCreateDraft((prev) => ({ ...prev, comment: event.target.value }))}
                      disabled={submittingStakingCreateAccountId !== null}
                    />
                  </div>
                  {stakingCreateAccountId != null && (
                    <DefiFeeField
                      accountPositions={positions.filter((p) => p.investment_account_id === stakingCreateAccountId)}
                      value={stakingCreateFeeDraft}
                      onChange={setStakingCreateFeeDraft}
                      disabled={submittingStakingCreateAccountId !== null}
                    />
                  )}
                  {stakingCreateError && <p className="pf-new-account-form__error">{stakingCreateError}</p>}
                  <div className="apf-actions">
                    <button type="button" className="apf-cancel" onClick={() => setAddCryptoMode('pick')} disabled={submittingStakingCreateAccountId !== null}>
                      Назад
                    </button>
                    <button className="apf-submit" type="submit" disabled={submittingStakingCreateAccountId !== null || !stakingCreateAccountId}>
                      {submittingStakingCreateAccountId !== null ? 'Открываем…' : 'Открыть позицию'}
                    </button>
                  </div>
                </form>
              )
            ) : (
              <PortfolioPositionDialog
                accounts={sheetAccounts.length > 0 ? sheetAccounts : accounts}
                currencies={currencies}
                user={user}
                defaultAssetTypeCode={resolvedTypeCode}
                defaultAssetTypeLabel={resolvedTypeLabel}
                bare
                onClose={resetAddSheet}
                onSuccess={() => {
                  resetAddSheet();
                  void loadPortfolio();
                }}
              />
            )}
          </BottomSheet>
        );
      })()}

      {/* ── Hero type sheet ── */}
      {(() => {
        const sheetTab = assetTabs.find((t) => t.code === heroTypeSheetCode);
        const sheetAccounts = heroTypeSheetCode
          ? accounts.filter(({ account }) =>
              !account.investment_asset_type || account.investment_asset_type === heroTypeSheetCode,
            )
          : [];
        const heroIconColor = heroTypeSheetCode ? assetTypeIconColor(heroTypeSheetCode) : { icon: 'chart', color: 'b' };
        return (
          <BottomSheet
            open={heroTypeSheetCode !== null}
            tag="Портфель"
            title={sheetTab?.label ?? ''}
            icon={<CategorySvgIcon code={heroIconColor.icon} />}
            iconColor={heroIconColor.color}
            onClose={() => setHeroTypeSheetCode(null)}
          >
            <div className="pf-sheet-accounts">
              {sheetAccounts.map(({ account, balances }) => {
                const summary = summaryByAccountId[account.id];
                const conn = heroTypeSheetCode === 'security'
                  ? tinkoffConnections.find((c) => c.linked_account_id === account.id)
                  : null;
                const accountOpenPositions = openPositions.filter((position) => (
                  position.investment_account_id === account.id
                  && (!heroTypeSheetCode || position.asset_type_code === heroTypeSheetCode)
                ));
                const isSecuritySheet = heroTypeSheetCode === 'security';
                const cashValueInBase = getAccountCashValue(account.id);
                const estimatedValue = accountOpenPositions.reduce((sum, position) => sum + getPositionScopedValue(position), 0);
                const investedPrincipal = accountOpenPositions.reduce((sum, position) => sum + (
                  isSecuritySheet ? getPositionVisibleInvestedPrincipal(position) : getPositionInvestedPrincipal(position)
                ), 0);
                const nkdValue = accountOpenPositions.reduce((sum, position) => sum + getPositionNkdValue(position), 0);
                const netContributed = Number(summary?.net_contributed_in_base ?? 0);
                const displayIncome = accountOpenPositions.reduce((sum, position) => sum + getPositionDisplayResult(position), 0);
                const accountProtocols = cryptoProtocolPositions.filter((p) => p.investment_account_id === account.id && p.status === 'open' && !isEmptyProtocolPosition(p));
                const protocolValue = knownProtocolValues(accountProtocols.map(getProtocolValuation));
                const currentAccountValue = estimatedValue + cashValueInBase + protocolValue.value;
                const realizedIncome = isSecuritySheet
                  ? currentAccountValue - netContributed - displayIncome
                  : Number(summary?.realized_income_in_base ?? 0);
                return (
                  <div key={account.id} className="pf-sheet-account">
                    <div className="pf-sheet-account__head">
                      <div>
                        <div className="pf-sheet-account__name">{account.name}</div>
                        <div className="pf-sheet-account__meta">
                          {account.owner_type === 'family' ? 'Семейный' : 'Личный'}
                          {account.include_in_statistics === false ? ' · Не входит в общую статистику' : ''}
                          {account.provider_name ? ` · ${account.provider_name}` : ''}
                        </div>
                      </div>
                      {conn && (
                        <button
                          type="button"
                          className="pf-sheet-sync-btn"
                          onClick={() => {
                            setHeroTypeSheetCode(null);
                            setSyncDialogConnection(conn);
                          }}
                        >
                          ↻ Подтянуть
                          {conn.last_synced_at && (
                            <span className="pf-sheet-sync-btn__date">
                              {new Date(conn.last_synced_at).toLocaleDateString('ru')}
                            </span>
                          )}
                        </button>
                      )}
                    </div>
                    <div className="pf-sheet-account__rows">
                      {balances.map((b) => (
                        <div key={b.currency_code} className="pf-sheet-account__row">
                          <span>Кэш {b.currency_code}</span>
                          <strong>{new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(b.amount)} {currencySymbol(b.currency_code)}</strong>
                        </div>
                      ))}
                      {isSecuritySheet && currentAccountValue > 0 && (
                        <div className="pf-sheet-account__row">
                          <span>Сейчас на счёте</span>
                          <strong>{new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(currentAccountValue)} {currencySymbol(user.base_currency_code)}</strong>
                        </div>
                      )}
                      {heroTypeSheetCode === 'crypto' && (
                        <div className="pf-sheet-account__row">
                          <span>Рыночная оценка с DeFi</span>
                          <strong>{formatAmount(currentAccountValue, user.base_currency_code)}</strong>
                        </div>
                      )}
                      {heroTypeSheetCode !== 'crypto' && estimatedValue > 0 && (
                        <div className="pf-sheet-account__row">
                          <span>Оценочная стоимость</span>
                          <strong>{new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(estimatedValue)} {currencySymbol(user.base_currency_code)}</strong>
                        </div>
                      )}
                      {investedPrincipal > 0 && (
                        <div className="pf-sheet-account__row">
                          <span>Вложено</span>
                          <strong>{new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(investedPrincipal)} {currencySymbol(user.base_currency_code)}</strong>
                        </div>
                      )}
                      {isSecuritySheet && nkdValue > 0 && (
                        <div className="pf-sheet-account__row">
                          <span>НКД</span>
                          <strong>+{new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(nkdValue)} {currencySymbol(user.base_currency_code)}</strong>
                        </div>
                      )}
                      {netContributed !== 0 && (
                        <div className="pf-sheet-account__row">
                          <span>Внесено</span>
                          <strong>{netContributed >= 0 ? '' : '−'}{new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(Math.abs(netContributed))} {currencySymbol(user.base_currency_code)}</strong>
                        </div>
                      )}
                      {displayIncome !== 0 && (
                        <div className={`pf-sheet-account__row${displayIncome >= 0 ? ' pf-sheet-account__row--pos' : ' pf-sheet-account__row--neg'}`}>
                          <span>{isSecuritySheet ? 'Доход по открытым' : 'Доход'}</span>
                          <strong>{displayIncome >= 0 ? '+' : ''}{new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(displayIncome)} {currencySymbol(user.base_currency_code)}</strong>
                        </div>
                      )}
                      {realizedIncome !== 0 && (
                        <div className={`pf-sheet-account__row${realizedIncome >= 0 ? ' pf-sheet-account__row--pos' : ' pf-sheet-account__row--neg'}`}>
                          <span>{isSecuritySheet ? 'Получено доходом' : 'Получено доходом'}</span>
                          <strong>{realizedIncome >= 0 ? '+' : ''}{new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(realizedIncome)} {currencySymbol(user.base_currency_code)}</strong>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
              {sheetAccounts.length === 0 && (
                <p className="pf-sheet-empty">Счетов этого типа нет.</p>
              )}
            </div>
          </BottomSheet>
        );
      })()}


      {syncDialogConnection && (
        <TinkoffSyncDialog
          connectionId={syncDialogConnection.id}
          investmentAccountId={syncDialogConnection.linked_account_id ?? 0}
          baseCurrencyCode={user.base_currency_code}
          onClose={() => setSyncDialogConnection(null)}
          onSuccess={() => {
            setSyncDialogConnection(null);
            void loadPortfolio();
          }}
        />
      )}

      {feeRefund && <FeeRefundSheet {...feeRefund} onClose={() => setFeeRefund(null)} onSuccess={() => { setFeeRefund(null); setEventsByPosition({}); void loadPortfolio(); }} />}
      {cryptoAssetSheet && (() => {
        const targetPosition = positions.find((p) =>
          p.status === 'open'
          && p.asset_type_code === 'crypto'
          && p.investment_account_id === cryptoAssetSheet.investmentAccountId
          && getCryptoAssetId(p) === cryptoAssetSheet.cryptoAssetId,
        );
        const otherCryptoAccountsCount = targetPosition
          ? getCryptoInvestmentAccountsForPosition(targetPosition)
              .filter((a) => a.id !== targetPosition.investment_account_id).length
          : 0;
        return (
          <CryptoAssetSheet
            open
            onRefundFee={(entry, symbol) => { if (entry.position_id) { setCryptoAssetSheet(null); setFeeRefund({ eventId: entry.event_id, positionId: entry.position_id, symbol }); } }}
            investmentAccountId={cryptoAssetSheet.investmentAccountId}
            cryptoAssetId={cryptoAssetSheet.cryptoAssetId}
            baseCurrencyCode={user.base_currency_code}
            livePrice={cryptoLivePrices.get(cryptoAssetSheet.cryptoAssetId) ?? null}
            isHidden={cryptoAssetsByAccount.get(cryptoAssetSheet.investmentAccountId)?.find((a) => a.crypto_asset_id === cryptoAssetSheet.cryptoAssetId)?.is_hidden ?? false}
            onChangeHidden={(hidden) => changeWalletAssetVisibility(cryptoAssetSheet.investmentAccountId, cryptoAssetSheet.cryptoAssetId, hidden)}
            onClose={() => setCryptoAssetSheet(null)}
            onOpenWithdraw={targetPosition ? () => {
              setCryptoAssetSheet(null);
              setCryptoWithdrawSheetPosition(targetPosition);
            } : undefined}
            onOpenSwap={targetPosition ? () => {
              setCryptoAssetSheet(null);
              setCryptoSwapSheetPosition(targetPosition);
            } : undefined}
            onOpenTransfer={targetPosition ? () => {
              setCryptoAssetSheet(null);
              setCryptoTransferSheetPosition(targetPosition);
            } : undefined}
            onOpenIncome={targetPosition ? () => {
              setCryptoAssetSheet(null);
              setCryptoIncomeSheetPosition(targetPosition);
            } : undefined}
            canTransferBetweenAccounts={otherCryptoAccountsCount > 0}
          />
        );
      })()}

      {cryptoSwapSheetPosition && (
        <CryptoSwapSheet
          open
          position={cryptoSwapSheetPosition}
          cryptoAssets={cryptoAssets}
          accounts={accounts}
          livePrice={cryptoLivePrices.get(getCryptoAssetId(cryptoSwapSheetPosition) ?? -1) ?? null}
          baseCurrencyCode={user.base_currency_code}
          onClose={() => setCryptoSwapSheetPosition(null)}
          onSuccess={() => {
            setCryptoSwapSheetPosition(null);
            void loadPortfolio();
          }}
        />
      )}

      {cryptoWithdrawSheetPosition && (
        <CryptoWithdrawSheet
          open
          position={cryptoWithdrawSheetPosition}
          cashAccounts={[...cashAccounts, ...accounts.map(({ account }) => account).filter((account) => account.investment_asset_type === 'collectible')]}
          livePrice={cryptoLivePrices.get(getCryptoAssetId(cryptoWithdrawSheetPosition) ?? -1) ?? null}
          baseCurrencyCode={user.base_currency_code}
          defaultBankAccountId={user.bank_account_id}
          onClose={() => setCryptoWithdrawSheetPosition(null)}
          onSuccess={() => {
            setCryptoWithdrawSheetPosition(null);
            void loadPortfolio();
          }}
        />
      )}

      {cryptoTransferSheetPosition && (
        <CryptoTransferSheet
          open
          position={cryptoTransferSheetPosition}
          accounts={accounts}
          onClose={() => setCryptoTransferSheetPosition(null)}
          onSuccess={() => {
            setCryptoTransferSheetPosition(null);
            void loadPortfolio();
          }}
        />
      )}

      {partialCloseProtocolId !== null && (() => {
        const target = cryptoProtocolPositions.find((p) => p.id === partialCloseProtocolId);
        if (!target) return null;
        return (
          <CryptoProtocolPartialCloseSheet
            open
            position={target}
            baseCurrencyCode={user.base_currency_code}
            onClose={() => setPartialCloseProtocolId(null)}
            onSuccess={() => {
              setPartialCloseProtocolId(null);
              void loadPortfolio();
            }}
          />
        );
      })()}

      {lpSheet && (() => {
        const target = cryptoProtocolPositions.find((p) => p.id === lpSheet.positionId);
        if (!target || target.position_type !== 'liquidity_pool') return null;
        const accountPositions = positions.filter((p) => p.investment_account_id === target.investment_account_id);
        const close = () => setLpSheet(null);
        const onSuccess = () => {
          setLpSheet(null);
          void loadPortfolio();
        };
        if (lpSheet.kind === 'add') {
          return <LpAddLiquiditySheet open position={target} accountPositions={accountPositions} onClose={close} onSuccess={onSuccess} />;
        }
        if (lpSheet.kind === 'partial' || lpSheet.kind === 'snapshot' || lpSheet.kind === 'reward') {
          return <LiquidityActionSheet key={`${target.id}:${lpSheet.kind}`} position={target} action={lpSheet.kind === 'partial' ? 'lp_withdraw' : lpSheet.kind === 'snapshot' ? 'lp_snapshot' : 'lp_reward'} assets={cryptoAssets} accountPositions={accountPositions} onClose={close} onSuccess={onSuccess} />;
        }
        if (lpSheet.kind === 'close') {
          return <LpCloseSheet open position={target} accountPositions={accountPositions} onClose={close} onSuccess={onSuccess} />;
        }
        return <LpClaimFeesSheet open position={target} accountPositions={accountPositions} onClose={close} onSuccess={onSuccess} />;
      })()}

      {lendingSheet && (() => {
        const target = cryptoProtocolPositions.find((p) => p.id === lendingSheet.positionId);
        if (!target || (target.position_type !== 'lending' && lendingSheet.kind !== 'yield')) return null;
        const accountPositions = positions.filter((p) => p.investment_account_id === target.investment_account_id);
        const close = () => setLendingSheet(null);
        const onSuccess = () => {
          setLendingSheet(null);
          void loadPortfolio();
        };
        if (lendingSheet.kind === 'group') {
          const candidates = cryptoProtocolPositions.filter((p) => p.id !== target.id && p.status === 'open'
            && p.position_type === 'lending' && p.investment_account_id === target.investment_account_id
            && p.network_code === target.network_code
            && (!target.metadata.lending_account_key || !p.metadata.lending_account_key || p.metadata.lending_account_key === target.metadata.lending_account_key));
          return <LendingGroupSheet open position={target} candidates={candidates} onClose={close} onSuccess={onSuccess} />;
        }
        if (lendingSheet.kind === 'top_up') {
          return <LendingTopUpSheet open position={target} accountPositions={accountPositions} onClose={close} onSuccess={onSuccess} />;
        }
        if (lendingSheet.kind === 'take_debt') {
          return <LendingTakeDebtSheet open position={target} accountPositions={accountPositions} cryptoAssets={cryptoAssets} cryptoLivePrices={cryptoLivePrices} baseCurrencyCode={user.base_currency_code} onClose={close} onSuccess={onSuccess} />;
        }
        if (lendingSheet.kind === 'repay_debt') {
          return <LendingRepayDebtSheet open position={target} accountPositions={accountPositions} cryptoLivePrices={cryptoLivePrices} baseCurrencyCode={user.base_currency_code} onClose={close} onSuccess={onSuccess} />;
        }
        if (lendingSheet.kind === 'interest' || lendingSheet.kind === 'liquidate' || lendingSheet.kind === 'yield') {
          return <LendingDebtEventSheet open position={target} kind={lendingSheet.kind} collateralPositions={cryptoProtocolPositions.filter((p) => p.id === target.id || (p.status === 'open' && p.investment_account_id === target.investment_account_id && p.network_code === target.network_code && !!target.metadata.lending_account_key && p.metadata.lending_account_key === target.metadata.lending_account_key))} onClose={close} onSuccess={onSuccess} />;
        }
        if (lendingSheet.kind === 'adjust') {
          return <LendingAdjustSheet open position={target} onClose={close} onSuccess={onSuccess} />;
        }
        if (lendingSheet.kind === 'partial') {
          return <LendingPartialWithdrawSheet open position={target} accountPositions={accountPositions} onClose={close} onSuccess={onSuccess} />;
        }
        return <LendingCloseSheet open position={target} accountPositions={accountPositions} onClose={close} onSuccess={onSuccess} />;
      })()}

      {cryptoIncomeSheetPosition && (() => {
        const incomeAssetId = getCryptoAssetId(cryptoIncomeSheetPosition);
        const incomeSymbol = getPositionMetadataText(cryptoIncomeSheetPosition, 'asset_symbol')
          ?? cryptoIncomeSheetPosition.title;
        const iconUrl = getCryptoIconUrl(incomeSymbol, cryptoIncomeSheetPosition.metadata);
        return (
          <CryptoIncomeSheet
            open
            positionId={cryptoIncomeSheetPosition.id}
            accountName={cryptoIncomeSheetPosition.investment_account_name}
            symbol={incomeSymbol}
            iconUrl={iconUrl}
            livePrice={incomeAssetId ? cryptoLivePrices.get(incomeAssetId) ?? null : null}
            baseCurrencyCode={user.base_currency_code}
            onClose={() => setCryptoIncomeSheetPosition(null)}
            onSuccess={() => {
              setCryptoIncomeSheetPosition(null);
              void loadPortfolio();
            }}
          />
        );
      })()}

      {showNewAccountModal && (() => {
        const selectedTile = TYPE_TILES.find((t) => t.code === newAccountAssetType);
        const resetAndClose = () => {
          setShowNewAccountModal(false);
          setNewAccountStep('pick');
          setNewAccountName('');
          setNewAccountProvider('');
          setNewAccountAssetType('security');
          setNewAccountOwnerType('user');
          setCreateAccountError(null);
        };
        const newAccIconColor = newAccountStep === 'pick' ? { icon: 'briefcase', color: 'r' } : assetTypeIconColor(newAccountAssetType);
        return (
          <BottomSheet
            open={showNewAccountModal}
            tag="Создать"
            title={newAccountStep === 'pick' ? 'Новый инвестиционный счёт' : `Новый счёт · ${selectedTile?.label ?? ''}`}
            icon={<CategorySvgIcon code={newAccIconColor.icon} />}
            iconColor={newAccIconColor.color}
            onClose={resetAndClose}
          >
            {newAccountStep === 'pick' ? (
              <div className="add-pos-types">
                {TYPE_TILES.map((t) => (
                  <button
                    key={t.code}
                    type="button"
                    className="add-pos-type-tile"
                    onClick={() => { setNewAccountAssetType(t.code); setNewAccountStep('form'); }}
                  >
                    <span className={`add-pos-type-tile__icon add-pos-type-tile__icon--${t.tint}`}>{t.icon}</span>
                    <div className="add-pos-type-tile__copy">
                      <span className="add-pos-type-tile__label">{t.label}</span>
                      <span className="add-pos-type-tile__sub">{t.sub}</span>
                    </div>
                    <span className="add-pos-type-tile__chev">›</span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="pf-new-account-form apf-body">
                <div className="apf-field">
                  <label className="apf-label">Название счёта</label>
                  <input
                    className="apf-input"
                    type="text"
                    placeholder={newAccountAssetType === 'crypto' ? 'Например: Основной кошелёк' : newAccountAssetType === 'collectible' ? 'Например: Подарки и стикеры' : 'Например: ИИС Тинькофф'}
                    value={newAccountName}
                    onChange={(e) => setNewAccountName(e.target.value)}
                    autoFocus
                  />
                </div>
                <div className="apf-field">
                  <label className="apf-label">{newAccountAssetType === 'collectible' ? 'Площадка' : 'Брокер / провайдер'}</label>
                  <input
                    className="apf-input"
                    type="text"
                    placeholder={newAccountAssetType === 'crypto' ? 'Необязательно' : 'Например: Тинькофф Инвестиции'}
                    value={newAccountProvider}
                    onChange={(e) => setNewAccountProvider(e.target.value)}
                  />
                </div>
                <div className="apf-field">
                  <label className="apf-label">Владелец</label>
                  <div className="apf-segtog pf-new-account-form__seg">
                    <button
                      type="button"
                      className={`apf-segtog__opt${newAccountOwnerType === 'user' ? ' apf-segtog__opt--on' : ''}`}
                      onClick={() => setNewAccountOwnerType('user')}
                    >
                      Личный
                    </button>
                    <button
                      type="button"
                      className={`apf-segtog__opt${newAccountOwnerType === 'family' ? ' apf-segtog__opt--on' : ''}`}
                      onClick={() => setNewAccountOwnerType('family')}
                    >
                      Семейный
                    </button>
                  </div>
                </div>
                {createAccountError && (
                  <p className="pf-new-account-form__error">{createAccountError}</p>
                )}
                <div className="apf-actions">
                  <button type="button" className="apf-cancel" onClick={resetAndClose} disabled={creatingAccount}>
                    Отмена
                  </button>
                  <button
                    type="button"
                    className="apf-submit"
                    onClick={() => void handleCreateAccount()}
                    disabled={!newAccountName.trim() || creatingAccount}
                  >
                    {creatingAccount ? 'Создаём…' : 'Создать счёт'}
                  </button>
                </div>
              </div>
            )}
          </BottomSheet>
        );
      })()}
    </>
  );
}
