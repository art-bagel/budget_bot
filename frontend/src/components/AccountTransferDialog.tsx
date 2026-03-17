import { useEffect, useMemo, useState } from 'react';

import { fetchBankAccountSnapshot, fetchBankAccounts, transferBetweenAccounts } from '../api';
import { useModalOpen } from '../hooks/useModalOpen';
import type { BankAccount, DashboardBankBalance } from '../types';
import { formatAmount } from '../utils/format';
import { sanitizeDecimalInput } from '../utils/validation';


interface Props {
  personalAccountId: number;
  familyAccountId?: number | null;
  personalBalances: DashboardBankBalance[];
  familyBalances?: DashboardBankBalance[];
  onClose: () => void;
  onSuccess: () => void;
}


export default function AccountTransferDialog({
  personalAccountId,
  familyAccountId = null,
  personalBalances,
  familyBalances = [],
  onClose,
  onSuccess,
}: Props) {
  useModalOpen();

  const hasFamily = familyAccountId !== null;
  const [mode, setMode] = useState<'between_cash' | 'investment'>(hasFamily ? 'between_cash' : 'investment');
  const [direction, setDirection] = useState<
    'personal_to_family' | 'family_to_personal' | 'cash_to_investment' | 'investment_to_cash'
  >(hasFamily ? 'personal_to_family' : 'cash_to_investment');
  const [cashAccounts, setCashAccounts] = useState<BankAccount[]>([]);
  const [investmentAccounts, setInvestmentAccounts] = useState<BankAccount[]>([]);
  const [balancesByAccountId, setBalancesByAccountId] = useState<Record<number, DashboardBankBalance[]>>({
    [personalAccountId]: personalBalances,
    ...(familyAccountId ? { [familyAccountId]: familyBalances } : {}),
  });
  const [cashAccountId, setCashAccountId] = useState(String(personalAccountId));
  const [investmentAccountId, setInvestmentAccountId] = useState('');
  const [currencyCode, setCurrencyCode] = useState('');
  const [amount, setAmount] = useState('');
  const [comment, setComment] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [loadingAccounts, setLoadingAccounts] = useState(false);
  const [loadingBalances, setLoadingBalances] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const loadInvestmentContext = async () => {
      setLoadingAccounts(true);
      try {
        const [loadedCashAccounts, loadedInvestmentAccounts] = await Promise.all([
          fetchBankAccounts('cash'),
          fetchBankAccounts('investment'),
        ]);

        if (cancelled) {
          return;
        }

        setCashAccounts(loadedCashAccounts);
        setInvestmentAccounts(loadedInvestmentAccounts);

        if (!loadedCashAccounts.some((account) => String(account.id) === cashAccountId) && loadedCashAccounts[0]) {
          setCashAccountId(String(loadedCashAccounts[0].id));
        }

        if (!loadedInvestmentAccounts.some((account) => String(account.id) === investmentAccountId) && loadedInvestmentAccounts[0]) {
          setInvestmentAccountId(String(loadedInvestmentAccounts[0].id));
        }
      } catch (reason: unknown) {
        if (!cancelled) {
          setError(reason instanceof Error ? reason.message : String(reason));
        }
      } finally {
        if (!cancelled) {
          setLoadingAccounts(false);
        }
      }
    };

    void loadInvestmentContext();

    return () => {
      cancelled = true;
    };
  }, [cashAccountId, investmentAccountId]);

  useEffect(() => {
    if (mode !== 'investment') {
      return;
    }

    const idsToLoad = new Set<number>();
    if (cashAccountId) idsToLoad.add(Number(cashAccountId));
    if (investmentAccountId) idsToLoad.add(Number(investmentAccountId));

    const missingIds = [...idsToLoad].filter((id) => balancesByAccountId[id] === undefined);
    if (missingIds.length === 0) {
      return;
    }

    let cancelled = false;
    setLoadingBalances(true);

    Promise.all(missingIds.map(async (accountId) => {
      const balances = await fetchBankAccountSnapshot(accountId);
      return { accountId, balances };
    }))
      .then((results) => {
        if (cancelled) {
          return;
        }

        setBalancesByAccountId((prev) => {
          const next = { ...prev };
          results.forEach(({ accountId, balances }) => {
            next[accountId] = balances;
          });
          return next;
        });
      })
      .catch((reason: unknown) => {
        if (!cancelled) {
          setError(reason instanceof Error ? reason.message : String(reason));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingBalances(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [mode, cashAccountId, investmentAccountId, balancesByAccountId]);

  const fromBalances = useMemo(() => {
    if (mode === 'between_cash') {
      return direction === 'personal_to_family' ? personalBalances : familyBalances;
    }
    return balancesByAccountId[
      direction === 'cash_to_investment' ? Number(cashAccountId) : Number(investmentAccountId)
    ] || [];
  }, [
    mode,
    direction,
    personalBalances,
    familyBalances,
    balancesByAccountId,
    cashAccountId,
    investmentAccountId,
  ]);

  const fromAccountId = mode === 'between_cash'
    ? (direction === 'personal_to_family' ? personalAccountId : Number(familyAccountId))
    : (direction === 'cash_to_investment' ? Number(cashAccountId) : Number(investmentAccountId));
  const toAccountId = mode === 'between_cash'
    ? (direction === 'personal_to_family' ? Number(familyAccountId) : personalAccountId)
    : (direction === 'cash_to_investment' ? Number(investmentAccountId) : Number(cashAccountId));

  const availableCurrencies = fromBalances.filter((b) => b.amount > 0);
  const selectedBalance = fromBalances.find((b) => b.currency_code === currencyCode);
  const amountValue = parseFloat(amount) || 0;
  const exceedsBalance = !!selectedBalance && amountValue > selectedBalance.amount;

  const validationMessage = mode === 'investment' && !investmentAccounts.length
    ? 'Сначала создай инвестиционный счет.'
    : !currencyCode
      ? null
      : availableCurrencies.length === 0
        ? 'На исходном счёте нет средств для перевода.'
        : !selectedBalance || selectedBalance.amount <= 0
          ? 'На исходном счёте нет средств в выбранной валюте.'
          : exceedsBalance
            ? `Недостаточно средств: ${formatAmount(selectedBalance.amount, currencyCode)}`
            : null;

  const canSubmit =
    !submitting
    && !loadingAccounts
    && !loadingBalances
    && fromAccountId > 0
    && toAccountId > 0
    && !!currencyCode
    && amountValue > 0
    && !validationMessage;

  const handleDirectionChange = (
    newDirection: 'personal_to_family' | 'family_to_personal' | 'cash_to_investment' | 'investment_to_cash',
  ) => {
    setDirection(newDirection);
    setCurrencyCode('');
    setAmount('');
    setError(null);
  };

  const handleSubmit = async () => {
    if (!canSubmit) return;

    if (validationMessage) {
      setError(validationMessage);
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      await transferBetweenAccounts({
        from_account_id: fromAccountId,
        to_account_id: toAccountId,
        currency_code: currencyCode,
        amount: amountValue,
        comment: comment.trim() || undefined,
      });
      onSuccess();
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={() => !submitting && onClose()}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="section__header">
            <div>
              <div className="section__eyebrow">Перевод банка</div>
              <h2 className="section__title">Перевод между счетами</h2>
            </div>
          </div>
        </div>

        <div className="modal-body">
          <div className="operations-note">
            Выбери направление, валюту и сумму. Перевод в инвестиции уменьшает бюджет, обратный перевод возвращает деньги в свободный остаток.
          </div>

          <div className="form-row">
            {([
              { key: 'between_cash', label: 'Между cash', disabled: !hasFamily },
              { key: 'investment', label: 'С инвестициями', disabled: false },
            ] as const).map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => {
                  if (item.disabled) return;
                  setMode(item.key);
                  handleDirectionChange(
                    item.key === 'between_cash'
                      ? 'personal_to_family'
                      : 'cash_to_investment',
                  );
                }}
                disabled={submitting || item.disabled}
                style={{
                  flex: 1,
                  padding: '8px 12px',
                  fontSize: '0.9rem',
                  background: mode === item.key ? 'var(--bg-accent)' : 'transparent',
                  color: mode === item.key ? 'var(--text-on-accent)' : 'var(--text-primary)',
                  border: 'none',
                  borderRadius: 8,
                  cursor: item.disabled || submitting ? 'default' : 'pointer',
                  outline: 'none',
                  opacity: item.disabled ? 0.45 : 1,
                }}
              >
                {item.label}
              </button>
            ))}
          </div>

          <div className="form-row">
            {mode === 'between_cash' ? (
              (['personal_to_family', 'family_to_personal'] as const).map((dir) => (
                <button
                  key={dir}
                  type="button"
                  onClick={() => handleDirectionChange(dir)}
                  disabled={submitting}
                  style={{
                    flex: 1,
                    padding: '8px 12px',
                    fontSize: '0.9rem',
                    background: direction === dir ? 'var(--bg-accent)' : 'transparent',
                    color: direction === dir ? 'var(--text-on-accent)' : 'var(--text-primary)',
                    border: 'none',
                    borderRadius: 8,
                    cursor: submitting ? 'default' : 'pointer',
                    outline: 'none',
                  }}
                >
                  {dir === 'personal_to_family' ? 'Личный → Семейный' : 'Семейный → Личный'}
                </button>
              ))
            ) : (
              (['cash_to_investment', 'investment_to_cash'] as const).map((dir) => (
                <button
                  key={dir}
                  type="button"
                  onClick={() => handleDirectionChange(dir)}
                  disabled={submitting}
                  style={{
                    flex: 1,
                    padding: '8px 12px',
                    fontSize: '0.9rem',
                    background: direction === dir ? 'var(--bg-accent)' : 'transparent',
                    color: direction === dir ? 'var(--text-on-accent)' : 'var(--text-primary)',
                    border: 'none',
                    borderRadius: 8,
                    cursor: submitting ? 'default' : 'pointer',
                    outline: 'none',
                  }}
                >
                  {dir === 'cash_to_investment' ? 'Cash → Invest' : 'Invest → Cash'}
                </button>
              ))
            )}
          </div>

          {mode === 'investment' && (
            <>
              <div className="form-row">
                <select
                  className="input"
                  value={cashAccountId}
                  onChange={(e) => {
                    setCashAccountId(e.target.value);
                    setCurrencyCode('');
                    setAmount('');
                  }}
                  disabled={submitting || loadingAccounts || !cashAccounts.length}
                >
                  <option value="">Cash-счет</option>
                  {cashAccounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.owner_type === 'family' ? 'Семейный' : 'Личный'} · {account.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-row">
                <select
                  className="input"
                  value={investmentAccountId}
                  onChange={(e) => {
                    setInvestmentAccountId(e.target.value);
                    setCurrencyCode('');
                    setAmount('');
                  }}
                  disabled={submitting || loadingAccounts || !investmentAccounts.length}
                >
                  <option value="">{loadingAccounts ? 'Загружаем investment-счета...' : 'Инвестиционный счет'}</option>
                  {investmentAccounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.owner_type === 'family' ? 'Семейный' : 'Личный'} · {account.name}
                      {account.provider_name ? ` · ${account.provider_name}` : ''}
                    </option>
                  ))}
                </select>
              </div>
            </>
          )}

          <div className="form-row">
            <select
              className="input"
              value={currencyCode}
              onChange={(e) => { setCurrencyCode(e.target.value); setAmount(''); }}
              disabled={submitting || loadingAccounts || loadingBalances}
            >
              <option value="">{loadingBalances ? 'Загружаем валюты...' : 'Выбери валюту'}</option>
              {availableCurrencies.map((b) => (
                <option key={b.currency_code} value={b.currency_code}>
                  {b.currency_code} · {formatAmount(b.amount, b.currency_code)}
                </option>
              ))}
            </select>
          </div>

          {validationMessage && (
            <p style={{ color: 'var(--tag-out-fg)', fontSize: '0.85rem', marginBottom: 14 }}>
              {validationMessage}
            </p>
          )}

          <div className="form-row">
            <input
              className="input"
              type="text"
              inputMode="decimal"
              placeholder={`Сумма${currencyCode ? ` в ${currencyCode}` : ''}`}
              value={amount}
              onChange={(e) => setAmount(sanitizeDecimalInput(e.target.value))}
              disabled={!currencyCode || submitting || loadingAccounts || loadingBalances}
            />
            {selectedBalance && (
              <button
                className="btn"
                type="button"
                disabled={submitting}
                onClick={() => setAmount(String(selectedBalance.amount))}
              >
                Всё
              </button>
            )}
          </div>

          <div className="form-row">
            <input
              className="input"
              type="text"
              placeholder="Комментарий (необязательно)"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !submitting && handleSubmit()}
              style={{ flex: 1 }}
            />
          </div>

          {error && (
            <p style={{ color: 'var(--tag-out-fg)', fontSize: '0.85rem', marginTop: 4 }}>
              {error}
            </p>
          )}
        </div>

        <div className="modal-actions">
          <div className="action-pill">
            <button className="action-pill__cancel" type="button" onClick={onClose} disabled={submitting}>
              Отмена
            </button>
            <button className="action-pill__confirm" type="button" disabled={!canSubmit} onClick={handleSubmit}>
              {submitting ? '...' : 'Перевести'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
