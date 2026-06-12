import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, AlertTriangle, ArrowDownToLine, ArrowUpFromLine, Check, Info } from 'lucide-react';

import {
  applyTinkoffSync,
  fetchBankAccounts,
  fetchBankAccountSnapshot,
  getTinkoffInstrumentLogoUrl,
  previewTinkoffSync,
} from '../api';
import { useModalOpen } from '../hooks/useModalOpen';
import BottomSheet from './BottomSheet';
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

type ManualTab = 'deposits' | 'withdrawals' | 'auto';


export default function TinkoffSyncDialog({
  connectionId,
  investmentAccountId,
  onClose,
  onSuccess,
}: Props) {
  useModalOpen();

  const [stage, setStage] = useState<'loading' | 'review' | 'applying' | 'done' | 'error'>('loading');
  const [preview, setPreview] = useState<TinkoffPreviewResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [depositStates, setDepositStates] = useState<Record<string, ResolutionState>>({});
  const [withdrawalStates, setWithdrawalStates] = useState<Record<string, ResolutionState>>({});

  const [cashAccounts, setCashAccounts] = useState<BankAccount[]>([]);
  const [accountBalances, setAccountBalances] = useState<Record<number, DashboardBankBalance[]>>({});
  const [investmentBalances, setInvestmentBalances] = useState<DashboardBankBalance[]>([]);

  const [applyResult, setApplyResult] = useState<{ applied: number; skipped: number } | null>(null);
  const [showAllDeposits, setShowAllDeposits] = useState(false);
  const [showAllWithdrawals, setShowAllWithdrawals] = useState(false);
  const [showAllAutoOperations, setShowAllAutoOperations] = useState(false);
  const [activeTab, setActiveTab] = useState<ManualTab>('deposits');
  const [applyWarning, setApplyWarning] = useState<string | null>(null);

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

        const newDepCount = previewData.deposits.filter((d) => !d.already_imported).length;
        const newWdCount = previewData.withdrawals.filter((w) => !w.already_imported).length;
        const newAutoCount = previewData.auto_operations.filter((o) => !o.already_imported).length;
        setActiveTab(newDepCount > 0 ? 'deposits' : newWdCount > 0 ? 'withdrawals' : newAutoCount > 0 ? 'auto' : 'deposits');
        setApplyWarning(null);

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
    setDepositStates((prev) => ({ ...prev, [opId]: { ...prev[opId], accountId } }));
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
    setWithdrawalStates((prev) => ({ ...prev, [opId]: { ...prev[opId], accountId } }));
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

  const newDeposits = useMemo(() => preview?.deposits.filter((d) => !d.already_imported) ?? [], [preview]);
  const newWithdrawals = useMemo(() => preview?.withdrawals.filter((w) => !w.already_imported) ?? [], [preview]);
  const newAutoOperations = useMemo(
    () => (preview?.auto_operations ?? []).filter((o) => !o.already_imported),
    [preview],
  );

  const alreadyRecordedBalanceOk = (deposit: TinkoffDepositPreview): boolean => {
    const bal = getInvestmentBalance(deposit.currency_code);
    return bal === null || bal >= deposit.amount;
  };

  const isDepositResolved = (d: TinkoffDepositPreview): boolean => {
    const s = depositStates[d.tinkoff_op_id];
    if (!s || s.resolution === '') return false;
    if (s.resolution === 'transfer' && !s.accountId) return false;
    if (s.resolution === 'already_recorded' && !alreadyRecordedBalanceOk(d)) return false;
    return true;
  };
  const isWithdrawalResolved = (w: TinkoffDepositPreview): boolean => {
    const s = withdrawalStates[w.tinkoff_op_id];
    if (!s || s.resolution === '') return false;
    if (s.resolution === 'transfer' && !s.accountId) return false;
    return true;
  };

  const depositsResolved = newDeposits.every(isDepositResolved);
  const withdrawalsResolved = newWithdrawals.every(isWithdrawalResolved);
  const allResolved = depositsResolved && withdrawalsResolved;
  const unresolvedDepositsCount = newDeposits.filter((d) => !isDepositResolved(d)).length;
  const unresolvedWithdrawalsCount = newWithdrawals.filter((w) => !isWithdrawalResolved(w)).length;

  const totalNewAuto = newAutoOperations.length;
  const totalManualNew = newDeposits.length + newWithdrawals.length;
  const totalNew = totalManualNew + totalNewAuto;
  const totalAlreadyImported = preview?.total_already_imported ?? 0;

  const shouldCompactDeposits = newDeposits.length > 24;
  const shouldCompactWithdrawals = newWithdrawals.length > 12;
  const shouldCompactAutoOperations = totalNewAuto > 40;
  const visibleDeposits = shouldCompactDeposits && !showAllDeposits ? newDeposits.slice(0, 12) : newDeposits;
  const visibleWithdrawals = shouldCompactWithdrawals && !showAllWithdrawals ? newWithdrawals.slice(0, 8) : newWithdrawals;
  const visibleAutoOperations = shouldCompactAutoOperations && !showAllAutoOperations
    ? newAutoOperations.slice(0, 24)
    : newAutoOperations;

  const renderShowMoreButton = (expanded: boolean, total: number, noun: string, onClick: () => void) => (
    <button
      type="button"
      className="tk-show-more"
      onClick={onClick}
      aria-expanded={expanded}
    >
      {expanded ? `Свернуть ${noun}` : `Показать все ${noun} (${total})`}
    </button>
  );

  const setAllDepositResolutions = (resolution: DepositResolutionKind, accountId = '') => {
    const next: Record<string, ResolutionState> = {};
    for (const d of newDeposits) next[d.tinkoff_op_id] = { resolution, accountId };
    setDepositStates((prev) => ({ ...prev, ...next }));
    setApplyWarning(null);
  };
  const setAllWithdrawalResolutions = (resolution: WithdrawalResolutionKind, accountId = '') => {
    const next: Record<string, ResolutionState> = {};
    for (const w of newWithdrawals) next[w.tinkoff_op_id] = { resolution, accountId };
    setWithdrawalStates((prev) => ({ ...prev, ...next }));
    setApplyWarning(null);
  };

  const handleApply = async () => {
    if (!preview) return;
    if (!allResolved && totalManualNew > 0) {
      if (unresolvedDepositsCount > 0) setActiveTab('deposits');
      else if (unresolvedWithdrawalsCount > 0) setActiveTab('withdrawals');
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

  // ── Resolution card renderers ─────────────────────────────────────────────

  const renderDepositCard = (deposit: TinkoffDepositPreview) => {
    const state = depositStates[deposit.tinkoff_op_id];
    if (!state) return null;

    const resolved = isDepositResolved(deposit);
    const investBal = getInvestmentBalance(deposit.currency_code);
    const investEnough = investBal === null || investBal >= deposit.amount;

    return (
      <article
        key={deposit.tinkoff_op_id}
        className={`tk-op${!resolved ? ' tk-op--unresolved' : ''}`}
      >
        <header className="tk-op__head">
          <div className="tk-op__head-l">
            <span className="tk-op__date">{deposit.date}</span>
            <h4 className="tk-op__title">Пополнение</h4>
          </div>
          <span className="tk-op__amt tk-op__amt--in">
            +{formatAmount(deposit.amount, deposit.currency_code)}
          </span>
        </header>
        <div className="tk-op__body">
          <p className="tk-op__hint">Откуда пришли деньги?</p>
          <div className="tk-res">
            <label className={`tk-res__opt${state.resolution === 'external' ? ' tk-res__opt--on' : ''}`}>
              <input
                type="radio"
                name={`dep-${deposit.tinkoff_op_id}`}
                checked={state.resolution === 'external'}
                onChange={() => setDepositResolution(deposit.tinkoff_op_id, 'external')}
              />
              <span className="tk-res__bullet" />
              <span className="tk-res__text">
                <strong>Внешнее пополнение</strong>
                <em>деньги пришли извне, не из других счетов в боте</em>
              </span>
            </label>

            <label className={`tk-res__opt${state.resolution === 'transfer' ? ' tk-res__opt--on' : ''}`}>
              <input
                type="radio"
                name={`dep-${deposit.tinkoff_op_id}`}
                checked={state.resolution === 'transfer'}
                onChange={() => setDepositResolution(deposit.tinkoff_op_id, 'transfer')}
              />
              <span className="tk-res__bullet" />
              <span className="tk-res__text">
                <strong>Перевод со счёта</strong>
                {state.resolution === 'transfer' && (
                  <div className="tk-res__detail">
                    <select
                      className="tk-res__select"
                      value={state.accountId}
                      onChange={(e) => setDepositSourceAccount(deposit.tinkoff_op_id, e.target.value)}
                    >
                      <option value="">— Выберите счёт —</option>
                      {cashAccounts.map((acc) => {
                        const bal = getAccountBalance(acc.id, deposit.currency_code);
                        const enough = bal !== null && bal >= deposit.amount;
                        return (
                          <option key={acc.id} value={String(acc.id)}>
                            {acc.name}
                            {bal !== null
                              ? ` · ${formatAmount(bal, deposit.currency_code)}${enough ? '' : ' ⚠'}`
                              : ''}
                          </option>
                        );
                      })}
                    </select>
                    {state.accountId && (() => {
                      const bal = getAccountBalance(Number(state.accountId), deposit.currency_code);
                      const enough = bal !== null && bal >= deposit.amount;
                      if (!enough && bal !== null) {
                        return (
                          <p className="tk-res__warn">
                            <AlertTriangle strokeWidth={2} />
                            Недостаточно средств на счёте ({formatAmount(bal, deposit.currency_code)})
                          </p>
                        );
                      }
                      return null;
                    })()}
                  </div>
                )}
              </span>
            </label>

            <label className={`tk-res__opt${state.resolution === 'already_recorded' ? ' tk-res__opt--on' : ''}`}>
              <input
                type="radio"
                name={`dep-${deposit.tinkoff_op_id}`}
                checked={state.resolution === 'already_recorded'}
                onChange={() => setDepositResolution(deposit.tinkoff_op_id, 'already_recorded')}
              />
              <span className="tk-res__bullet" />
              <span className="tk-res__text">
                <strong>Уже учтено в боте</strong>
                {investBal !== null && (
                  <em className="tk-res__balance-hint">
                    на инвест-счёте: {formatAmount(investBal, deposit.currency_code)}
                  </em>
                )}
                {state.resolution === 'already_recorded' && !investEnough && (
                  <div className="tk-res__detail">
                    <p className="tk-res__warn">
                      <AlertTriangle strokeWidth={2} />
                      На инвест-счёте недостаточно средств — деньги там ещё не учтены
                      {investBal !== null && ` (есть ${formatAmount(investBal, deposit.currency_code)})`}
                    </p>
                  </div>
                )}
              </span>
            </label>
          </div>
        </div>
      </article>
    );
  };

  const renderWithdrawalCard = (withdrawal: TinkoffDepositPreview) => {
    const state = withdrawalStates[withdrawal.tinkoff_op_id];
    if (!state) return null;
    const resolved = isWithdrawalResolved(withdrawal);

    return (
      <article
        key={withdrawal.tinkoff_op_id}
        className={`tk-op${!resolved ? ' tk-op--unresolved' : ''}`}
      >
        <header className="tk-op__head">
          <div className="tk-op__head-l">
            <span className="tk-op__date">{withdrawal.date}</span>
            <h4 className="tk-op__title">Вывод</h4>
          </div>
          <span className="tk-op__amt tk-op__amt--out">
            −{formatAmount(withdrawal.amount, withdrawal.currency_code)}
          </span>
        </header>
        <div className="tk-op__body">
          <p className="tk-op__hint">Куда ушли деньги?</p>
          <div className="tk-res">
            <label className={`tk-res__opt${state.resolution === 'external' ? ' tk-res__opt--on' : ''}`}>
              <input
                type="radio"
                name={`wd-${withdrawal.tinkoff_op_id}`}
                checked={state.resolution === 'external'}
                onChange={() => setWithdrawalResolution(withdrawal.tinkoff_op_id, 'external')}
              />
              <span className="tk-res__bullet" />
              <span className="tk-res__text">
                <strong>Внешний вывод</strong>
                <em>деньги ушли наружу, не на другой счёт в боте</em>
              </span>
            </label>

            <label className={`tk-res__opt${state.resolution === 'transfer' ? ' tk-res__opt--on' : ''}`}>
              <input
                type="radio"
                name={`wd-${withdrawal.tinkoff_op_id}`}
                checked={state.resolution === 'transfer'}
                onChange={() => setWithdrawalResolution(withdrawal.tinkoff_op_id, 'transfer')}
              />
              <span className="tk-res__bullet" />
              <span className="tk-res__text">
                <strong>Перевод на счёт</strong>
                {state.resolution === 'transfer' && (
                  <div className="tk-res__detail">
                    <select
                      className="tk-res__select"
                      value={state.accountId}
                      onChange={(e) => setWithdrawalTargetAccount(withdrawal.tinkoff_op_id, e.target.value)}
                    >
                      <option value="">— Выберите счёт —</option>
                      {cashAccounts.map((acc) => {
                        const bal = getAccountBalance(acc.id, withdrawal.currency_code);
                        return (
                          <option key={acc.id} value={String(acc.id)}>
                            {acc.name}
                            {bal !== null ? ` · ${formatAmount(bal, withdrawal.currency_code)}` : ''}
                          </option>
                        );
                      })}
                    </select>
                  </div>
                )}
              </span>
            </label>

            <label className={`tk-res__opt${state.resolution === 'already_recorded' ? ' tk-res__opt--on' : ''}`}>
              <input
                type="radio"
                name={`wd-${withdrawal.tinkoff_op_id}`}
                checked={state.resolution === 'already_recorded'}
                onChange={() => setWithdrawalResolution(withdrawal.tinkoff_op_id, 'already_recorded')}
              />
              <span className="tk-res__bullet" />
              <span className="tk-res__text">
                <strong>Уже учтено в боте</strong>
              </span>
            </label>
          </div>
        </div>
      </article>
    );
  };

  // ── Footer actions ────────────────────────────────────────────────────────

  const renderFooterActions = () => {
    if (stage === 'review') {
      const hintParts: string[] = [];
      if (unresolvedDepositsCount > 0) hintParts.push(`${unresolvedDepositsCount} пополн.`);
      if (unresolvedWithdrawalsCount > 0) hintParts.push(`${unresolvedWithdrawalsCount} вывод.`);

      return (
        <div className="tk-foot pf-sheet-actions">
          {!allResolved && totalManualNew > 0 && (
            <div className="tk-foot__hint">
              <Info strokeWidth={2} />
              <span>Осталось разобрать: <strong>{hintParts.join(', ')}</strong></span>
            </div>
          )}
          {applyWarning && (
            <div className="tk-error">
              <AlertCircle strokeWidth={2} />
              <span>{applyWarning}</span>
            </div>
          )}
          <div className="tk-foot__row">
            <button className="btn btn--ghost" onClick={onClose} type="button">Отмена</button>
            <button className="btn btn--primary" onClick={handleApply} type="button">
              Применить{totalNew > 0 ? ` ${totalNew}` : ''}
            </button>
          </div>
        </div>
      );
    }

    if (stage === 'done' || stage === 'error') {
      return (
        <div className="tk-foot pf-sheet-actions">
          <div className="tk-foot__row">
            <button className="btn btn--primary" onClick={onClose} type="button">Закрыть</button>
          </div>
        </div>
      );
    }

    if (stage === 'applying') {
      return (
        <div className="tk-foot pf-sheet-actions">
          <div className="tk-foot__row">
            <button className="btn btn--ghost" disabled type="button">Применяем…</button>
          </div>
        </div>
      );
    }
    return null;
  };

  return (
    <BottomSheet
      open
      tag="Тинькофф · Брокер"
      title="Подтянуть операции"
      onClose={onClose}
      actions={renderFooterActions()}
    >
      {stage === 'loading' && (
        <div className="tk-state">
          <div className="tk-state__spinner" />
          <div className="tk-state__title">Загружаем операции…</div>
          <div className="tk-state__sub">Запрашиваем у Тинькофф последние движения по счёту.</div>
        </div>
      )}

      {stage === 'applying' && (
        <div className="tk-state">
          <div className="tk-state__spinner" />
          <div className="tk-state__title">Применяем операции…</div>
          <div className="tk-state__sub">Записываем выбранные движения и обновляем балансы.</div>
        </div>
      )}

      {stage === 'error' && (
        <div className="tk-state tk-state--error">
          <div className="tk-state__seal--err">
            <AlertCircle size={26} strokeWidth={2} />
          </div>
          <div className="tk-state__title">Не получилось применить</div>
          <div className="tk-state__sub">{error ?? 'Неизвестная ошибка'}</div>
          <div className="tk-state__sub">Никакие данные не были изменены.</div>
        </div>
      )}

      {stage === 'done' && applyResult && (
        <div className="tk-done">
          <div className="tk-done__seal">
            <Check size={34} strokeWidth={3} />
          </div>
          <h3 className="tk-done__title">Готово</h3>
          <p className="tk-done__sub">
            Применено операций: <strong>{applyResult.applied}</strong>
            {applyResult.skipped > 0 && <> · пропущено уже импортированных: <strong>{applyResult.skipped}</strong></>}
          </p>
        </div>
      )}

      {stage === 'review' && preview && (
        <>
          <div className="tk-sum">
            <div className="tk-sum__cell">
              <span className="tk-sum__label">Всего</span>
              <span className="tk-sum__val">{totalNew}</span>
            </div>
            <div className="tk-sum__div" />
            <div className="tk-sum__cell">
              <span className="tk-sum__label">Ручных</span>
              <span className={`tk-sum__val${totalManualNew > 0 ? ' tk-sum__val--accent' : ''}`}>
                {totalManualNew}
              </span>
            </div>
            <div className="tk-sum__div" />
            <div className="tk-sum__cell">
              <span className="tk-sum__label">Уже было</span>
              <span className="tk-sum__val tk-sum__val--mute">{totalAlreadyImported}</span>
            </div>
          </div>

          {totalNew === 0 && (
            <div className="tk-state">
              <div className="tk-state__title">Новых операций нет</div>
              <div className="tk-state__sub">
                {totalAlreadyImported > 0
                  ? `Все ${totalAlreadyImported} операций уже импортированы ранее.`
                  : 'Похоже, по этому счёту движений ещё не было.'}
              </div>
            </div>
          )}

          {totalNew > 0 && (
            <>
              {totalManualNew > 0 && (
                <div className="tk-hint">
                  <Info className="tk-hint__ico" strokeWidth={2} />
                  <span>
                    Нужно разобрать ручные движения перед импортом.
                    {newWithdrawals.length > 0 && newDeposits.length > 0 && ' Под счётом есть и пополнения, и выводы.'}
                  </span>
                </div>
              )}

              <nav className="tk-tabs" role="tablist" aria-label="Группы операций">
                {newDeposits.length > 0 && (
                  <button
                    type="button"
                    role="tab"
                    aria-selected={activeTab === 'deposits'}
                    className={`tk-tabs__btn${activeTab === 'deposits' ? ' is-active' : ''}`}
                    onClick={() => setActiveTab('deposits')}
                  >
                    Вводы
                    <span className={`tk-tabs__badge${unresolvedDepositsCount > 0 ? ' tk-tabs__badge--warn' : ''}`}>
                      {newDeposits.length}
                    </span>
                  </button>
                )}
                {newWithdrawals.length > 0 && (
                  <button
                    type="button"
                    role="tab"
                    aria-selected={activeTab === 'withdrawals'}
                    className={`tk-tabs__btn${activeTab === 'withdrawals' ? ' is-active' : ''}`}
                    onClick={() => setActiveTab('withdrawals')}
                  >
                    Выводы
                    <span className={`tk-tabs__badge${unresolvedWithdrawalsCount > 0 ? ' tk-tabs__badge--warn' : ''}`}>
                      {newWithdrawals.length}
                    </span>
                  </button>
                )}
                {totalNewAuto > 0 && (
                  <button
                    type="button"
                    role="tab"
                    aria-selected={activeTab === 'auto'}
                    className={`tk-tabs__btn${activeTab === 'auto' ? ' is-active' : ''}`}
                    onClick={() => setActiveTab('auto')}
                  >
                    Авто
                    <span className="tk-tabs__badge">{totalNewAuto}</span>
                  </button>
                )}
              </nav>

              {activeTab === 'deposits' && newDeposits.length > 0 && (
                <>
                  {newDeposits.length > 1 && (
                    <div className="tk-bulk">
                      <span className="tk-bulk__label">Для всех:</span>
                      <button
                        type="button"
                        className="tk-bulk__btn"
                        onClick={() => setAllDepositResolutions('external')}
                      >
                        <ArrowDownToLine size={13} strokeWidth={2} style={{ display: 'inline', marginRight: 4, verticalAlign: '-2px' }} />
                        Внешнее
                      </button>
                      <button
                        type="button"
                        className="tk-bulk__btn"
                        onClick={() => setAllDepositResolutions('already_recorded')}
                      >
                        <Check size={13} strokeWidth={2.5} style={{ display: 'inline', marginRight: 4, verticalAlign: '-2px' }} />
                        Уже учтено
                      </button>
                      {cashAccounts.length > 0 && (
                        <select
                          className="tk-bulk__select"
                          aria-label="Выбрать счёт для всех пополнений"
                          value=""
                          onChange={(e) => {
                            if (e.target.value) setAllDepositResolutions('transfer', e.target.value);
                            e.target.value = '';
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
                  {shouldCompactDeposits && renderShowMoreButton(
                    showAllDeposits,
                    newDeposits.length,
                    'пополнения',
                    () => setShowAllDeposits((v) => !v),
                  )}
                  {visibleDeposits.map(renderDepositCard)}
                </>
              )}

              {activeTab === 'withdrawals' && newWithdrawals.length > 0 && (
                <>
                  {newWithdrawals.length > 1 && (
                    <div className="tk-bulk">
                      <span className="tk-bulk__label">Для всех:</span>
                      <button
                        type="button"
                        className="tk-bulk__btn"
                        onClick={() => setAllWithdrawalResolutions('external')}
                      >
                        <ArrowUpFromLine size={13} strokeWidth={2} style={{ display: 'inline', marginRight: 4, verticalAlign: '-2px' }} />
                        Внешний
                      </button>
                      <button
                        type="button"
                        className="tk-bulk__btn"
                        onClick={() => setAllWithdrawalResolutions('already_recorded')}
                      >
                        <Check size={13} strokeWidth={2.5} style={{ display: 'inline', marginRight: 4, verticalAlign: '-2px' }} />
                        Уже учтено
                      </button>
                      {cashAccounts.length > 0 && (
                        <select
                          className="tk-bulk__select"
                          aria-label="Выбрать счёт для всех выводов"
                          value=""
                          onChange={(e) => {
                            if (e.target.value) setAllWithdrawalResolutions('transfer', e.target.value);
                            e.target.value = '';
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
                  {shouldCompactWithdrawals && renderShowMoreButton(
                    showAllWithdrawals,
                    newWithdrawals.length,
                    'выводы',
                    () => setShowAllWithdrawals((v) => !v),
                  )}
                  {visibleWithdrawals.map(renderWithdrawalCard)}
                </>
              )}

              {activeTab === 'auto' && totalNewAuto > 0 && (
                <>
                  <p className="tk-muted">
                    Эти операции применятся автоматически — здесь только список для контроля.
                  </p>
                  {shouldCompactAutoOperations && renderShowMoreButton(
                    showAllAutoOperations,
                    totalNewAuto,
                    'автооперации',
                    () => setShowAllAutoOperations((v) => !v),
                  )}
                  <ul className="tk-auto-list">
                    {visibleAutoOperations.map((op) => (
                      <li key={op.tinkoff_op_id} className="tk-auto-row">
                        <span className="tk-auto-row__ico">
                          {op.logo_name
                            ? <img src={getTinkoffInstrumentLogoUrl(op.logo_name)} alt="" loading="lazy" />
                            : <Check strokeWidth={2} />}
                        </span>
                        <div className="tk-auto-row__main">
                          <span className="tk-auto-row__type">{op.type}</span>
                          <span className="tk-auto-row__title">
                            {op.ticker || op.title || op.figi}
                          </span>
                        </div>
                        <div className="tk-auto-row__meta">
                          <span className={`tk-auto-row__amt${op.amount > 0 ? ' tk-op__amt--in' : ''}`}>
                            {op.amount > 0 ? '+' : ''}{formatAmount(op.amount, op.currency_code)}
                          </span>
                          <span className="tk-auto-row__date">{op.date}</span>
                        </div>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </>
          )}
        </>
      )}
    </BottomSheet>
  );
}
