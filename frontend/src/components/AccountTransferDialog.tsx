import { useCryptoRequestKey } from '../hooks/useCryptoRequestKey';
import { useEffect, useMemo, useState } from 'react';
import BottomSheet from './BottomSheet';
import { fetchBankAccountSnapshot, fetchBankAccounts, fetchPortfolioPositions, transferBankCrypto, transferBetweenAccounts, transferCryptoToInvestment, transferCryptoFromInvestment, transferCryptoBetweenInvestmentAccounts, repayCreditAccount } from '../api';
import { useModalOpen } from '../hooks/useModalOpen';
import type { BankAccount, DashboardBankBalance, PortfolioPosition } from '../types';
import { currencyName, currencySymbol, formatAmount, formatNumericAmount } from '../utils/format';
import { sanitizeDecimalInput } from '../utils/validation';
import { getCryptoIconUrl } from '../utils/cryptoAssets';
import { getCryptoAssetId, getPositionMetadataText } from '../utils/portfolioPosition';


interface Props {
  personalAccountId: number;
  familyAccountId?: number | null;
  baseCurrencyCode: string;
  personalBalances?: DashboardBankBalance[];
  familyBalances?: DashboardBankBalance[];
  onClose: () => void;
  onSuccess: () => void;
}

type AcctKind = 'cash' | 'investment' | 'credit';
type AssetType = 'fiat' | 'crypto';
type Selection = { accountId: number; assetKey: string };
interface AccountEntry { account: BankAccount; kind: AcctKind }
interface PickerItem {
  account: BankAccount;
  kind: AcctKind;
  assetType: AssetType;
  assetKey: string;
  currency: string;
  cryptoAssetId?: number;
  symbol?: string | null;
  networkCode?: string | null;
  balance: number;
  /** Asset the account does not hold yet: offered only as a target. */
  placeholder?: boolean;
  positionId?: number;
}

const COMPAT: Record<AcctKind, Partial<Record<AcctKind, boolean>>> = {
  cash:       { cash: true, investment: true, credit: true },
  investment: { cash: true, investment: true, credit: true },
  credit:     { cash: true, investment: true },
};
const KIND_ORDER: AcctKind[] = ['cash', 'investment', 'credit'];
const KIND_LABEL: Record<AcctKind, string> = {
  cash: 'Счета и наличные', investment: 'Инвестиции', credit: 'Кредиты',
};
const MODE_LABEL: Partial<Record<string, string>> = {
  'cash>cash':       'Перевод между счетами',
  'cash>investment': 'Пополнение инвестиций',
  'investment>cash': 'Вывод из инвестиций',
  'credit>cash': 'Перевод с кредитного счёта',
  'credit>investment': 'Перевод с кредитного счёта',
  'cash>credit': 'Погашение долга',
  'investment>credit': 'Погашение долга',
  'investment>investment': 'Перевод между инвестиционными счетами',
};

function acctIcoClass(account: BankAccount, kind: AcctKind): string {
  if (kind === 'investment') return 'sheet-ico--b';
  if (kind === 'credit')     return 'sheet-ico--r';
  return account.owner_type === 'family' ? 'sheet-ico--o' : 'sheet-ico--ink';
}

function AcctIcon({ kind }: { kind: AcctKind }) {
  if (kind === 'investment') {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <path d="M5 19V11M10 19V6M15 19v-6M20 19v-9"/>
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3.5" y="6" width="17" height="12" rx="2"/>
      <path d="M3.5 10.5h17M7 15h3"/>
    </svg>
  );
}

function assetKeyOfBalance(balance: DashboardBankBalance): string {
  return balance.asset_type === 'crypto' && balance.crypto_asset_id
    ? `crypto:${balance.crypto_asset_id}`
    : `fiat:${balance.currency_code}`;
}
function assetCode(item: Pick<PickerItem, 'assetType' | 'currency' | 'symbol'>): string {
  return item.assetType === 'crypto' ? (item.symbol ?? item.currency) : item.currency;
}
function assetName(item: Pick<PickerItem, 'assetType' | 'currency' | 'networkCode'>): string {
  return item.assetType === 'crypto' ? (item.networkCode ? `Крипта · ${item.networkCode}` : 'Крипта') : currencyName(item.currency);
}
function formatAssetAmount(amount: number, item: Pick<PickerItem, 'assetType' | 'currency' | 'symbol'>): string {
  return item.assetType === 'crypto'
    ? `${formatNumericAmount(amount, 8)} ${assetCode(item)}`
    : formatAmount(amount, item.currency);
}

