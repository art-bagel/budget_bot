import { useEffect, useMemo, useState } from 'react';
import BottomSheet from './BottomSheet';
import { fetchBankAccountSnapshot, fetchBankAccounts, transferBetweenAccounts, transferCryptoToInvestment } from '../api';
import { useModalOpen } from '../hooks/useModalOpen';
import type { BankAccount, DashboardBankBalance } from '../types';
import { formatAmount, formatNumericAmount } from '../utils/format';
import { sanitizeDecimalInput } from '../utils/validation';
import { getCryptoIconUrl } from '../utils/cryptoAssets';


interface Props {
  personalAccountId: number;
  familyAccountId?: number | null;
  baseCurrencyCode: string;
  personalBalances: DashboardBankBalance[];
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
}

const COMPAT: Record<AcctKind, Partial<Record<AcctKind, boolean>>> = {
  cash:       { cash: true, investment: true },
  investment: { cash: true },
  credit:     { cash: true },
};
const KIND_ORDER: AcctKind[] = ['cash', 'investment', 'credit'];
const KIND_LABEL: Record<AcctKind, string> = {
  cash: 'Счета и наличные', investment: 'Инвестиции', credit: 'Кредиты',
};
const MODE_LABEL: Partial<Record<string, string>> = {
  'cash>cash':       'Перевод между счетами',
  'cash>investment': 'Пополнение инвестиций',
  'investment>cash': 'Вывод из инвестиций',
  'credit>cash':     'Погашение долга',
};
const CUR_SYM: Record<string, string>  = { RUB: '₽', USD: '$', EUR: '€' };
const CUR_NAME: Record<string, string> = { RUB: 'Рубли', USD: 'Доллары', EUR: 'Евро' };

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

