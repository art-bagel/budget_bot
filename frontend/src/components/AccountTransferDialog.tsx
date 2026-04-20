import { useEffect, useMemo, useState } from 'react';
import BottomSheet from './BottomSheet';
import { fetchBankAccountSnapshot, fetchBankAccounts, transferBetweenAccounts } from '../api';
import { useModalOpen } from '../hooks/useModalOpen';
import type { BankAccount, DashboardBankBalance } from '../types';
import { formatAmount } from '../utils/format';
import { sanitizeDecimalInput } from '../utils/validation';


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
type Selection = { accountId: number; currency: string };
interface AccountEntry { account: BankAccount; kind: AcctKind }
interface PickerItem  { account: BankAccount; kind: AcctKind; currency: string; balance: number }

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
        result.push({ account, kind, currency: baseCurrencyCode, balance: 0 });
      } else {
        for (const b of bals) result.push({ account, kind, currency: b.currency_code, balance: b.amount });
      }
    }
    return result;
  }, [allAccounts, balancesMap, baseCurrencyCode]);

  const isCompat = (role: 'from' | 'to', item: PickerItem): boolean => {
    const other = role === 'from' ? toSel : fromSel;
    if (!other) return true;
    if (other.accountId === item.account.id && other.currency === item.currency) return false;
    if (other.currency !== item.currency) return false;
    const otherItem = allItems.find(pi => pi.account.id === other.accountId && pi.currency === other.currency);
    if (!otherItem) return false;
    const fK = role === 'from' ? item.kind : otherItem.kind;
    const tK = role === 'from' ? otherItem.kind : item.kind;
    return !!COMPAT[fK]?.[tK];
  };

  const fromItem = useMemo(() =>
    fromSel ? allItems.find(pi => pi.account.id === fromSel.accountId && pi.currency === fromSel.currency) ?? null : null,
    [fromSel, allItems]);
  const toItem = useMemo(() =>
    toSel ? allItems.find(pi => pi.account.id === toSel.accountId && pi.currency === toSel.currency) ?? null : null,
    [toSel, allItems]);
  const fromBalance = useMemo(() =>
    fromSel ? (balancesMap[fromSel.accountId] ?? []).find(b => b.currency_code === fromSel.currency) ?? null : null,
    [fromSel, balancesMap]);

  const canSwap = !!(fromItem && toItem && COMPAT[toItem.kind]?.[fromItem.kind]);
  const modeLabel = useMemo(() => {
    if (!fromItem || !toItem) return null;
    return MODE_LABEL[`${fromItem.kind}>${toItem.kind}`] ?? null;
  }, [fromItem, toItem]);

  const amountValue = parseFloat(amount) || 0;
  const exceedsBalance = fromItem?.kind !== 'credit' && !!fromBalance && amountValue > fromBalance.amount;
  const canSubmit = !submitting && !loading && !!fromSel && !!toSel && amountValue > 0 && !exceedsBalance;

  const handleSelect = (role: 'from' | 'to', item: PickerItem) => {
    const sel: Selection = { accountId: item.account.id, currency: item.currency };
    if (role === 'from') {
      setFromSel(sel);
      if (toSel && toSel.currency !== item.currency) setToSel(null);
    } else {
      setToSel(sel);
      if (fromSel && fromSel.currency !== item.currency) setFromSel(null);
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
      await transferBetweenAccounts({
        from_account_id: fromSel.accountId,
        to_account_id:   toSel.accountId,
        currency_code:   fromSel.currency,
        amount:          amountValue,
        comment:         comment.trim() || undefined,
      });
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
    const bal      = (balancesMap[sel.accountId] ?? []).find(b => b.currency_code === sel.currency);
    return (
      <span className="atx__sel">
        <span className={`sheet-ico sheet-ico--sm ${acctIcoClass(item.account, item.kind)}`}>
          <AcctIcon kind={item.kind} />
        </span>
        <span className="atx__sel-text">
          <span className="atx__sel-name">
            {item.account.name}{isMulti && <span className="atx__sel-cur"> · {curSym(sel.currency)}</span>}
          </span>
          <span className="atx__sel-sub">{subLabel}: {bal ? formatAmount(bal.amount, sel.currency) : '—'}</span>
        </span>
      </span>
    );
  };

  const renderList = (role: 'from' | 'to') =>
    KIND_ORDER.flatMap(kind => {
      const items = allItems.filter(pi => pi.kind === kind);
      if (!items.length) return [];
      const rows: React.ReactNode[] = [
        <li key={`grp-${kind}`} className="atx__group-label">{KIND_LABEL[kind]}</li>,
      ];
      const seen = new Set<number>();
      for (const item of items) {
        const compat   = isCompat(role, item);
        const selected = role === 'from'
          ? fromSel?.accountId === item.account.id && fromSel?.currency === item.currency
          : toSel?.accountId   === item.account.id && toSel?.currency   === item.currency;
        const siblings = items.filter(pi => pi.account.id === item.account.id);
        const isMulti  = siblings.length > 1;
        const subLabel = item.kind === 'credit' ? 'Задолженность' : 'Остаток';
        const icoClass = acctIcoClass(item.account, item.kind);
        const key      = `${item.account.id}-${item.currency}`;

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
                <span className="atx__cur-sym">{curSym(item.currency)}</span>
                <span className="atx__item-text">
                  <span className="atx__item-name">{curName(item.currency)}</span>
                  <span className="atx__item-sub">{subLabel}: {formatAmount(item.balance, item.currency)}</span>
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
                  <span className="atx__item-sub">{subLabel}: {formatAmount(item.balance, item.currency)}</span>
                </span>
                <span className="atx__item-badge">
                  {!compat ? 'нельзя' : selected ? 'выбран' : curSym(item.currency)}
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
              <span className="amt__cur">{fromSel ? curSym(fromSel.currency) : '₽'}</span>
            </div>
            {exceedsBalance && fromBalance && (
              <span className="atx__err">Недостаточно: {formatAmount(fromBalance.amount, fromSel!.currency)}</span>
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
