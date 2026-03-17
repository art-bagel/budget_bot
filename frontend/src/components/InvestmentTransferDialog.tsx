import { useEffect, useMemo, useState } from 'react';

import { fetchBankAccountSnapshot, transferBetweenAccounts } from '../api';
import { useModalOpen } from '../hooks/useModalOpen';
import type { BankAccount, DashboardBankBalance } from '../types';
import { formatAmount } from '../utils/format';
import { sanitizeDecimalInput } from '../utils/validation';


interface Props {
  cashAccounts: BankAccount[];
  investmentAccounts: BankAccount[];
  onClose: () => void;
  onSuccess: () => void;
}


export default function InvestmentTransferDialog({
  cashAccounts,
  investmentAccounts,
  onClose,
  onSuccess,
}: Props) {
  useModalOpen();

  const [direction, setDirection] = useState<'cash_to_investment' | 'investment_to_cash'>('cash_to_investment');
  const [cashAccountId, setCashAccountId] = useState('');
  const [investmentAccountId, setInvestmentAccountId] = useState('');
  const [balancesByAccountId, setBalancesByAccountId] = useState<Record<number, DashboardBankBalance[]>>({});
  const [currencyCode, setCurrencyCode] = useState('');
  const [amount, setAmount] = useState('');
  const [comment, setComment] = useState('');
  const [loadingBalances, setLoadingBalances] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!cashAccountId && cashAccounts[0]) {
      setCashAccountId(String(cashAccounts[0].id));
    }
  }, [cashAccounts, cashAccountId]);

  useEffect(() => {
    if (!investmentAccountId && investmentAccounts[0]) {
      setInvestmentAccountId(String(investmentAccounts[0].id));
    }
  }, [investmentAccounts, investmentAccountId]);

  useEffect(() => {
    const idsToLoad = new Set<number>();
    if (cashAccountId) idsToLoad.add(Number(cashAccountId));
    if (investmentAccountId) idsToLoad.add(Number(investmentAccountId));

    const missingIds = [...idsToLoad].filter((id) => balancesByAccountId[id] === undefined);
    if (missingIds.length === 0) {
      return;
    }

    setLoadingBalances(true);
    setError(null);

    Promise.all(missingIds.map(async (accountId) => {
      const balances = await fetchBankAccountSnapshot(accountId);
      return { accountId, balances };
    }))
      .then((results) => {
        setBalancesByAccountId((prev) => {
          const next = { ...prev };
          results.forEach(({ accountId, balances }) => {
            next[accountId] = balances;
          });
          return next;
        });
      })
      .catch((reason: unknown) => {
        setError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => setLoadingBalances(false));
  }, [cashAccountId, investmentAccountId, balancesByAccountId]);

  const fromAccountId = direction === 'cash_to_investment' ? Number(cashAccountId) : Number(investmentAccountId);
  const toAccountId = direction === 'cash_to_investment' ? Number(investmentAccountId) : Number(cashAccountId);
  const fromBalances = balancesByAccountId[fromAccountId] || [];
  const availableCurrencies = useMemo(
    () => fromBalances.filter((balance) => balance.amount > 0),
    [fromBalances],
  );
  const selectedBalance = availableCurrencies.find((balance) => balance.currency_code === currencyCode) || null;
  const amountValue = parseFloat(amount) || 0;
  const exceedsBalance = !!selectedBalance && amountValue > selectedBalance.amount;

  const validationMessage = !cashAccounts.length
    ? 'Нет доступных cash-счетов.'
    : !investmentAccounts.length
      ? 'Сначала создай инвестиционный счет.'
      : !cashAccountId || !investmentAccountId
        ? 'Выбери оба счета.'
        : !currencyCode
          ? null
          : availableCurrencies.length === 0
            ? 'На исходном счете нет средств для перевода.'
            : !selectedBalance
              ? 'В выбранной валюте нет доступного остатка.'
              : exceedsBalance
                ? `Недостаточно средств: ${formatAmount(selectedBalance.amount, currencyCode)}`
                : null;

  const canSubmit = !submitting && !loadingBalances && !!cashAccountId && !!investmentAccountId && !!currencyCode && amountValue > 0 && !validationMessage;

  const handleDirectionChange = (nextDirection: 'cash_to_investment' | 'investment_to_cash') => {
    setDirection(nextDirection);
    setCurrencyCode('');
    setAmount('');
    setError(null);
  };

  const handleSubmit = async () => {
    if (!canSubmit) {
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

  const renderAccountOptions = (accounts: BankAccount[]) => accounts.map((account) => (
    <option key={account.id} value={account.id}>
      {account.owner_type === 'family' ? 'Семейный' : 'Личный'} · {account.name}
    </option>
  ));

  return (
    <div className="modal-backdrop" onClick={() => !submitting && onClose()}>
      <div className="modal-card" onClick={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <div className="section__header">
            <div>
              <div className="section__eyebrow">Инвестиции</div>
              <h2 className="section__title">Перевод между cash и investment</h2>
            </div>
          </div>
        </div>

        <div className="modal-body">
          <div className="operations-note">
            Перевод в инвестиции уменьшает бюджет, обратный перевод возвращает деньги в свободный остаток.
          </div>

          <div className="form-row">
            {(['cash_to_investment', 'investment_to_cash'] as const).map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => handleDirectionChange(item)}
                disabled={submitting}
                style={{
                  flex: 1,
                  padding: '8px 12px',
                  fontSize: '0.9rem',
                  background: direction === item ? 'var(--bg-accent)' : 'transparent',
                  color: direction === item ? 'var(--text-on-accent)' : 'var(--text-primary)',
                  border: 'none',
                  borderRadius: 8,
                  cursor: submitting ? 'default' : 'pointer',
                  outline: 'none',
                }}
              >
                {item === 'cash_to_investment' ? 'Cash → Invest' : 'Invest → Cash'}
              </button>
            ))}
          </div>

          <div className="form-row">
            <select
              className="input"
              value={cashAccountId}
              onChange={(event) => {
                setCashAccountId(event.target.value);
                setCurrencyCode('');
                setAmount('');
              }}
              disabled={submitting || !cashAccounts.length}
            >
              <option value="">Cash-счет</option>
              {renderAccountOptions(cashAccounts)}
            </select>
          </div>

          <div className="form-row">
            <select
              className="input"
              value={investmentAccountId}
              onChange={(event) => {
                setInvestmentAccountId(event.target.value);
                setCurrencyCode('');
                setAmount('');
              }}
              disabled={submitting || !investmentAccounts.length}
            >
              <option value="">Инвестиционный счет</option>
              {renderAccountOptions(investmentAccounts)}
            </select>
          </div>

          <div className="form-row">
            <select
              className="input"
              value={currencyCode}
              onChange={(event) => {
                setCurrencyCode(event.target.value);
                setAmount('');
              }}
              disabled={submitting || loadingBalances || !fromAccountId}
            >
              <option value="">{loadingBalances ? 'Загружаем валюты...' : 'Выбери валюту'}</option>
              {availableCurrencies.map((balance) => (
                <option key={`${fromAccountId}-${balance.currency_code}`} value={balance.currency_code}>
                  {balance.currency_code} · {formatAmount(balance.amount, balance.currency_code)}
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
              onChange={(event) => setAmount(sanitizeDecimalInput(event.target.value))}
              disabled={submitting || loadingBalances || !currencyCode}
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
              onChange={(event) => setComment(event.target.value)}
              onKeyDown={(event) => event.key === 'Enter' && !submitting && handleSubmit()}
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
