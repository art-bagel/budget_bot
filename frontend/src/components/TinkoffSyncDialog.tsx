import { useEffect, useState } from 'react';

import { applyTinkoffSync, fetchBankAccounts, fetchBankAccountSnapshot, getTinkoffInstrumentLogoUrl, previewTinkoffSync } from '../api';
import { useModalOpen } from '../hooks/useModalOpen';
import type {
  BankAccount,
  DashboardBankBalance,
  DepositResolution,
  DepositResolutionKind,
  WithdrawalResolution,
  WithdrawalResolutionKind,
  TinkoffDepositPreview,
  TinkoffPreviewResponse,
} from '../types';
import { formatAmount } from '../utils/format';


interface Props {
  connectionId: number;
  investmentAccountId: number;
  baseCurrencyCode: string;
  onClose: () => void;
  onSuccess: () => void;
}

interface ResolutionState {
  resolution: DepositResolutionKind | WithdrawalResolutionKind | '';
  accountId: string;
}

type ManualTab = 'deposits' | 'withdrawals';


export default function TinkoffSyncDialog({
  connectionId,
  investmentAccountId,
  baseCurrencyCode,
  onClose,
  onSuccess,
}: Props) {
  useModalOpen();

  const [stage, setStage] = useState<'loading' | 'review' | 'applying' | 'done' | 'error'>('loading');
  const [preview, setPreview] = useState<TinkoffPreviewResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Per-operation resolution state keyed by tinkoff_op_id
  const [depositStates, setDepositStates] = useState<Record<string, ResolutionState>>({});
  const [withdrawalStates, setWithdrawalStates] = useState<Record<string, ResolutionState>>({});

  // Cash accounts for "transfer" resolution
  const [cashAccounts, setCashAccounts] = useState<BankAccount[]>([]);
  const [accountBalances, setAccountBalances] = useState<Record<number, DashboardBankBalance[]>>({});

  // Investment account balances for "already_recorded" validation
  const [investmentBalances, setInvestmentBalances] = useState<DashboardBankBalance[]>([]);

  const [applyResult, setApplyResult] = useState<{ applied: number; skipped: number } | null>(null);
  const [showAllDeposits, setShowAllDeposits] = useState(false);
  const [showAllWithdrawals, setShowAllWithdrawals] = useState(false);
  const [showAllAutoOperations, setShowAllAutoOperations] = useState(false);
  const [manualTab, setManualTab] = useState<ManualTab>('deposits');
  const [applyWarning, setApplyWarning] = useState<string | null>(null);

  // Load preview + account balances on mount
  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const [previewData, cashAccountList, investmentSnapshot] = await Promise.all([
          previewTinkoffSync(connectionId),
          fetchBankAccounts('cash'),
          fetchBankAccountSnapshot(investmentAccountId),
        ]);

        if (cancelled) return;

        setPreview(previewData);
        setCashAccounts(cashAccountList);
        setInvestmentBalances(investmentSnapshot);

        // Init deposit states
        const nextDepositStates: Record<string, ResolutionState> = {};
        for (const d of previewData.deposits) {
          if (!d.already_imported) {
            nextDepositStates[d.tinkoff_op_id] = { resolution: '', accountId: '' };
          }
        }
        const nextWithdrawalStates: Record<string, ResolutionState> = {};
        for (const w of previewData.withdrawals) {
          if (!w.already_imported) {
            nextWithdrawalStates[w.tinkoff_op_id] = { resolution: '', accountId: '' };
          }
        }
        setDepositStates(nextDepositStates);
        setWithdrawalStates(nextWithdrawalStates);
        setShowAllDeposits(false);
        setShowAllWithdrawals(false);
        setShowAllAutoOperations(false);
        setManualTab(previewData.deposits.some((d) => !d.already_imported) ? 'deposits' : 'withdrawals');
        setApplyWarning(null);

        // Load balances for all cash accounts
        const balanceEntries = await Promise.all(
          cashAccountList.map(async (acc) => {
            const bal = await fetchBankAccountSnapshot(acc.id);
            return [acc.id, bal] as [number, DashboardBankBalance[]];
          }),
        );

        if (!cancelled) {
          setAccountBalances(Object.fromEntries(balanceEntries));
          setStage('review');
        }
      } catch (err: unknown) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
          setStage('error');
        }
      }
    };

    void load();
    return () => { cancelled = true; };
  }, [connectionId, investmentAccountId]);

  const setDepositResolution = (opId: string, resolution: DepositResolutionKind) => {
    setApplyWarning(null);
    setDepositStates((prev) => ({
      ...prev,
      [opId]: { ...prev[opId], resolution, accountId: prev[opId]?.accountId ?? '' },
    }));
  };

  const setDepositSourceAccount = (opId: string, accountId: string) => {
    setApplyWarning(null);
    setDepositStates((prev) => ({
      ...prev,
      [opId]: { ...prev[opId], accountId },
    }));
  };

  const setWithdrawalResolution = (opId: string, resolution: WithdrawalResolutionKind) => {
    setApplyWarning(null);
    setWithdrawalStates((prev) => ({
      ...prev,
      [opId]: { ...prev[opId], resolution, accountId: prev[opId]?.accountId ?? '' },
    }));
  };

  const setWithdrawalTargetAccount = (opId: string, accountId: string) => {
    setApplyWarning(null);
    setWithdrawalStates((prev) => ({
      ...prev,
      [opId]: { ...prev[opId], accountId },
    }));
  };

  const getAccountBalance = (accountId: number, currency: string): number | null => {
    const bals = accountBalances[accountId];
    if (!bals) return null;
    const bal = bals.find((b) => b.currency_code === currency);
    return bal !== undefined ? bal.amount : 0;
  };

  const getInvestmentBalance = (currency: string): number | null => {
    const bal = investmentBalances.find((b) => b.currency_code === currency);
    return bal !== undefined ? bal.amount : 0;
  };

  const newDeposits = preview?.deposits.filter((d) => !d.already_imported) ?? [];
  const newWithdrawals = preview?.withdrawals.filter((w) => !w.already_imported) ?? [];

  // Check if any "already_recorded" choice would fail balance check
  const alreadyRecordedBalanceOk = (deposit: TinkoffDepositPreview): boolean => {
    const bal = getInvestmentBalance(deposit.currency_code);
    return bal === null || bal >= deposit.amount;
  };

  const depositsResolved = newDeposits.every((d) => {
    const s = depositStates[d.tinkoff_op_id];
    if (!s || s.resolution === '') return false;
    if (s.resolution === 'transfer' && !s.accountId) return false;
    if (s.resolution === 'already_recorded' && !alreadyRecordedBalanceOk(d)) return false;
    return true;
  });
  const withdrawalsResolved = newWithdrawals.every((w) => {
    const s = withdrawalStates[w.tinkoff_op_id];
    if (!s || s.resolution === '') return false;
    if (s.resolution === 'transfer' && !s.accountId) return false;
    return true;
  });
  const allResolved = depositsResolved && withdrawalsResolved;
  const unresolvedDepositsCount = newDeposits.filter((d) => {
    const s = depositStates[d.tinkoff_op_id];
    if (!s || s.resolution === '') return true;
    if (s.resolution === 'transfer' && !s.accountId) return true;
    if (s.resolution === 'already_recorded' && !alreadyRecordedBalanceOk(d)) return true;
    return false;
  }).length;
  const unresolvedWithdrawalsCount = newWithdrawals.filter((w) => {
    const s = withdrawalStates[w.tinkoff_op_id];
    if (!s || s.resolution === '') return true;
    if (s.resolution === 'transfer' && !s.accountId) return true;
    return false;
  }).length;

  const totalNewAuto = (preview?.auto_operations ?? []).filter((o) => !o.already_imported).length;
  const totalManualNew = newDeposits.length + newWithdrawals.length;
  const totalNew = totalManualNew + totalNewAuto;
  const shouldCompactDeposits = newDeposits.length > 24;
  const shouldCompactWithdrawals = newWithdrawals.length > 12;
  const shouldCompactAutoOperations = totalNewAuto > 40;
  const visibleDeposits = shouldCompactDeposits && !showAllDeposits ? newDeposits.slice(0, 12) : newDeposits;
  const visibleWithdrawals = shouldCompactWithdrawals && !showAllWithdrawals ? newWithdrawals.slice(0, 8) : newWithdrawals;
  const visibleAutoOperations = shouldCompactAutoOperations && !showAllAutoOperations
    ? (preview?.auto_operations ?? []).filter((o) => !o.already_imported).slice(0, 24)
    : (preview?.auto_operations ?? []).filter((o) => !o.already_imported);

  const setAllDepositResolutions = (resolution: DepositResolutionKind, accountId = '') => {
    const next: Record<string, ResolutionState> = {};
    for (const d of newDeposits) {
      next[d.tinkoff_op_id] = { resolution, accountId };
    }
    setDepositStates((prev) => ({ ...prev, ...next }));
  };

  const setAllWithdrawalResolutions = (resolution: WithdrawalResolutionKind, accountId = '') => {
    const next: Record<string, ResolutionState> = {};
    for (const w of newWithdrawals) {
      next[w.tinkoff_op_id] = { resolution, accountId };
    }
    setWithdrawalStates((prev) => ({ ...prev, ...next }));
  };

  const handleApply = async () => {
    if (!preview) return;
    if (!allResolved && totalManualNew > 0) {
      if (unresolvedDepositsCount > 0) {
        setManualTab('deposits');
      } else if (unresolvedWithdrawalsCount > 0) {
        setManualTab('withdrawals');
      }
      setApplyWarning(
        `Сначала выбери способ учёта для всех ручных операций: осталось ${unresolvedDepositsCount} пополн. и ${unresolvedWithdrawalsCount} вывод.`,
      );
      return;
    }

    setApplyWarning(null);
    setStage('applying');

    const depositResolutions: DepositResolution[] = newDeposits.map((d) => {
      const s = depositStates[d.tinkoff_op_id];
      return {
        tinkoff_op_id: d.tinkoff_op_id,
        resolution: s.resolution as DepositResolutionKind,
        source_account_id: s.resolution === 'transfer' ? Number(s.accountId) : null,
      };
    });
    const withdrawalResolutions: WithdrawalResolution[] = newWithdrawals.map((w) => {
      const s = withdrawalStates[w.tinkoff_op_id];
      return {
        tinkoff_op_id: w.tinkoff_op_id,
        resolution: s.resolution as WithdrawalResolutionKind,
        target_account_id: s.resolution === 'transfer' ? Number(s.accountId) : null,
      };
    });

    try {
      const result = await applyTinkoffSync(connectionId, depositResolutions, withdrawalResolutions);
      setApplyResult({ applied: result.applied, skipped: result.skipped_already_imported });
      setStage('done');
      onSuccess();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
      setStage('error');
    }
  };

  const renderDepositCard = (deposit: TinkoffDepositPreview) => {
    const state = depositStates[deposit.tinkoff_op_id];
    if (!state) return null;

    const amountFormatted = formatAmount(deposit.amount, deposit.currency_code);
    const investBal = getInvestmentBalance(deposit.currency_code);
    const investEnough = investBal === null || investBal >= deposit.amount;

    return (
      <div key={deposit.tinkoff_op_id} className="tinkoff-deposit-card">
        <div className="tinkoff-deposit-card__header">
          <span className="tinkoff-deposit-card__amount">{amountFormatted}</span>
          <span className="tinkoff-deposit-card__date">{deposit.date}</span>
        </div>

        <div className="tinkoff-deposit-card__options">
          <label className="tinkoff-deposit-card__option">
            <input
              type="radio"
              name={`resolution-${deposit.tinkoff_op_id}`}
              checked={state.resolution === 'external'}
              onChange={() => setDepositResolution(deposit.tinkoff_op_id, 'external')}
            />
            <span>Внешнее пополнение</span>
          </label>

          <label className="tinkoff-deposit-card__option">
            <input
              type="radio"
              name={`resolution-${deposit.tinkoff_op_id}`}
              checked={state.resolution === 'transfer'}
              onChange={() => setDepositResolution(deposit.tinkoff_op_id, 'transfer')}
            />
            <span>Перевод со счёта</span>
          </label>

          {state.resolution === 'transfer' && (
            <div className="tinkoff-deposit-card__transfer-detail">
              <select
                value={state.accountId}
                onChange={(e) => setDepositSourceAccount(deposit.tinkoff_op_id, e.target.value)}
                className="tinkoff-deposit-card__select"
              >
                <option value="">— Выберите счёт —</option>
                {cashAccounts.map((acc) => {
                  const bal = getAccountBalance(acc.id, deposit.currency_code);
                  const enough = bal !== null && bal >= deposit.amount;
                  return (
                    <option key={acc.id} value={String(acc.id)}>
                      {acc.name}
                      {bal !== null ? ` (${formatAmount(bal, deposit.currency_code)}${enough ? '' : ' ⚠'})` : ''}
                    </option>
                  );
                })}
              </select>
              {state.accountId && (() => {
                const bal = getAccountBalance(Number(state.accountId), deposit.currency_code);
                const enough = bal !== null && bal >= deposit.amount;
                if (!enough && bal !== null) {
                  return (
                    <p className="tinkoff-deposit-card__warn">
                      Недостаточно средств на счёте ({formatAmount(bal, deposit.currency_code)})
                    </p>
                  );
                }
                return null;
              })()}
            </div>
          )}

          <label className="tinkoff-deposit-card__option">
            <input
              type="radio"
              name={`resolution-${deposit.tinkoff_op_id}`}
              checked={state.resolution === 'already_recorded'}
              onChange={() => setDepositResolution(deposit.tinkoff_op_id, 'already_recorded')}
            />
            <span>
              Уже учтено в боте
              {investBal !== null && (
                <span className="tinkoff-deposit-card__balance-hint">
                  {' '}(на инвест-счёте: {formatAmount(investBal, deposit.currency_code)})
                </span>
              )}
            </span>
          </label>

          {state.resolution === 'already_recorded' && !investEnough && (
            <p className="tinkoff-deposit-card__warn">
              На инвест-счёте недостаточно средств — деньги там ещё не учтены
              {investBal !== null && ` (есть ${formatAmount(investBal, deposit.currency_code)})`}
            </p>
          )}
        </div>
      </div>
    );
  };

  const renderWithdrawalCard = (withdrawal: TinkoffDepositPreview) => {
    const state = withdrawalStates[withdrawal.tinkoff_op_id];
    if (!state) return null;

    const amountFormatted = formatAmount(withdrawal.amount, withdrawal.currency_code);

    return (
      <div key={withdrawal.tinkoff_op_id} className="tinkoff-deposit-card">
        <div className="tinkoff-deposit-card__header">
          <span className="tinkoff-deposit-card__amount">{amountFormatted}</span>
          <span className="tinkoff-deposit-card__date">{withdrawal.date}</span>
        </div>

        <div className="tinkoff-deposit-card__options">
          <label className="tinkoff-deposit-card__option">
            <input
              type="radio"
              name={`withdrawal-resolution-${withdrawal.tinkoff_op_id}`}
              checked={state.resolution === 'external'}
              onChange={() => setWithdrawalResolution(withdrawal.tinkoff_op_id, 'external')}
            />
            <span>Внешний вывод</span>
          </label>

          <label className="tinkoff-deposit-card__option">
            <input
              type="radio"
              name={`withdrawal-resolution-${withdrawal.tinkoff_op_id}`}
              checked={state.resolution === 'transfer'}
              onChange={() => setWithdrawalResolution(withdrawal.tinkoff_op_id, 'transfer')}
            />
            <span>Перевод на счёт</span>
          </label>

          {state.resolution === 'transfer' && (
            <div className="tinkoff-deposit-card__transfer-detail">
              <select
                value={state.accountId}
                onChange={(e) => setWithdrawalTargetAccount(withdrawal.tinkoff_op_id, e.target.value)}
                className="tinkoff-deposit-card__select"
              >
                <option value="">— Выберите счёт —</option>
                {cashAccounts.map((acc) => {
                  const bal = getAccountBalance(acc.id, withdrawal.currency_code);
                  return (
                    <option key={acc.id} value={String(acc.id)}>
                      {acc.name}
                      {bal !== null ? ` (${formatAmount(bal, withdrawal.currency_code)})` : ''}
                    </option>
                  );
                })}
              </select>
            </div>
          )}

          <label className="tinkoff-deposit-card__option">
            <input
              type="radio"
              name={`withdrawal-resolution-${withdrawal.tinkoff_op_id}`}
              checked={state.resolution === 'already_recorded'}
              onChange={() => setWithdrawalResolution(withdrawal.tinkoff_op_id, 'already_recorded')}
            />
            <span>Уже учтено в боте</span>
          </label>
        </div>
      </div>
    );
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <div className="dialog__header">
          <h2 className="dialog__title">Подтянуть данные из Тинькофф</h2>
          <button className="dialog__close" onClick={onClose} type="button">✕</button>
        </div>

        {stage === 'review' && applyWarning && (
          <div className="tinkoff-sync__warning-popover" role="alert" aria-live="assertive">
            <div className="tinkoff-sync__warning-title">Не всё выбрано</div>
            <p className="tinkoff-sync__warning-text">{applyWarning}</p>
            <button
              type="button"
              className="tinkoff-sync__warning-close"
              onClick={() => setApplyWarning(null)}
            >
              Понятно
            </button>
          </div>
        )}

        <div className="dialog__body">
          {stage === 'loading' && (
            <p className="tinkoff-sync__status">Загружаем операции из Тинькофф…</p>
          )}

          {stage === 'applying' && (
            <p className="tinkoff-sync__status">Применяем операции…</p>
          )}

          {stage === 'error' && (
            <>
              <p className="tinkoff-sync__error">{error ?? 'Неизвестная ошибка'}</p>
              <p style={{ marginTop: 8, fontSize: '0.82rem', color: 'var(--text-tertiary)' }}>
                Никакие данные не были изменены.
              </p>
            </>
          )}

          {stage === 'done' && applyResult && (
            <div className="tinkoff-sync__done">
              <p>Готово! Применено операций: <strong>{applyResult.applied}</strong></p>
              {applyResult.skipped > 0 && (
                <p className="tinkoff-sync__done-skipped">Пропущено (уже были): {applyResult.skipped}</p>
              )}
            </div>
          )}

          {stage === 'review' && preview && (
            <>
              {totalManualNew > 0 && (
                <div className="tinkoff-sync__hint">
                  Нужно разобрать ручные движения перед импортом.
                  {unresolvedDepositsCount > 0 && ` Пополнения без решения: ${unresolvedDepositsCount}.`}
                  {unresolvedWithdrawalsCount > 0 && ` Выводы без решения: ${unresolvedWithdrawalsCount}.`}
                  {newWithdrawals.length > 0 && ' У этого счёта есть не только пополнения, но и выводы ниже по списку.'}
                </div>
              )}

              {totalManualNew > 0 && (newDeposits.length > 0 || newWithdrawals.length > 0) && (
                <section className="tinkoff-sync__section">
                  <div className="tinkoff-sync__tabs" role="tablist" aria-label="Ручные операции">
                    {newDeposits.length > 0 && (
                      <button
                        type="button"
                        role="tab"
                        aria-selected={manualTab === 'deposits'}
                        className={`tinkoff-sync__tab${manualTab === 'deposits' ? ' tinkoff-sync__tab--active' : ''}`}
                        onClick={() => setManualTab('deposits')}
                      >
                        Вводы ({newDeposits.length})
                      </button>
                    )}
                    {newWithdrawals.length > 0 && (
                      <button
                        type="button"
                        role="tab"
                        aria-selected={manualTab === 'withdrawals'}
                        className={`tinkoff-sync__tab${manualTab === 'withdrawals' ? ' tinkoff-sync__tab--active' : ''}`}
                        onClick={() => setManualTab('withdrawals')}
                      >
                        Выводы ({newWithdrawals.length})
                      </button>
                    )}
                  </div>
                </section>
              )}

              {newDeposits.length > 0 && manualTab === 'deposits' && (
                <section className="tinkoff-sync__section">
                  <h3 className="tinkoff-sync__section-title">
                    Пополнения ({newDeposits.length}) — требуют решения
                  </h3>

                  {newDeposits.length > 1 && (
                    <div className="tinkoff-sync__bulk-actions">
                      <span className="tinkoff-sync__bulk-label">Для всех:</span>
                      <button
                        type="button"
                        className="tinkoff-sync__bulk-btn"
                        onClick={() => setAllDepositResolutions('external')}
                      >
                        Внешнее
                      </button>
                      <button
                        type="button"
                        className="tinkoff-sync__bulk-btn"
                        onClick={() => setAllDepositResolutions('already_recorded')}
                      >
                        Уже учтено
                      </button>
                      {cashAccounts.length > 0 && (
                        <select
                          className="tinkoff-sync__bulk-select"
                          value=""
                          onChange={(e) => {
                            if (e.target.value) setAllDepositResolutions('transfer', e.target.value);
                          }}
                        >
                          <option value="">Перевод со счёта…</option>
                          {cashAccounts.map((acc) => (
                            <option key={acc.id} value={String(acc.id)}>{acc.name}</option>
                          ))}
                        </select>
                      )}
                    </div>
                  )}

                  {visibleDeposits.map(renderDepositCard)}
                  {shouldCompactDeposits && (
                    <button
                      type="button"
                      className="tinkoff-sync__show-more"
                      onClick={() => setShowAllDeposits((prev) => !prev)}
                    >
                      {showAllDeposits
                        ? 'Свернуть список пополнений'
                        : `Показать все пополнения (${newDeposits.length})`}
                    </button>
                  )}
                </section>
              )}

              {newWithdrawals.length > 0 && manualTab === 'withdrawals' && (
                <section className="tinkoff-sync__section">
                  <h3 className="tinkoff-sync__section-title">
                    Выводы ({newWithdrawals.length}) — требуют решения
                  </h3>

                  {newWithdrawals.length > 1 && (
                    <div className="tinkoff-sync__bulk-actions">
                      <span className="tinkoff-sync__bulk-label">Для всех:</span>
                      <button
                        type="button"
                        className="tinkoff-sync__bulk-btn"
                        onClick={() => setAllWithdrawalResolutions('external')}
                      >
                        Внешний
                      </button>
                      <button
                        type="button"
                        className="tinkoff-sync__bulk-btn"
                        onClick={() => setAllWithdrawalResolutions('already_recorded')}
                      >
                        Уже учтено
                      </button>
                      {cashAccounts.length > 0 && (
                        <select
                          className="tinkoff-sync__bulk-select"
                          value=""
                          onChange={(e) => {
                            if (e.target.value) setAllWithdrawalResolutions('transfer', e.target.value);
                          }}
                        >
                          <option value="">Перевод на счёт…</option>
                          {cashAccounts.map((acc) => (
                            <option key={acc.id} value={String(acc.id)}>{acc.name}</option>
                          ))}
                        </select>
                      )}
                    </div>
                  )}

                  {visibleWithdrawals.map(renderWithdrawalCard)}
                  {shouldCompactWithdrawals && (
                    <button
                      type="button"
                      className="tinkoff-sync__show-more"
                      onClick={() => setShowAllWithdrawals((prev) => !prev)}
                    >
                      {showAllWithdrawals
                        ? 'Свернуть список выводов'
                        : `Показать все выводы (${newWithdrawals.length})`}
                    </button>
                  )}
                </section>
              )}

              {totalNewAuto > 0 && (
                <section className="tinkoff-sync__section">
                  <h3 className="tinkoff-sync__section-title">
                    Автоматические операции ({totalNewAuto})
                  </h3>
                  <div className="tinkoff-sync__auto-list">
                    {visibleAutoOperations.map((op) => (
                      <div key={op.tinkoff_op_id} className="tinkoff-sync__auto-item">
                        {op.logo_name && (
                          <img
                            className="instrument-logo instrument-logo--sync"
                            src={getTinkoffInstrumentLogoUrl(op.logo_name)}
                            alt=""
                            loading="lazy"
                          />
                        )}
                        <span className="tinkoff-sync__auto-type">{op.type}</span>
                        <span className="tinkoff-sync__auto-ticker">{op.ticker || op.title || op.figi}</span>
                        <span className="tinkoff-sync__auto-amount">
                          {formatAmount(op.amount, op.currency_code)}
                        </span>
                        <span className="tinkoff-sync__auto-date">{op.date}</span>
                      </div>
                    ))}
                  </div>
                  {shouldCompactAutoOperations && (
                    <button
                      type="button"
                      className="tinkoff-sync__show-more"
                      onClick={() => setShowAllAutoOperations((prev) => !prev)}
                    >
                      {showAllAutoOperations
                        ? 'Свернуть автооперации'
                        : `Показать все автооперации (${totalNewAuto})`}
                    </button>
                  )}
                </section>
              )}

              {totalNew === 0 && (
                <p className="tinkoff-sync__empty">Новых операций нет.</p>
              )}

              {preview.total_already_imported > 0 && (
                <p className="tinkoff-sync__already">
                  Уже импортировано ранее: {preview.total_already_imported}
                </p>
              )}
            </>
          )}
        </div>

        <div className="dialog__footer">
          <button className="btn btn--secondary" onClick={onClose} type="button">
            Отмена
          </button>

          {stage === 'review' && (
            <div className="tinkoff-sync__footer-actions">
              {!allResolved && totalManualNew > 0 && (
                <p className="tinkoff-sync__footer-hint">
                  Осталось выбрать: {unresolvedDepositsCount} пополн. и {unresolvedWithdrawalsCount} вывод.
                </p>
              )}
              <button
                className="btn btn--primary"
                onClick={handleApply}
                type="button"
              >
                Применить {totalNew > 0 ? `${totalNew} опер.` : ''}
              </button>
            </div>
          )}

          {(stage === 'done' || stage === 'error') && (
            <button className="btn btn--primary" onClick={onClose} type="button">
              Закрыть
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
