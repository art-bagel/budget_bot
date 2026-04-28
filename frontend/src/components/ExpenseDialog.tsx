import { useEffect, useState } from 'react';
import BottomSheet from './BottomSheet';

import { fetchBankAccountSnapshot, fetchBankAccounts, fetchCurrencies, recordExpense } from '../api';
import { useModalOpen } from '../hooks/useModalOpen';
import type { BankAccount, Currency, DashboardBankBalance, DashboardBudgetCategory, UserContext } from '../types';
import { formatAmount } from '../utils/format';
import { categoryDisplayName } from '../utils/categoryIcon';
import { sanitizeDecimalInput } from '../utils/validation';


interface Props {
  category: DashboardBudgetCategory;
  user: UserContext;
  familyBankAccountId?: number | null;
  onClose: () => void;
  onSuccess: () => void;
}


export default function ExpenseDialog({ category, user, familyBankAccountId = null, onClose, onSuccess }: Props) {
  useModalOpen();
  const [currencies, setCurrencies] = useState<Currency[]>([]);
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [accountBalances, setAccountBalances] = useState<DashboardBankBalance[]>([]);
  const [balancesByAccountId, setBalancesByAccountId] = useState<Record<number, DashboardBankBalance[]>>({});
  const [amount, setAmount] = useState('');
  const [assetCode, setAssetCode] = useState(`fiat:${user.base_currency_code}`);
  const [comment, setComment] = useState('');
  const [expenseDate, setExpenseDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [selectedAccountId, setSelectedAccountId] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const defaultCashAccountId = category.owner_type === 'family'
    ? familyBankAccountId
    : user.bank_account_id;

  useEffect(() => {
    setSelectedAccountId(defaultCashAccountId);
  }, [defaultCashAccountId]);

  useEffect(() => {
    Promise.all([
      fetchCurrencies(),
      fetchBankAccounts('cash'),
      fetchBankAccounts('credit'),
    ]).then(([loadedCurrencies, cashAccounts, creditAccounts]) => {
      setCurrencies(loadedCurrencies);
      const creditCardAccounts = creditAccounts.filter((a) => a.credit_kind === 'credit_card');
      const ownerAccounts = [...cashAccounts, ...creditCardAccounts].filter((a) =>
        category.owner_type === 'family'
          ? a.owner_type === 'family'
          : a.owner_type === 'user',
      );
      setBankAccounts(ownerAccounts);
      void Promise.all(
        ownerAccounts.map(async (account) => ({
          accountId: account.id,
          balances: await fetchBankAccountSnapshot(account.id).catch(() => [] as DashboardBankBalance[]),
        })),
      ).then((snapshots) => {
        setBalancesByAccountId(
          snapshots.reduce<Record<number, DashboardBankBalance[]>>((acc, item) => {
            acc[item.accountId] = item.balances;
            return acc;
          }, {}),
        );
      });
    }).catch(() => {});
  }, [category.owner_type]);

  useEffect(() => {
    if (selectedAccountId === null) {
      setAccountBalances([]);
      return;
    }
    const cached = balancesByAccountId[selectedAccountId];
    if (cached) {
      setAccountBalances(cached);
      return;
    }
    void fetchBankAccountSnapshot(selectedAccountId)
      .then((items) => setAccountBalances(items))
      .catch(() => setAccountBalances([]));
  }, [balancesByAccountId, selectedAccountId]);

  const cryptoBalances = accountBalances.filter((item) => item.asset_type === 'crypto' && item.crypto_asset_id && item.amount > 0);
  useEffect(() => {
    if (!assetCode.startsWith('crypto:')) return;
    const assetId = Number(assetCode.slice('crypto:'.length));
    if (!cryptoBalances.some((item) => item.crypto_asset_id === assetId)) {
      setAssetCode(`fiat:${user.base_currency_code}`);
    }
  }, [assetCode, cryptoBalances, user.base_currency_code]);
  const selectedAsset = (() => {
    if (assetCode.startsWith('crypto:')) {
      return { type: 'crypto' as const, id: Number(assetCode.slice('crypto:'.length)) };
    }
    return { type: 'fiat' as const, code: assetCode.replace(/^fiat:/, '') || user.base_currency_code };
  })();

  const canSubmit = !submitting && parseFloat(amount) > 0 && selectedAccountId !== null;

  const handleSubmit = async () => {
    if (!canSubmit) return;

    setSubmitting(true);
    setError(null);

    try {
      await recordExpense({
        bank_account_id: selectedAccountId,
        category_id: category.category_id,
        amount: parseFloat(amount),
        currency_code: selectedAsset.type === 'fiat' ? selectedAsset.code : undefined,
        crypto_asset_id: selectedAsset.type === 'crypto' ? selectedAsset.id : undefined,
        comment: comment.trim() || undefined,
        operated_at: expenseDate || undefined,
      });
      onSuccess();
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <BottomSheet open tag="Расход" title="Записать расход" onClose={() => !submitting && onClose()}
      actions={
        <div className="action-pill" style={{ width: '100%' }}>
          <button className="action-pill__cancel" type="button" onClick={onClose} disabled={submitting}>Отмена</button>
          <button className="action-pill__confirm" type="button" disabled={!canSubmit} onClick={handleSubmit}>{submitting ? '...' : 'Списать'}</button>
        </div>
      }
    >
      <div>
          <div className="operations-note">
            Списать из <strong>{categoryDisplayName(category.name)}</strong> ({formatAmount(category.balance, category.currency_code)}).
          </div>

          <div className="form-row">
            <div className="input input--read-only">Категория: {categoryDisplayName(category.name)}</div>
          </div>

          <div className="form-row">
            <select
              className="input"
              value={selectedAccountId ?? ''}
              onChange={(e) => setSelectedAccountId(Number(e.target.value))}
              disabled={submitting}
              style={{ flex: 1 }}
            >
              {bankAccounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}{a.account_kind === 'credit' ? ' · Кредитная карта' : ''}
                  {balancesByAccountId[a.id]?.some((b) => b.asset_type === 'crypto' && b.amount > 0)
                    ? ` · ${balancesByAccountId[a.id].filter((b) => b.asset_type === 'crypto' && b.amount > 0).map((b) => b.symbol ?? b.currency_code).join(', ')}`
                    : ''}
                </option>
              ))}
              {bankAccounts.length === 0 && (
                <option value="">Счёт не найден</option>
              )}
            </select>
          </div>

          <div className="form-row">
            <input
              className="input"
              type="text"
              inputMode="decimal"
              placeholder="Сумма"
              value={amount}
              onChange={(e) => setAmount(sanitizeDecimalInput(e.target.value))}
              autoFocus
            />
            <select
              className="input"
              value={assetCode}
              onChange={(e) => setAssetCode(e.target.value)}
            >
              <optgroup label="Фиат">
                {currencies.map((c) => (
                  <option key={c.code} value={`fiat:${c.code}`}>{c.code}</option>
                ))}
              </optgroup>
              {cryptoBalances.length > 0 && (
                <optgroup label="Крипта">
                  {cryptoBalances.map((b) => (
                    <option key={b.crypto_asset_id} value={`crypto:${b.crypto_asset_id}`}>
                      {b.symbol ?? b.currency_code}{b.network_code ? ` · ${b.network_code}` : ''} · доступно {b.amount}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
          </div>

          <div className="form-row">
            <input
              className="input"
              type="text"
              placeholder="Комментарий (необязательно)"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
              style={{ flex: 1 }}
            />
          </div>

          <div className="form-row">
            <input
              className="input"
              type="date"
              value={expenseDate}
              onChange={(e) => setExpenseDate(e.target.value)}
            />
          </div>

          {error && (
            <p style={{ color: 'var(--tag-out-fg)', fontSize: '0.85rem', marginTop: 4 }}>
              {error}
            </p>
          )}

          {selectedAccountId === null && (
            <p style={{ color: 'var(--tag-out-fg)', fontSize: '0.85rem', marginTop: 4 }}>
              Для этой категории не найден подходящий счет.
            </p>
          )}
        </div>
    </BottomSheet>
  );
}