function curSym(code: string)  { return CUR_SYM[code]  ?? code; }
function curName(code: string) { return CUR_NAME[code] ?? code; }
function assetKeyOfBalance(balance: DashboardBankBalance): string {
  return balance.asset_type === 'crypto' && balance.crypto_asset_id
    ? `crypto:${balance.crypto_asset_id}`
    : `fiat:${balance.currency_code}`;
}
function assetCode(item: Pick<PickerItem, 'assetType' | 'currency' | 'symbol'>): string {
  return item.assetType === 'crypto' ? (item.symbol ?? item.currency) : item.currency;
}
function assetName(item: Pick<PickerItem, 'assetType' | 'currency' | 'networkCode'>): string {
  return item.assetType === 'crypto' ? (item.networkCode ? `Крипта · ${item.networkCode}` : 'Крипта') : curName(item.currency);
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
      {item.assetType === 'fiat' ? curSym(item.currency) : code.slice(0, 4)}
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
  const [fromSel, setFromSel] = useState<Selection | null>(null);
  const [toSel,   setToSel]   = useState<Selection | null>(null);
  const [openRole, setOpenRole] = useState<'from' | 'to' | null>(null);
  const [amount,   setAmount]  = useState('');
  const [comment,  setComment] = useState('');
  const [loading,    setLoading]    = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const initialMap: Record<number, DashboardBankBalance[]> = {
      [personalAccountId]: personalBalances,
      ...(familyAccountId ? { [familyAccountId]: familyBalances } : {}),
    };
    const load = async () => {
      setLoading(true);
      try {
        const [cash, invest, credit] = await Promise.all([
          fetchBankAccounts('cash'),
          fetchBankAccounts('investment'),
          fetchBankAccounts('credit'),
        ]);
        if (cancelled) return;
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
        result.push({ account, kind, assetType: 'fiat', assetKey: `fiat:${baseCurrencyCode}`, currency: baseCurrencyCode, balance: 0 });
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
    const heldCryptoByOwner = result.filter((item) => item.kind === 'cash' && item.assetType === 'crypto' && item.balance > 0);
    for (const { account, kind } of allAccounts) {
      if (kind !== 'investment' || account.investment_asset_type !== 'crypto') continue;
      for (const crypto of heldCryptoByOwner) {
        if (!sameOwner(account, crypto.account)) continue;
        if (result.some((item) => item.account.id === account.id && item.assetKey === crypto.assetKey)) continue;
        result.push({
          account,
          kind,
          assetType: 'crypto',
          assetKey: crypto.assetKey,
          currency: crypto.currency,
          cryptoAssetId: crypto.cryptoAssetId,
          symbol: crypto.symbol,
          networkCode: crypto.networkCode,
          balance: 0,
        });
      }
    }
    return result;
  }, [allAccounts, balancesMap, baseCurrencyCode]);

  const isCompat = (role: 'from' | 'to', item: PickerItem): boolean => {
    const other = role === 'from' ? toSel : fromSel;
    if (!other) return true;
    if (other.accountId === item.account.id && other.assetKey === item.assetKey) return false;
    if (other.assetKey !== item.assetKey) return false;
    const otherItem = allItems.find(pi => pi.account.id === other.accountId && pi.assetKey === other.assetKey);
    if (!otherItem) return false;
    const fK = role === 'from' ? item.kind : otherItem.kind;
    const tK = role === 'from' ? otherItem.kind : item.kind;
    const fromAccount = role === 'from' ? item.account : otherItem.account;
    const toAccount = role === 'from' ? otherItem.account : item.account;
    const assetType = role === 'from' ? item.assetType : otherItem.assetType;
    if (assetType === 'crypto') {
      return fK === 'cash'
        && tK === 'investment'
        && toAccount.investment_asset_type === 'crypto'
        && sameOwner(fromAccount, toAccount);
    }
    return !!COMPAT[fK]?.[tK];
  };

  const fromItem = useMemo(() =>
    fromSel ? allItems.find(pi => pi.account.id === fromSel.accountId && pi.assetKey === fromSel.assetKey) ?? null : null,
    [fromSel, allItems]);
  const toItem = useMemo(() =>
    toSel ? allItems.find(pi => pi.account.id === toSel.accountId && pi.assetKey === toSel.assetKey) ?? null : null,
    [toSel, allItems]);
  const fromBalance = useMemo(() =>
    fromSel ? (balancesMap[fromSel.accountId] ?? []).find(b => assetKeyOfBalance(b) === fromSel.assetKey) ?? null : null,
    [fromSel, balancesMap]);

  const canSwap = !!(
    fromItem
    && toItem
    && fromItem.assetType === 'fiat'
    && toItem.assetType === 'fiat'
    && COMPAT[toItem.kind]?.[fromItem.kind]
  );
  const modeLabel = useMemo(() => {
    if (!fromItem || !toItem) return null;
    return MODE_LABEL[`${fromItem.kind}>${toItem.kind}`] ?? null;
  }, [fromItem, toItem]);
  const amountValue = parseFloat(amount) || 0;
  const exceedsBalance = fromItem?.kind !== 'credit' && !!fromBalance && amountValue > fromBalance.amount;
  const canSubmit = !submitting && !loading && !!fromSel && !!toSel && amountValue > 0 && !exceedsBalance;

  const handleSelect = (role: 'from' | 'to', item: PickerItem) => {
    const sel: Selection = { accountId: item.account.id, assetKey: item.assetKey };
    if (role === 'from') {
      setFromSel(sel);
      if (toSel && toSel.assetKey !== item.assetKey) setToSel(null);
    } else {
      setToSel(sel);
      if (fromSel && fromSel.assetKey !== item.assetKey) setFromSel(null);
    }
    setOpenRole(null);
    setAmount('');
    setError(null);
  };

  const handleSwap = () => {
    if (!canSwap || !fromSel || !toSel) return;
    setFromSel(toSel); setToSel(fromSel); setAmount('');
  };

  const handleSubmit = async () => {
    if (!canSubmit || !fromSel || !toSel) return;
    setSubmitting(true); setError(null);
    try {
      if (fromItem?.assetType === 'crypto' && toItem?.kind === 'investment' && fromItem.cryptoAssetId) {
        await transferCryptoToInvestment({
          bank_account_id: fromSel.accountId,
          investment_account_id: toSel.accountId,
          crypto_asset_id: fromItem.cryptoAssetId,
          amount: amountValue,
          title: assetCode(fromItem),
          comment: comment.trim() || undefined,
        });
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
    const subLabel = item.kind === 'credit' ? 'Задолженность' : (role === 'from' ? 'Доступно' : 'Остаток');
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
          <span className="atx__sel-sub">{subLabel}: {bal ? formatAssetAmount(bal.amount, item) : item.assetType === 'crypto' ? assetName(item) : '—'}</span>
        </span>
      </span>
    );
  };

  const renderList = (role: 'from' | 'to') =>
    KIND_ORDER.flatMap(kind => {
      const items = allItems.filter(pi => pi.kind === kind && (role === 'to' || !(pi.kind === 'investment' && pi.assetType === 'crypto')));
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
        const subLabel = item.kind === 'credit' ? 'Задолженность' : 'Остаток';
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
                  <span className="atx__item-sub">{subLabel}: {formatAssetAmount(item.balance, item)}</span>
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
                  <span className="atx__item-sub">{subLabel}: {formatAssetAmount(item.balance, item)}</span>
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
            {exceedsBalance && fromBalance && (
              <span className="atx__err">Недостаточно: {fromItem ? formatAssetAmount(fromBalance.amount, fromItem) : formatAmount(fromBalance.amount, baseCurrencyCode)}</span>
            )}
          </div>

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
