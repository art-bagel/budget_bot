import { useEffect, useState } from 'react';

import {
  createIncomeSource,
  fetchBankAccounts,
  fetchCurrencies,
  fetchIncomeSourcePattern,
  fetchIncomeSources,
  recordIncome,
  recordIncomeSplit,
  upsertIncomeSourcePattern,
  deleteIncomeSourcePattern,
} from '../api';
import { useModalOpen } from '../hooks/useModalOpen';
import type {
  BankAccount,
  Currency,
  IncomePattern,
  IncomeSource,
  RecordIncomeRequest,
  UserContext,
} from '../types';
import { sanitizeDecimalInput } from '../utils/validation';


interface PatternDraftLine {
  key: string;
  bank_account_id: string;
  percent: string;
}

function createPatternLine(index: number): PatternDraftLine {
  return { key: 'line-' + index, bank_account_id: '', percent: '' };
}

function formatOwnerLabel(ownerType: string): string {
  return ownerType === 'family' ? 'Семейный' : 'Личный';
}


interface Props {
  user: UserContext;
  onClose: () => void;
  onSuccess: () => void;
}


export default function IncomeDialog({ user, onClose, onSuccess }: Props) {
  useModalOpen();
  const [currencies, setCurrencies] = useState<Currency[]>([]);
  const [incomeSources, setIncomeSources] = useState<IncomeSource[]>([]);
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [loading, setLoading] = useState(true);

  const [incomeAmount, setIncomeAmount] = useState('');
  const [incomeCurrencyCode, setIncomeCurrencyCode] = useState(user.base_currency_code);
  const [incomeSourceId, setIncomeSourceId] = useState('');
  const [newIncomeSourceName, setNewIncomeSourceName] = useState('');
  const [incomeBudgetAmountInBase, setIncomeBudgetAmountInBase] = useState('');
  const [incomeTaxPercent, setIncomeTaxPercent] = useState('');
  const [incomeComment, setIncomeComment] = useState('');
  const [incomeDate, setIncomeDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [submitting, setSubmitting] = useState(false);
  const [creatingSource, setCreatingSource] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Pattern state
  const [pattern, setPattern] = useState<IncomePattern | null>(null);
  const [patternLoading, setPatternLoading] = useState(false);
  const [showPatternEditor, setShowPatternEditor] = useState(false);
  const [patternLines, setPatternLines] = useState<PatternDraftLine[]>([createPatternLine(1)]);
  const [savingPattern, setSavingPattern] = useState(false);
  const [deletingPattern, setDeletingPattern] = useState(false);
  const [patternError, setPatternError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([fetchCurrencies(), fetchIncomeSources(), fetchBankAccounts()])
      .then(([loadedCurrencies, loadedSources, loadedAccounts]) => {
        setCurrencies(loadedCurrencies);
        setIncomeSources(loadedSources);
        setBankAccounts(loadedAccounts);
        if (loadedSources.length > 0) {
          setIncomeSourceId(String(loadedSources[0].id));
        }
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  // Load pattern when source changes
  useEffect(() => {
    if (!incomeSourceId) {
      setPattern(null);
      return;
    }
    setPatternLoading(true);
    setPattern(null);
    setShowPatternEditor(false);
    fetchIncomeSourcePattern(Number(incomeSourceId))
      .then((p) => setPattern(p))
      .catch(() => setPattern(null))
      .finally(() => setPatternLoading(false));
  }, [incomeSourceId]);

  const isNonBase = incomeCurrencyCode !== user.base_currency_code;
  const selectedSource = incomeSources.find((s) => String(s.id) === incomeSourceId);
  const hasPattern = pattern !== null;
  const personalAccount = bankAccounts.find((ba) => ba.id === user.bank_account_id);
  const totalAmount = parseFloat(incomeAmount) || 0;
  const taxPercent = parseFloat(incomeTaxPercent) || 0;
  const hasTax = incomeTaxPercent.trim() !== '' && taxPercent > 0;
  const isTaxValid = incomeTaxPercent.trim() === '' || (taxPercent > 0 && taxPercent < 100);
  const taxAmount = hasTax && isTaxValid ? Math.round(totalAmount * taxPercent * 1000000) / 100000000 : 0;
  const distributionAmount = Math.max(0, totalAmount - taxAmount);
  const taxAmountInBase = isNonBase && hasTax && isTaxValid
    ? Math.round((parseFloat(incomeBudgetAmountInBase) || 0) * taxPercent) / 100
    : taxAmount;

  const canSubmit =
    !submitting &&
    !!selectedSource &&
    parseFloat(incomeAmount) > 0 &&
    (!isNonBase || parseFloat(incomeBudgetAmountInBase) > 0) &&
    isTaxValid;

  const handleCreateSource = async () => {
    const name = newIncomeSourceName.trim();
    if (!name) return;

    setCreatingSource(true);
    setError(null);

    try {
      const result = await createIncomeSource(name);
      const created: IncomeSource = {
        id: result.id,
        name,
        is_active: true,
        created_at: new Date().toISOString(),
      };
      setIncomeSources((prev) => [...prev, created]);
      setIncomeSourceId(String(created.id));
      setNewIncomeSourceName('');
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreatingSource(false);
    }
  };

  const handleSubmit = async () => {
    if (!canSubmit || !selectedSource) return;

    setSubmitting(true);
    setError(null);

    try {
      const operatedAt = incomeDate || undefined;

      if (hasPattern) {
        await recordIncomeSplit({
          income_source_id: selectedSource.id,
          amount: totalAmount,
          currency_code: incomeCurrencyCode,
          budget_amount_in_base: isNonBase ? parseFloat(incomeBudgetAmountInBase) : undefined,
          comment: incomeComment.trim() || undefined,
          operated_at: operatedAt,
          tax_percent: hasTax ? taxPercent : undefined,
        });
      } else {
        await recordIncome({
          bank_account_id: user.bank_account_id,
          income_source_id: selectedSource.id,
          amount: totalAmount,
          currency_code: incomeCurrencyCode,
          budget_amount_in_base: isNonBase ? parseFloat(incomeBudgetAmountInBase) : undefined,
          comment: incomeComment.trim() || undefined,
          operated_at: operatedAt,
          tax_percent: hasTax ? taxPercent : undefined,
        } as RecordIncomeRequest);
      }

      onSuccess();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  const openPatternEditor = () => {
    if (pattern) {
      setPatternLines(
        pattern.lines.map((l, i) => ({
          key: 'line-' + i,
          bank_account_id: String(l.bank_account_id),
          percent: String(Math.round(l.share * 10000) / 100),
        })),
      );
    } else {
      // Default: 100% to personal account
      setPatternLines([{
        key: 'line-0',
        bank_account_id: String(user.bank_account_id),
        percent: '100',
      }]);
    }
    setPatternError(null);
    setShowPatternEditor(true);
  };

  const totalPercent = patternLines.reduce((sum, l) => sum + (parseFloat(l.percent) || 0), 0);

  const handleSavePattern = async () => {
    const validLines = patternLines.filter((l) => l.bank_account_id && parseFloat(l.percent) > 0);
    if (validLines.length === 0) {
      setPatternError('Добавьте хотя бы одну строку.');
      return;
    }
    if (Math.abs(totalPercent - 100) > 0.1) {
      setPatternError(`Сумма должна быть 100%, сейчас ${totalPercent.toFixed(2)}%.`);
      return;
    }

    setSavingPattern(true);
    setPatternError(null);
    try {
      const lines = validLines.map((l) => ({
        bank_account_id: Number(l.bank_account_id),
        share: Math.round((parseFloat(l.percent) / 100) * 100000) / 100000,
      }));
      const totalShare = lines.reduce((s, l) => s + l.share, 0);
      lines[lines.length - 1].share = Math.round((lines[lines.length - 1].share + (1 - totalShare)) * 100000) / 100000;

      await upsertIncomeSourcePattern(Number(incomeSourceId), lines);
      const updated = await fetchIncomeSourcePattern(Number(incomeSourceId));
      setPattern(updated);
      setShowPatternEditor(false);
    } catch (e: unknown) {
      setPatternError(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingPattern(false);
    }
  };

  const handleDeletePattern = async () => {
    setDeletingPattern(true);
    try {
      await deleteIncomeSourcePattern(Number(incomeSourceId));
      setPattern(null);
      setShowPatternEditor(false);
    } catch (e: unknown) {
      setPatternError(e instanceof Error ? e.message : String(e));
    } finally {
      setDeletingPattern(false);
    }
  };

  // Lines to display in the summary (real pattern or default personal 100%)
  const displayLines = hasPattern
    ? pattern!.lines.map((l) => ({
        label: `${formatOwnerLabel(l.bank_account_owner_type)} · ${l.bank_account_name}`,
        share: l.share,
      }))
    : [{
        label: `Личный · ${personalAccount?.name ?? 'счёт'}`,
        share: 1,
      }];

  return (
    <div className="modal-backdrop" onClick={() => !submitting && onClose()}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="section__header">
            <div>
              <div className="section__eyebrow">Банк</div>
              <h2 className="section__title">Записать доход</h2>
            </div>
          </div>
        </div>

        <div className="modal-body">
          {loading ? (
            <p className="list-row__sub">Загрузка...</p>
          ) : (
            <>
              {/* New income source creation */}
              <div className="form-row">
                <input
                  className="input"
                  type="text"
                  placeholder="Новый источник дохода"
                  value={newIncomeSourceName}
                  onChange={(e) => setNewIncomeSourceName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleCreateSource()}
                  style={{ flex: 1 }}
                />
                <button
                  className="btn"
                  type="button"
                  disabled={creatingSource || newIncomeSourceName.trim().length === 0}
                  onClick={handleCreateSource}
                >
                  {creatingSource ? '...' : 'Добавить'}
                </button>
              </div>

              {/* Income source selector + pattern summary */}
              <div style={{
                background: 'var(--bg-inset)',
                borderRadius: 18,
                overflow: 'hidden',
                marginBottom: 4,
              }}>
                <select
                  className="input"
                  value={incomeSourceId}
                  onChange={(e) => setIncomeSourceId(e.target.value)}
                  disabled={incomeSources.length === 0}
                  style={{
                    width: '100%',
                    marginBottom: 0,
                    borderLeft: 'none',
                    borderRight: 'none',
                    borderTop: 'none',
                    background: 'var(--bg-inset)',
                  }}
                >
                  {incomeSources.length === 0 ? (
                    <option value="">Сначала создайте источник</option>
                  ) : (
                    incomeSources.map((source) => (
                      <option key={source.id} value={source.id}>
                        {source.name}
                      </option>
                    ))
                  )}
                </select>

                {incomeSourceId && (
                  patternLoading ? (
                    <div style={{ padding: '8px 12px' }}>
                      <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>...</span>
                    </div>
                  ) : showPatternEditor ? (
                    <div style={{ padding: '8px 12px' }}>
                      <div style={{ fontSize: '0.75rem', fontWeight: 600, marginBottom: 6, color: 'var(--text-secondary)' }}>
                        Распределение по счетам
                      </div>

                      {patternLines.map((line) => (
                        <div key={line.key} className="form-row form-row--group-editor" style={{ padding: '2px 0' }}>
                          <select
                            className="input"
                            value={line.bank_account_id}
                            onChange={(e) => setPatternLines((prev) =>
                              prev.map((l) => l.key === line.key ? { ...l, bank_account_id: e.target.value } : l)
                            )}
                            disabled={savingPattern}
                            style={{ fontSize: '0.78rem', padding: '5px 28px 5px 10px' }}
                          >
                            <option value="">Выбери счёт</option>
                            {bankAccounts.map((ba) => (
                              <option key={ba.id} value={ba.id}>
                                {formatOwnerLabel(ba.owner_type)} · {ba.name}
                              </option>
                            ))}
                          </select>

                          <div style={{ position: 'relative', width: 54, flexShrink: 0 }}>
                            <input
                              className="input"
                              type="text"
                              inputMode="decimal"
                              placeholder="0"
                              value={line.percent}
                              onChange={(e) => setPatternLines((prev) =>
                                prev.map((l) => l.key === line.key ? { ...l, percent: sanitizeDecimalInput(e.target.value) } : l)
                              )}
                              disabled={savingPattern}
                              style={{ width: '100%', fontSize: '0.78rem', padding: '5px 18px 5px 8px', textAlign: 'right' }}
                            />
                            <span style={{
                              position: 'absolute', right: 7, top: '50%', transform: 'translateY(-50%)',
                              fontSize: '0.72rem', color: 'var(--text-secondary)', pointerEvents: 'none',
                            }}>%</span>
                          </div>

                          <button
                            className="btn"
                            type="button"
                            onClick={() => setPatternLines((prev) => prev.filter((l) => l.key !== line.key))}
                            disabled={savingPattern || patternLines.length === 1}
                            style={{ fontSize: '0.78rem', padding: '5px 10px' }}
                          >
                            Убрать
                          </button>
                        </div>
                      ))}

                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4, marginBottom: 8 }}>
                        <button
                          className="btn"
                          type="button"
                          onClick={() => setPatternLines((prev) => [...prev, createPatternLine(prev.length + 1)])}
                          disabled={savingPattern}
                          style={{ fontSize: '0.78rem', padding: '5px 10px' }}
                        >
                          + Добавить счёт
                        </button>
                        <span style={{ fontSize: '0.75rem', fontWeight: 600, marginLeft: 'auto',
                          color: Math.abs(totalPercent - 100) < 0.1 ? 'var(--tag-in-fg)' : 'var(--text-secondary)' }}>
                          Итого: {totalPercent.toFixed(0)} / 100%
                        </span>
                      </div>

                      {patternError && (
                        <p style={{ color: 'var(--tag-out-fg)', fontSize: '0.75rem', marginBottom: 6 }}>
                          {patternError}
                        </p>
                      )}

                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        {hasPattern && (
                          <button
                            className="btn btn--danger"
                            type="button"
                            onClick={handleDeletePattern}
                            disabled={savingPattern || deletingPattern}
                            style={{ fontSize: '0.78rem', padding: '5px 10px', marginRight: 'auto' }}
                          >
                            {deletingPattern ? '...' : 'Удалить'}
                          </button>
                        )}
                        <div className="action-pill" style={{ marginLeft: hasPattern ? 0 : 'auto' }}>
                          <button
                            className="action-pill__cancel"
                            type="button"
                            onClick={() => { setShowPatternEditor(false); setPatternError(null); }}
                            disabled={savingPattern}
                            style={{ fontSize: '0.78rem', padding: '5px 12px' }}
                          >
                            Отмена
                          </button>
                          <button
                            className="action-pill__confirm"
                            type="button"
                            onClick={handleSavePattern}
                            style={{ fontSize: '0.78rem', padding: '5px 12px' }}
                            disabled={savingPattern}
                          >
                            {savingPattern ? '...' : 'Сохранить'}
                          </button>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div style={{ padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{ flex: 1, display: 'flex', flexWrap: 'wrap', gap: '2px 10px' }}>
                        {displayLines.map((line, i) => (
                          <span key={i} style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                            {line.label}
                            <span style={{ marginLeft: 4, fontWeight: 600 }}>
                              {Math.round(line.share * 100)}%
                            </span>
                            {totalAmount > 0 && (
                              <span style={{ marginLeft: 4, color: 'var(--text-secondary)' }}>
                                ({(distributionAmount * line.share).toFixed(2)} {incomeCurrencyCode})
                              </span>
                            )}
                          </span>
                        ))}
                      </div>
                      <button type="button" className="btn" onClick={openPatternEditor} disabled={patternLoading}>
                        Изменить
                      </button>
                    </div>
                  )
                )}
              </div>

              {/* Amount + currency */}
              <div className="form-row">
                <input
                  className="input"
                  type="text"
                  inputMode="decimal"
                  placeholder="Сумма"
                  value={incomeAmount}
                  onChange={(e) => setIncomeAmount(sanitizeDecimalInput(e.target.value))}
                  style={{ flex: 1 }}
                />
                <select
                  className="input"
                  value={incomeCurrencyCode}
                  onChange={(e) => setIncomeCurrencyCode(e.target.value)}
                >
                  {currencies.map((currency) => (
                    <option key={currency.code} value={currency.code}>
                      {currency.code}
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-row">
                <input
                  className="input"
                  type="text"
                  inputMode="decimal"
                  placeholder="Налог, %"
                  value={incomeTaxPercent}
                  onChange={(e) => setIncomeTaxPercent(sanitizeDecimalInput(e.target.value))}
                  style={{ flex: 1 }}
                />
                {hasTax && isTaxValid && totalAmount > 0 && (
                  <div style={{
                    flex: 1,
                    fontSize: '0.78rem',
                    color: 'var(--text-secondary)',
                    lineHeight: 1.35,
                  }}>
                    Налог {taxAmount.toFixed(2)} {incomeCurrencyCode}
                    <br />
                    К распределению {distributionAmount.toFixed(2)} {incomeCurrencyCode}
                    {isNonBase && taxAmountInBase > 0 && (
                      <>
                        <br />
                        {taxAmountInBase.toFixed(2)} {user.base_currency_code}
                      </>
                    )}
                  </div>
                )}
              </div>

              {!isTaxValid && (
                <p style={{ color: 'var(--tag-out-fg)', fontSize: '0.85rem', marginTop: 4 }}>
                  Налог должен быть больше 0 и меньше 100%.
                </p>
              )}

              {isNonBase && (
                <div className="form-row">
                  <input
                    className="input"
                    type="text"
                    inputMode="decimal"
                    placeholder={`Стоимость в ${user.base_currency_code}`}
                    value={incomeBudgetAmountInBase}
                    onChange={(e) => setIncomeBudgetAmountInBase(sanitizeDecimalInput(e.target.value))}
                    style={{ flex: 1 }}
                  />
                </div>
              )}

              <div className="form-row">
                <input
                  className="input"
                  type="text"
                  placeholder="Комментарий (необязательно)"
                  value={incomeComment}
                  onChange={(e) => setIncomeComment(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && canSubmit && handleSubmit()}
                  style={{ flex: 1 }}
                />
                <input
                  className="input"
                  type="date"
                  value={incomeDate}
                  onChange={(e) => setIncomeDate(e.target.value)}
                />
              </div>

              {error && (
                <p style={{ color: 'var(--tag-out-fg)', fontSize: '0.85rem', marginTop: 4 }}>
                  {error}
                </p>
              )}
            </>
          )}
        </div>

        <div className="modal-actions">
          <div className="action-pill">
            <button className="action-pill__cancel" type="button" onClick={onClose} disabled={submitting}>
              Отмена
            </button>
            <button className="action-pill__confirm" type="button" disabled={!canSubmit} onClick={handleSubmit}>
              {submitting ? '...' : 'Записать'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