function AssetMark({ item }: { item: Pick<PickerItem, 'assetType' | 'currency' | 'symbol'> }) {
  const code = assetCode(item);
  const [imageFailed, setImageFailed] = useState(false);
  const src = item.assetType === 'crypto' && !imageFailed ? getCryptoIconUrl(item.symbol ?? item.currency) : null;

  if (src) {
    return (
      <span className="atx__asset-mark atx__asset-mark--img">
        <img src={src} alt="" loading="lazy" onError={() => setImageFailed(true)} />
      </span>
    );
  }

  return (
    <span className={`atx__asset-mark${item.assetType === 'crypto' ? ' atx__asset-mark--crypto-text' : ''}`}>
      {item.assetType === 'fiat' ? currencySymbol(item.currency) : code.slice(0, 4)}
    </span>
  );
}
function sameOwner(a: BankAccount, b: BankAccount): boolean {
  return a.owner_type === b.owner_type
    && (a.owner_user_id ?? null) === (b.owner_user_id ?? null)
    && (a.owner_family_id ?? null) === (b.owner_family_id ?? null);
}


export default function AccountTransferDialog({
  personalAccountId,
  familyAccountId = null,
  baseCurrencyCode,
  personalBalances,
  familyBalances = [],
  onClose,
  onSuccess,
}: Props) {
  useModalOpen();

  const [allAccounts, setAllAccounts] = useState<AccountEntry[]>([]);
  const [balancesMap, setBalancesMap] = useState<Record<number, DashboardBankBalance[]>>({});
  // Portfolio coins are loaded separately from free fiat / collection balances.
  const [walletPositions, setWalletPositions] = useState<PortfolioPosition[]>([]);
  const [fromSel, setFromSel] = useState<Selection | null>(null);
  const [toSel,   setToSel]   = useState<Selection | null>(null);
  const [openRole, setOpenRole] = useState<'from' | 'to' | null>(null);
  const [amount,   setAmount]  = useState('');
  const [comment,  setComment] = useState('');
  const [paymentKind, setPaymentKind] = useState<'scheduled' | 'early'>('scheduled');
  const [loading,    setLoading]    = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const initialMap: Record<number, DashboardBankBalance[]> = {
      ...(personalBalances ? { [personalAccountId]: personalBalances } : {}),
      ...(familyAccountId ? { [familyAccountId]: familyBalances } : {}),
    };
    const load = async () => {
      setLoading(true);
      try {
        const [cash, invest, credit, positions] = await Promise.all([
          fetchBankAccounts('cash'),
          fetchBankAccounts('investment'),
          fetchBankAccounts('credit'),
          fetchPortfolioPositions('open'),
        ]);
        if (cancelled) return;
        setWalletPositions(positions.filter(p => p.asset_type_code === 'crypto'));
        const entries: AccountEntry[] = [
          ...cash.map(a   => ({ account: a, kind: 'cash'       as AcctKind })),
          ...invest.map(a => ({ account: a, kind: 'investment' as AcctKind })),
          ...credit.map(a => ({ account: a, kind: 'credit'     as AcctKind })),
        ];
        setAllAccounts(entries);
        const toLoad = entries.map(e => e.account.id).filter(id => !(id in initialMap));
        const snaps = toLoad.length
          ? await Promise.all(toLoad.map(async id => ({ id, balances: await fetchBankAccountSnapshot(id) })))
          : [];
        if (cancelled) return;
        setBalancesMap({
          ...initialMap,
          ...Object.fromEntries(snaps.map(({ id, balances }) => [id, balances])),
        });
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const allItems = useMemo<PickerItem[]>(() => {
    const result: PickerItem[] = [];
    for (const { account, kind } of allAccounts) {
      const bals = balancesMap[account.id];
      if (bals === undefined) continue;
      if (bals.length === 0) {
        // A crypto wallet holds coins, not cash: no empty rouble row for it.
        if (account.investment_asset_type !== 'crypto') {
          result.push({ account, kind, assetType: 'fiat', assetKey: `fiat:${baseCurrencyCode}`, currency: baseCurrencyCode, balance: 0 });
        }
      } else {
        for (const b of bals) {
          const isCrypto = b.asset_type === 'crypto' && !!b.crypto_asset_id;
          if (isCrypto && b.amount <= 0) continue;
          result.push({
            account,
            kind,
            assetType: isCrypto ? 'crypto' : 'fiat',
            assetKey: assetKeyOfBalance(b),
            currency: b.currency_code,
            cryptoAssetId: b.crypto_asset_id ?? undefined,
            symbol: b.symbol,
            networkCode: b.network_code,
            balance: b.amount,
          });
        }
      }
    }
    // Wallet coins are positions, not bank balances.
    for (const position of walletPositions) {
      const cryptoAssetId = getCryptoAssetId(position);
      const entry = allAccounts.find(({ account }) => account.id === position.investment_account_id
        && account.investment_asset_type === 'crypto');
      if (!entry || cryptoAssetId === null || Number(position.quantity ?? 0) <= 0) continue;
      result.push({
        ...entry, assetType: 'crypto', assetKey: `crypto:${cryptoAssetId}`, cryptoAssetId,
        currency: getPositionMetadataText(position, 'asset_symbol') ?? position.title,
        symbol: getPositionMetadataText(position, 'asset_symbol') ?? position.title,
        networkCode: getPositionMetadataText(position, 'network_code'),
        balance: Number(position.quantity ?? 0), positionId: position.id,
      });
    }
    const heldItems = [...result];
    for (const { account, kind } of allAccounts) {
      if (kind === 'credit') continue;
      for (const held of heldItems) {
        if (held.assetType === 'crypto') {
          if (kind === 'investment' && !['crypto', 'collectible'].includes(account.investment_asset_type ?? '')) continue;
          if (!(kind === 'cash' && held.kind === 'cash') && !sameOwner(account, held.account)) continue;
        } else if (kind === 'investment' && account.investment_asset_type === 'crypto') continue;
        if (result.some(item => item.account.id === account.id && item.assetKey === held.assetKey)) continue;
        result.push({ ...held, account, kind, balance: 0, positionId: undefined, placeholder: true });
      }
    }
    // Keep each account's rows together; the list renders one header per account.
    const order = new Map(allAccounts.map(({ account }, index) => [account.id, index]));
    return result.sort((a, b) => (order.get(a.account.id) ?? 0) - (order.get(b.account.id) ?? 0));
  }, [allAccounts, balancesMap, baseCurrencyCode, walletPositions]);

  const compatiblePair = (from: PickerItem, to: PickerItem): boolean => {
    if (from.account.id === to.account.id || from.assetKey !== to.assetKey) return false;
    if (from.assetType === 'crypto') {
      const acceptsCoins = (item: PickerItem) => item.kind === 'cash'
        || (item.kind === 'investment' && ['crypto', 'collectible'].includes(item.account.investment_asset_type ?? ''));
      return acceptsCoins(from) && acceptsCoins(to)
        && ((from.kind === 'cash' && to.kind === 'cash') || sameOwner(from.account, to.account));
    }
    if (from.kind === 'credit' && (from.account.credit_kind !== 'credit_card' || from.currency !== baseCurrencyCode)) return false;
    if (to.account.investment_asset_type === 'crypto') return false;
    return !!COMPAT[from.kind]?.[to.kind]
      && (from.kind === 'cash' || to.kind === 'cash' || sameOwner(from.account, to.account));
  };
  const isCompat = (role: 'from' | 'to', item: PickerItem): boolean => {
    const selection = role === 'from' ? toSel : fromSel;
    if (!selection) return true;
    const other = allItems.find(pi => pi.account.id === selection.accountId && pi.assetKey === selection.assetKey);
    return !!other && (role === 'from' ? compatiblePair(item, other) : compatiblePair(other, item));
  };
  const available = (item: PickerItem) => item.kind === 'credit'
    ? Math.max(0, (item.account.credit_limit ?? 0) + item.balance) : item.balance;

  const fromItem = useMemo(() =>
    fromSel ? allItems.find(pi => pi.account.id === fromSel.accountId && pi.assetKey === fromSel.assetKey) ?? null : null,
    [fromSel, allItems]);
  const toItem = useMemo(() =>
    toSel ? allItems.find(pi => pi.account.id === toSel.accountId && pi.assetKey === toSel.assetKey) ?? null : null,
    [toSel, allItems]);

  const canSwap = !!(fromItem && toItem && !toItem.placeholder && available(toItem) > 0
    && compatiblePair(toItem, fromItem));
  const isLoanRepayment = toItem?.kind === 'credit' && toItem.account.credit_kind !== 'credit_card';
  const modeLabel = useMemo(() => {
    if (!fromItem || !toItem) return null;
    return MODE_LABEL[`${fromItem.kind}>${toItem.kind}`] ?? null;
  }, [fromItem, toItem]);
  const amountValue = parseFloat(amount) || 0;
  const exceedsBalance = !!fromItem && amountValue > available(fromItem);
  const canSubmit = !submitting && !loading && !!fromSel && !!toSel && Number.isFinite(amountValue) && amountValue > 0 && !exceedsBalance
    && !!fromItem && !!toItem && compatiblePair(fromItem, toItem);

  const handleSelect = (role: 'from' | 'to', item: PickerItem) => {
    const sel: Selection = { accountId: item.account.id, assetKey: item.assetKey };
    if (role === 'from') {
      setFromSel(sel);
      if (toItem && !compatiblePair(item, toItem)) setToSel(null);
    } else {
      setToSel(sel);
      if (fromItem && !compatiblePair(fromItem, item)) setFromSel(null);
    }
    setOpenRole(null);
    setAmount('');
    setError(null);
  };

  const handleSwap = () => {
    if (!canSwap || !fromSel || !toSel) return;
    setFromSel(toSel); setToSel(fromSel); setAmount('');
  };

  const cryptoRequest = useCryptoRequestKey('bank-crypto-transfer');
  const handleSubmit = async () => {
    if (!canSubmit || !fromSel || !toSel) return;
    setSubmitting(true); setError(null);
    try {
      if (fromItem?.positionId && toItem) {
        const common = { position_id: fromItem.positionId, amount, comment: comment.trim() || undefined };
        if (toItem.account.investment_asset_type === 'crypto') {
          const payload = { ...common, target_investment_account_id: toSel.accountId };
          await transferCryptoBetweenInvestmentAccounts({ ...payload, request_id: cryptoRequest.requestId(payload) });
        } else {
          const payload = { ...common, bank_account_id: toSel.accountId };
          await transferCryptoFromInvestment({ ...payload, request_id: cryptoRequest.requestId(payload) });
        }
        cryptoRequest.completed();
      } else if (isLoanRepayment && fromItem) {
        await repayCreditAccount(toSel.accountId, {
          from_account_id: fromSel.accountId, currency_code: fromItem.currency,
          amount: amountValue, payment_kind: paymentKind, comment: comment.trim() || undefined,
        });
      } else if (fromItem?.assetType === 'crypto' && (toItem?.kind === 'cash' || toItem?.account.investment_asset_type === 'collectible') && fromItem.cryptoAssetId) {
        const payload = {
          from_account_id: fromSel.accountId,
          to_account_id: toSel.accountId,
          crypto_asset_id: fromItem.cryptoAssetId,
          amount,
          comment: comment.trim() || undefined,

          collection_transfer: fromItem.account.investment_asset_type === 'collectible' || toItem?.account.investment_asset_type === 'collectible',
        };
        await transferBankCrypto({ ...payload, request_id: cryptoRequest.requestId(payload) });
        cryptoRequest.completed();
      } else if (fromItem?.assetType === 'crypto' && toItem?.kind === 'investment' && fromItem.cryptoAssetId) {
        const payload = {
          bank_account_id: fromSel.accountId,
          investment_account_id: toSel.accountId,
          crypto_asset_id: fromItem.cryptoAssetId,
          amount,
          title: assetCode(fromItem),
          comment: comment.trim() || undefined,
      };
      await transferCryptoToInvestment({...payload, request_id: cryptoRequest.requestId(payload)});
      cryptoRequest.completed();
      } else {
        await transferBetweenAccounts({
          from_account_id: fromSel.accountId,
          to_account_id:   toSel.accountId,
          currency_code:   fromItem?.currency ?? baseCurrencyCode,
          amount:          amountValue,
          comment:         comment.trim() || undefined,
        });
      }
      onSuccess();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  const renderSlot = (role: 'from' | 'to') => {
    const sel  = role === 'from' ? fromSel  : toSel;
    const item = role === 'from' ? fromItem : toItem;
    if (!sel || !item) {
      return <span className="atx__ph">{role === 'from' ? 'Выберите счёт-источник' : 'Выберите счёт-получатель'}</span>;
    }
    const siblings = allItems.filter(pi => pi.account.id === item.account.id);
    const isMulti  = siblings.length > 1;
    const subLabel = item.kind === 'credit' && role === 'to' ? 'Задолженность' : (role === 'from' ? 'Доступно' : 'Остаток');
    const bal      = (balancesMap[sel.accountId] ?? []).find(b => assetKeyOfBalance(b) === sel.assetKey);
    return (
      <span className="atx__sel">
        <span className={`sheet-ico sheet-ico--sm ${acctIcoClass(item.account, item.kind)}`}>
          <AcctIcon kind={item.kind} />
        </span>
        <span className="atx__sel-text">
          <span className="atx__sel-name">
            {item.account.name}{isMulti && <span className="atx__sel-cur"> · {assetCode(item)}</span>}
          </span>
          <span className="atx__sel-sub">{subLabel}: {formatAssetAmount(role === 'from' ? available(item) : (bal ? bal.amount : item.balance), item)}</span>
        </span>
      </span>
    );
  };

  const renderList = (role: 'from' | 'to') =>
    KIND_ORDER.flatMap(kind => {
      const other = role === 'from' ? toSel : fromSel;
      const items = allItems.filter(pi => pi.kind === kind && (!other || pi.assetKey === other.assetKey) && (role === 'to' || (!pi.placeholder
        && (pi.kind !== 'credit' || (pi.account.credit_kind === 'credit_card' && pi.currency === baseCurrencyCode)))));
      if (!items.length) return [];
      const rows: React.ReactNode[] = [
        <li key={`grp-${kind}`} className="atx__group-label">{KIND_LABEL[kind]}</li>,
      ];
      const seen = new Set<number>();
      for (const item of items) {
        const compat   = isCompat(role, item);
        const selected = role === 'from'
          ? fromSel?.accountId === item.account.id && fromSel?.assetKey === item.assetKey
          : toSel?.accountId   === item.account.id && toSel?.assetKey   === item.assetKey;
        const siblings = items.filter(pi => pi.account.id === item.account.id);
        const isMulti  = siblings.length > 1;
        const subLabel = item.kind === 'credit' ? (role === 'to' ? 'Задолженность' : 'Доступно') : 'Остаток';
        const icoClass = acctIcoClass(item.account, item.kind);
        const key      = `${item.account.id}-${item.assetKey}`;

        if (isMulti && !seen.has(item.account.id)) {
          seen.add(item.account.id);
          rows.push(
            <li key={`head-${item.account.id}`} className="atx__acct-head" aria-hidden="true">
              <span className={`sheet-ico sheet-ico--sm ${icoClass}`} style={{ width: 26, height: 26, borderRadius: 7 }}>
                <AcctIcon kind={item.kind} />
              </span>
              <span>{item.account.name}</span>
            </li>,
          );
        }

        if (isMulti) {
          rows.push(
            <li key={key}>
              <button
                type="button"
                className={`atx__item atx__item--cur${selected ? ' atx__item--selected' : ''}`}
                disabled={!compat}
                onClick={() => compat && handleSelect(role, item)}
              >
                <AssetMark item={item} />
                <span className="atx__item-text">
                  <span className="atx__item-name">{assetName(item)}</span>
                  <span className="atx__item-sub">{subLabel}: {formatAssetAmount(role === 'from' ? available(item) : item.balance, item)}</span>
                </span>
                <span className="atx__item-badge">{!compat ? 'нельзя' : selected ? 'выбран' : ''}</span>
              </button>
            </li>,
          );
        } else {
          if (!seen.has(item.account.id)) seen.add(item.account.id);
          rows.push(
            <li key={key}>
              <button
                type="button"
                className={`atx__item${selected ? ' atx__item--selected' : ''}`}
                disabled={!compat}
                onClick={() => compat && handleSelect(role, item)}
              >
                <span className={`sheet-ico sheet-ico--sm ${icoClass}`}><AcctIcon kind={item.kind} /></span>
                <span className="atx__item-text">
                  <span className="atx__item-name">{item.account.name}</span>
                  <span className="atx__item-sub">{subLabel}: {formatAssetAmount(role === 'from' ? available(item) : item.balance, item)}</span>
                </span>
                <span className="atx__item-badge">
                  {!compat ? 'нельзя' : selected ? 'выбран' : assetCode(item)}
                </span>
              </button>
            </li>,
          );
        }
      }
      return rows;
    });

  return (
    <BottomSheet
      open
      tag="Банк"
      title="Перевод между счетами"
      icon={
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M7 8h12l-3-3M17 16H5l3 3"/>
        </svg>
      }
      iconColor="b"
      onClose={() => !submitting && onClose()}
      actions={<>
        <button className="sh-btn sh-btn--ghost" type="button" onClick={onClose} disabled={submitting}>Отмена</button>
        <button className="sh-btn sh-btn--primary" type="button" disabled={!canSubmit} onClick={handleSubmit} style={{ flex: 2 }}>
          {submitting ? '…' : 'Перевести'}
        </button>
      </>}
    >
      {loading ? (
        <p style={{ color: 'var(--text-3)', textAlign: 'center', padding: '24px 0' }}>Загружаем счета…</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {/* FROM / TO accordion */}
          <div className="atx">
            {(['from', 'to'] as const).map((role, idx) => (
              <>
                {idx === 1 && (
                  <div key="conn" className="atx__conn">
                    <button
                      className="atx__swap"
                      type="button"
                      disabled={!canSwap}
                      aria-label="Поменять местами"
                      onClick={handleSwap}
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M7 8h12l-3-3M17 16H5l3 3"/>
                      </svg>
                    </button>
                  </div>
                )}
                <div key={role} className={`atx__block${openRole === role ? ' atx__block--open' : ''}`}>
                  <button
                    className="atx__trigger"
                    type="button"
                    onClick={() => setOpenRole(openRole === role ? null : role)}
                  >
                    <span className="atx__tag">{role === 'from' ? 'Откуда' : 'Куда'}</span>
                    <div className="atx__val">{renderSlot(role)}</div>
                    <svg className="atx__chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="m10 6 6 6-6 6"/>
                    </svg>
                  </button>
                  <div className="atx__drawer">
                    <div className="atx__drawer-inner">
                      <ul className="atx__list">{renderList(role)}</ul>
                    </div>
                  </div>
                </div>
              </>
            ))}
          </div>

          {/* Mode hint */}
          {modeLabel && (
            <div className="atx__mode">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M7 8h12l-3-3M17 16H5l3 3"/>
              </svg>
              {modeLabel}
            </div>
          )}

          {/* Amount */}
          <div className="field">
            <span className="fl">Сумма</span>
            <div className="amt">
              <input
                className="amt__inp"
                type="text"
                inputMode="decimal"
                placeholder="0"
                value={amount}
                onChange={e => setAmount(sanitizeDecimalInput(e.target.value))}
                disabled={!fromSel || !toSel || submitting}
              />
              <span className="amt__cur">{fromItem ? assetCode(fromItem) : '₽'}</span>
            </div>
            {exceedsBalance && fromItem && (
              <span className="atx__err">Недостаточно: {formatAssetAmount(available(fromItem), fromItem)}</span>
            )}
          </div>

          {isLoanRepayment && (
            <div className="field">
              <span className="fl">Платёж по кредиту</span>
              <select className="picker-v2" value={paymentKind}
                onChange={e => setPaymentKind(e.target.value as 'scheduled' | 'early')} disabled={submitting}>
                <option value="scheduled">Плановый</option>
                <option value="early">Досрочный</option>
              </select>
            </div>
          )}

          {/* Comment */}
          <div className="field">
            <span className="fl">Комментарий</span>
            <input
              className="inp-v2"
              type="text"
              placeholder="Необязательно"
              value={comment}
              onChange={e => setComment(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && !submitting && void handleSubmit()}
            />
          </div>

          {error && <p className="dlg-error">{error}</p>}
        </div>
      )}
    </BottomSheet>
  );
}
