import { useEffect, useState } from 'react';

import { applyTinkoffSync, fetchBankAccounts, fetchBankAccountSnapshot, previewTinkoffSync } from '../api';
import { useModalOpen } from '../hooks/useModalOpen';
import type {
  BankAccount,
  DashboardBankBalance,
  DepositResolution,
  DepositResolutionKind,
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

interface DepositState {
  resolution: DepositResolutionKind | '';
  sourceAccountId: string;
}


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

  // Per-deposit resolution state keyed by tinkoff_op_id
  const [depositStates, setDepositStates] = useState<Record<string, DepositState>>({});

  // Cash accounts for "transfer" resolution
  const [cashAccounts, setCashAccounts] = useState<BankAccount[]>([]);
  const [accountBalances, setAccountBalances] = useState<Record<number, DashboardBankBalance[]>>({});

  // Investment account balances for "already_recorded" validation
  const [investmentBalances, setInvestmentBalances] = useState<DashboardBankBalance[]>([]);

  const [applyResult, setApplyResult] = useState<{ applied: number; skipped: number } | null>(null);

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
        const states: Record<string, DepositState> = {};
        for (const d of previewData.deposits) {
          if (!d.already_imported) {
            states[d.tinkoff_op_id] = { resolution: '', sourceAccountId: '' };
          }
        }
        setDepositStates(states);

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

  const setResolution = (opId: string, resolution: DepositResolutionKind) => {
    setDepositStates((prev) => ({
      ...prev,
      [opId]: { ...prev[opId], resolution, sourceAccountId: prev[opId]?.sourceAccountId ?? '' },
    }));
  };

  const setSourceAccount = (opId: string, accountId: string) => {
    setDepositStates((prev) => ({
      ...prev,
      [opId]: { ...prev[opId], sourceAccountId: accountId },
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

  // Check if any "already_recorded" choice would fail balance check
  const alreadyRecordedBalanceOk = (deposit: TinkoffDepositPreview): boolean => {
    const bal = getInvestmentBalance(deposit.currency_code);
    return bal === null || bal >= deposit.amount;
  };

  const allResolved = newDeposits.every((d) => {
    const s = depositStates[d.tinkoff_op_id];
    if (!s || s.resolution === '') return false;
    if (s.resolution === 'transfer' && !s.sourceAccountId) return false;
    if (s.resolution === 'already_recorded' && !alreadyRecordedBalanceOk(d)) return false;
    return true;
  });

  const totalNewAuto = (preview?.auto_operations ?? []).filter((o) => !o.already_imported).length;
  const totalNew = newDeposits.length + totalNewAuto;

  const setAllResolutions = (resolution: DepositResolutionKind, sourceAccountId = '') => {
    const next: Record<string, DepositState> = {};
    for (const d of newDeposits) {
      next[d.tinkoff_op_id] = { resolution, sourceAccountId };
    }
    setDepositStates((prev) => ({ ...prev, ...next }));
  };

  const handleApply = async () => {
    if (!preview) return;
    setStage('applying');

    const resolutions: DepositResolution[] = newDeposits.map((d) => {
      const s = depositStates[d.tinkoff_op_id];
      return {
        tinkoff_op_id: d.tinkoff_op_id,
        resolution: s.resolution as DepositResolutionKind,
        source_account_id: s.resolution === 'transfer' ? Number(s.sourceAccountId) : null,
      };
    });

    try {
      const result = await applyTinkoffSync(connectionId, resolutions);
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
              onChange={() => setResolution(deposit.tinkoff_op_id, 'external')}
            />
            <span>Внешнее пополнение</span>
          </label>

          <label className="tinkoff-deposit-card__option">
            <input
              type="radio"
              name={`resolution-${deposit.tinkoff_op_id}`}
              checked={state.resolution === 'transfer'}
              onChange={() => setResolution(deposit.tinkoff_op_id, 'transfer')}
            />
            <span>Перевод со счёта</span>
          </label>

          {state.resolution === 'transfer' && (
            <div className="tinkoff-deposit-card__transfer-detail">
              <select
                value={state.sourceAccountId}
                onChange={(e) => setSourceAccount(deposit.tinkoff_op_id, e.target.value)}
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
              {state.sourceAccountId && (() => {
                const bal = getAccountBalance(Number(state.sourceAccountId), deposit.currency_code);
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
              onChange={() => setResolution(deposit.tinkoff_op_id, 'already_recorded')}
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

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <div className="dialog__header">
          <h2 className="dialog__title">Подтянуть данные из Тинькофф</h2>
          <button className="dialog__close" onClick={onClose} type="button">✕</button>
        </div>

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
              {newDeposits.length > 0 && (
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
                        onClick={() => setAllResolutions('external')}
                      >
                        Внешнее
                      </button>
                      <button
                        type="button"
                        className="tinkoff-sync__bulk-btn"
                        onClick={() => setAllResolutions('already_recorded')}
                      >
                        Уже учтено
                      </button>
                      {cashAccounts.length > 0 && (
                        <select
                          className="tinkoff-sync__bulk-select"
                          value=""
                          onChange={(e) => {
                            if (e.target.value) setAllResolutions('transfer', e.target.value);
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

                  {newDeposits.map(renderDepositCard)}
                </section>
              )}

              {totalNewAuto > 0 && (
                <section className="tinkoff-sync__section">
                  <h3 className="tinkoff-sync__section-title">
                    Автоматические операции ({totalNewAuto})
                  </h3>
                  <div className="tinkoff-sync__auto-list">
                    {preview.auto_operations
                      .filter((o) => !o.already_imported)
                      .map((op) => (
                        <div key={op.tinkoff_op_id} className="tinkoff-sync__auto-item">
                          <span className="tinkoff-sync__auto-type">{op.type}</span>
                          <span className="tinkoff-sync__auto-ticker">{op.ticker || op.title || op.figi}</span>
                          <span className="tinkoff-sync__auto-amount">
                            {formatAmount(op.amount, op.currency_code)}
                          </span>
                          <span className="tinkoff-sync__auto-date">{op.date}</span>
                        </div>
                      ))}
                  </div>
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
            <button
              className="btn btn--primary"
              onClick={handleApply}
              disabled={!allResolved && newDeposits.length > 0}
              type="button"
            >
              Применить {totalNew > 0 ? `${totalNew} опер.` : ''}
            </button>
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
