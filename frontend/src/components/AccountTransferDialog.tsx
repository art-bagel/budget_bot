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

type TransferMode = 'between_cash' | 'investment' | 'credit_to_cash';
type TransferDirection =
  | 'personal_to_family'
  | 'family_to_personal'
  | 'cash_to_cash'
  | 'cash_to_investment'
  | 'investment_to_cash'
  | 'credit_to_cash';


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

  const hasFamily = familyAccountId !== null;
  const [mode, setMode] = useState<TransferMode>('between_cash');
  const [direction, setDirection] = useState<TransferDirection>(hasFamily ? 'personal_to_family' : 'cash_to_cash');
  const [cashAccounts, setCashAccounts] = useState<BankAccount[]>([]);
  const [investmentAccounts, setInvestmentAccounts] = useState<BankAccount[]>([]);
  const [creditAccounts, setCreditAccounts] = useState<BankAccount[]>([]);
  const [balancesByAccountId, setBalancesByAccountId] = useState<Record<number, DashboardBankBalance[]>>({
    [personalAccountId]: personalBalances,
    ...(familyAccountId ? { [familyAccountId]: familyBalances } : {}),
  });
  const [cashFromAccountId, setCashFromAccountId] = useState(String(personalAccountId));
  const [cashToAccountId, setCashToAccountId] = useState(familyAccountId ? String(familyAccountId) : '');
  const [cashAccountId, setCashAccountId] = useState(String(personalAccountId));
  const [investmentAccountId, setInvestmentAccountId] = useState('');
  const [creditAccountId, setCreditAccountId] = useState('');
  const [currencyCode, setCurrencyCode] = useState('');
  const [amount, setAmount] = useState('');
  const [comment, setComment] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [loadingAccounts, setLoadingAccounts] = useState(false);
  const [loadingBalances, setLoadingBalances] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const loadAccountContext = async () => {
      setLoadingAccounts(true);
      try {
        const [loadedCashAccounts, loadedInvestmentAccounts, loadedCreditAccounts] = await Promise.all([
          fetchBankAccounts('cash'),
          fetchBankAccounts('investment'),
          fetchBankAccounts('credit'),
        ]);

        if (cancelled) {
          return;
        }

        setCashAccounts(loadedCashAccounts);
        setInvestmentAccounts(loadedInvestmentAccounts);
        setCreditAccounts(loadedCreditAccounts);

        const resolvedCashFromId = loadedCashAccounts.some((account) => String(account.id) === cashFromAccountId)
          ? cashFromAccountId
          : String(loadedCashAccounts[0]?.id ?? '');
        const resolvedCashToId = loadedCashAccounts.some((account) => String(account.id) === cashToAccountId)
          && cashToAccountId !== resolvedCashFromId
          ? cashToAccountId
          : String(loadedCashAccounts.find((account) => String(account.id) !== resolvedCashFromId)?.id ?? '');

        if (resolvedCashFromId !== cashFromAccountId) {
          setCashFromAccountId(resolvedCashFromId);
        }

        if (resolvedCashToId !== cashToAccountId) {
          setCashToAccountId(resolvedCashToId);
        }

        if (!loadedCashAccounts.some((account) => String(account.id) === cashAccountId) && loadedCashAccounts[0]) {
          setCashAccountId(String(loadedCashAccounts[0].id));
        }

        if (!loadedInvestmentAccounts.some((account) => String(account.id) === investmentAccountId) && loadedInvestmentAccounts[0]) {
          setInvestmentAccountId(String(loadedInvestmentAccounts[0].id));
        }

        if (!loadedCreditAccounts.some((account) => String(account.id) === creditAccountId) && loadedCreditAccounts[0]) {
          setCreditAccountId(String(loadedCreditAccounts[0].id));
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

    void loadAccountContext();

    return () => {
      cancelled = true;
    };
  }, [cashAccountId, cashFromAccountId, cashToAccountId, creditAccountId, investmentAccountId]);

  useEffect(() => {
    const idsToLoad = new Set<number>();
    if (mode === 'between_cash') {
      if (hasFamily) {
        if (direction === 'personal_to_family') idsToLoad.add(personalAccountId);
        if (direction === 'family_to_personal' && familyAccountId) idsToLoad.add(familyAccountId);
      } else if (cashFromAccountId) {
        idsToLoad.add(Number(cashFromAccountId));
      }
    } else if (mode === 'investment') {
      if (cashAccountId) idsToLoad.add(Number(cashAccountId));
      if (investmentAccountId) idsToLoad.add(Number(investmentAccountId));
    } else if (creditAccountId) {
      idsToLoad.add(Number(creditAccountId));
    }

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
  }, [
    mode,
    direction,
    hasFamily,
    personalAccountId,
    familyAccountId,
    cashAccountId,
    cashFromAccountId,
    creditAccountId,
    investmentAccountId,
    balancesByAccountId,
  ]);

  const selectedCreditAccount = creditAccounts.find((account) => String(account.id) === creditAccountId) ?? null;
  const creditAvailableBalances = useMemo<DashboardBankBalance[]>(() => {
    if (!selectedCreditAccount) return [];

    const creditLimit = selectedCreditAccount.credit_limit ?? 0;
    const creditBalances = balancesByAccountId[selectedCreditAccount.id];
    if (creditBalances === undefined) return [];
    if (creditBalances.length === 0) {
      return [{
        currency_code: baseCurrencyCode,
        amount: creditLimit,
        historical_cost_in_base: creditLimit,
        base_currency_code: baseCurrencyCode,
      }];
    }

    return creditBalances.map((balance) => {
      const availableAmount = Math.max(0, creditLimit + balance.amount);
      return {
        ...balance,
        amount: availableAmount,
        historical_cost_in_base: balance.currency_code === baseCurrencyCode
          ? availableAmount
          : Math.max(0, creditLimit + balance.historical_cost_in_base),
      };
    });
  }, [balancesByAccountId, baseCurrencyCode, selectedCreditAccount]);

  const fromBalances = useMemo(() => {
    if (mode === 'between_cash') {
      if (hasFamily) {
        return direction === 'personal_to_family' ? personalBalances : familyBalances;
      }
      return balancesByAccountId[Number(cashFromAccountId)] || [];
    }
    if (mode === 'credit_to_cash') {
      return creditAvailableBalances;
    }
    return balancesByAccountId[
      direction === 'cash_to_investment' ? Number(cashAccountId) : Number(investmentAccountId)
    ] || [];
  }, [
    mode,
    direction,
    hasFamily,
    personalBalances,
    familyBalances,
    balancesByAccountId,
    cashAccountId,
    cashFromAccountId,
    creditAvailableBalances,
    investmentAccountId,
  ]);

  const fromAccountId = mode === 'between_cash'
    ? hasFamily
      ? (direction === 'personal_to_family' ? personalAccountId : Number(familyAccountId))
      : Number(cashFromAccountId)
    : mode === 'credit_to_cash'
      ? Number(creditAccountId)
    : (direction === 'cash_to_investment' ? Number(cashAccountId) : Number(investmentAccountId));
  const toAccountId = mode === 'between_cash'
    ? hasFamily
      ? (direction === 'personal_to_family' ? Number(familyAccountId) : personalAccountId)
      : Number(cashToAccountId)
    : mode === 'credit_to_cash'
      ? Number(cashAccountId)
    : (direction === 'cash_to_investment' ? Number(investmentAccountId) : Number(cashAccountId));

  const availableCurrencies = fromBalances.filter((b) => b.amount > 0);
  const selectedBalance = fromBalances.find((b) => b.currency_code === currencyCode);
  const amountValue = parseFloat(amount) || 0;
  const exceedsBalance = !!selectedBalance && amountValue > selectedBalance.amount;

  const validationMessage = mode === 'investment' && !investmentAccounts.length
    ? 'Сначала создай инвестиционный счет.'
    : mode === 'credit_to_cash' && !creditAccounts.length
      ? 'Сначала создай кредитный счет.'
    : mode === 'between_cash' && !hasFamily && cashAccounts.length < 2
      ? 'Для перевода между cash-счетами нужно минимум два счёта.'
    : mode === 'between_cash' && !hasFamily && fromAccountId === toAccountId
      ? 'Выбери разные счета.'
    : !currencyCode
      ? null
      : availableCurrencies.length === 0
        ? mode === 'credit_to_cash'
          ? 'На кредитном счёте нет доступного лимита.'
          : 'На исходном счёте нет средств для перевода.'
        : !selectedBalance || selectedBalance.amount <= 0
          ? mode === 'credit_to_cash'
            ? 'На кредитном счёте нет доступного лимита в выбранной валюте.'
            : 'На исходном счёте нет средств в выбранной валюте.'
          : exceedsBalance
            ? mode === 'credit_to_cash'
              ? `Доступный лимит: ${formatAmount(selectedBalance.amount, currencyCode)}`
              : `Недостаточно средств: ${formatAmount(selectedBalance.amount, currencyCode)}`
            : null;

  const canSubmit =
    !submitting
    && !loadingAccounts
    && !loadingBalances
    && fromAccountId > 0
    && toAccountId > 0
    && fromAccountId !== toAccountId
    && !!currencyCode
    && amountValue > 0
    && !validationMessage;

  const handleDirectionChange = (newDirection: TransferDirection) => {
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
    <BottomSheet open tag="Банк" title="Перевод между счетами" onClose={() => !submitting && onClose()}
      actions={
        <div className="action-pill" style={{ width: '100%' }}>
          <button className="action-pill__cancel" type="button" onClick={onClose} disabled={submitting}>Отмена</button>
          <button className="action-pill__confirm" type="button" disabled={!canSubmit} onClick={handleSubmit}>{submitting ? '...' : 'Перевести'}</button>
        </div>
      }
    >
      <div>
          <div className="operations-note">
            {mode === 'credit_to_cash'
              ? 'Выбери кредит, счёт зачисления и сумму. Перевод с кредита увеличит долг и добавит деньги в свободный остаток выбранного счёта.'
              : mode === 'between_cash'
                ? 'Выбери cash-счета, валюту и сумму. Деньги перейдут между банковскими счетами без изменения общего бюджета.'
                : 'Выбери направление, валюту и сумму. Перевод в инвестиции уменьшает бюджет, обратный перевод возвращает деньги в свободный остаток.'}
          </div>

          <div className="form-row">
            {([
              { key: 'between_cash', label: 'Между cash', disabled: false },
              { key: 'investment', label: 'С инвестициями', disabled: false },
              { key: 'credit_to_cash', label: 'С кредита', disabled: false },
            ] as const).map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => {
                  if (item.disabled) return;
                  setMode(item.key);
                  handleDirectionChange(
                    item.key === 'between_cash'
                      ? hasFamily ? 'personal_to_family' : 'cash_to_cash'
                      : item.key === 'credit_to_cash'
                        ? 'credit_to_cash'
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

          {mode === 'between_cash' && hasFamily && (
            <div className="form-row">
              {(['personal_to_family', 'family_to_personal'] as const).map((dir) => (
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
              ))}
            </div>
          )}

          {mode === 'investment' && (
            <div className="form-row">
              {(['cash_to_investment', 'investment_to_cash'] as const).map((dir) => (
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
              ))}
            </div>
          )}

          {mode === 'between_cash' && !hasFamily && (
            <>
              <div className="form-row">
                <select
                  className="input"
                  value={cashFromAccountId}
                  onChange={(e) => {
                    setCashFromAccountId(e.target.value);
                    setCurrencyCode('');
                    setAmount('');
                  }}
                  disabled={submitting || loadingAccounts || cashAccounts.length < 2}
                >
                  <option value="">Счёт списания</option>
                  {cashAccounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-row">
                <select
                  className="input"
                  value={cashToAccountId}
                  onChange={(e) => {
                    setCashToAccountId(e.target.value);
                    setCurrencyCode('');
                    setAmount('');
                  }}
                  disabled={submitting || loadingAccounts || cashAccounts.length < 2}
                >
                  <option value="">Счёт зачисления</option>
                  {cashAccounts
                    .filter((account) => String(account.id) !== cashFromAccountId)
                    .map((account) => (
                      <option key={account.id} value={account.id}>
                        {account.name}
                      </option>
                    ))}
                </select>
              </div>
            </>
          )}

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

          {mode === 'credit_to_cash' && (
            <>
              <div className="form-row">
                <select
                  className="input"
                  value={creditAccountId}
                  onChange={(e) => {
                    setCreditAccountId(e.target.value);
                    setCurrencyCode('');
                    setAmount('');
                  }}
                  disabled={submitting || loadingAccounts || !creditAccounts.length}
                >
                  <option value="">{loadingAccounts ? 'Загружаем кредитные счета...' : 'Кредитный счет'}</option>
                  {creditAccounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.owner_type === 'family' ? 'Семейный' : 'Личный'} · {account.name}
                    </option>
                  ))}
                </select>
              </div>

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
                  <option value="">Счёт зачисления</option>
                  {cashAccounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.owner_type === 'family' ? 'Семейный' : 'Личный'} · {account.name}
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
    </BottomSheet>
  );
}
