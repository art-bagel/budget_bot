import { useEffect, useRef, useState } from 'react';
import BottomSheet from './BottomSheet';
import { ChevronDown, Plus } from 'lucide-react';
import type { Currency } from '../types';


function CurrencyPicker({ currencies, value, onChange }: { currencies: Currency[]; value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div ref={ref} style={{ position: 'relative', flexShrink: 0 }}>
      <button type="button" className="amt__cur-btn" onClick={() => setOpen((v) => !v)}>
        {value}
        <ChevronDown size={12} strokeWidth={2.5} />
      </button>
      {open && (
        <div className="cur-drop">
          {currencies.map((c) => (
            <button
              key={c.code}
              type="button"
              className={`cur-drop__item${c.code === value ? ' cur-drop__item--on' : ''}`}
              onClick={() => { onChange(c.code); setOpen(false); }}
            >
              {c.code}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

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
  const [showAddSource, setShowAddSource] = useState(false);
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

  const addSourceInputRef = useRef<HTMLInputElement>(null);

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

  useEffect(() => {
    if (showAddSource) {
      requestAnimationFrame(() => addSourceInputRef.current?.focus());
    }
  }, [showAddSource]);

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
      const created: IncomeSource = { id: result.id, name, is_active: true, created_at: new Date().toISOString() };
      setIncomeSources((prev) => [...prev, created]);
      setIncomeSourceId(String(created.id));
      setNewIncomeSourceName('');
      setShowAddSource(false);
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
      setPatternLines([{ key: 'line-0', bank_account_id: String(user.bank_account_id), percent: '100' }]);
    }
    setPatternError(null);
    setShowPatternEditor(true);
  };

  const totalPercent = patternLines.reduce((sum, l) => sum + (parseFloat(l.percent) || 0), 0);

  const handleSavePattern = async () => {
    const validLines = patternLines.filter((l) => l.bank_account_id && parseFloat(l.percent) > 0);
    if (validLines.length === 0) { setPatternError('Добавьте хотя бы одну строку.'); return; }
    if (Math.abs(totalPercent - 100) > 0.1) { setPatternError(`Сумма должна быть 100%, сейчас ${totalPercent.toFixed(2)}%.`); return; }
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

  const displayLines = hasPattern
    ? pattern!.lines.map((l) => ({
        label: `${formatOwnerLabel(l.bank_account_owner_type)} · ${l.bank_account_name}`,
        share: l.share,
      }))
    : [{ label: `Личный · ${personalAccount?.name ?? 'счёт'}`, share: 1 }];

  return (
    <BottomSheet
      open
      tag="Приход"
      title="Пополнить счёт"
      icon={<Plus size={22} strokeWidth={2} />}
      iconColor="g"
      onClose={() => !submitting && onClose()}
      actions={
        <>
          <button className="sh-btn sh-btn--ghost" type="button" onClick={onClose} disabled={submitting}>
            Отмена
          </button>
          <button className="sh-btn sh-btn--primary" type="button" disabled={!canSubmit} onClick={handleSubmit}>
            {submitting ? '...' : 'Добавить доход'}
          </button>
        </>
      }
    >
      {loading ? (
        <p className="dlg-hint">Загрузка...</p>
      ) : (
        <>
          {/* ── Источник дохода ── */}
          <div className="field">
            <span className="fl">Источник дохода</span>

            <div className="seg-src">
              {incomeSources.map((source) => (
                <button
                  key={source.id}
                  type="button"
                  className={`seg-src__o${incomeSourceId === String(source.id) ? ' seg-src__o--on' : ''}`}
                  onClick={() => { setIncomeSourceId(String(source.id)); setShowAddSource(false); }}
                  disabled={submitting}
                >
                  {source.name}
                </button>
              ))}
              {incomeSources.length === 0 && (
                <span style={{ padding: '8px 10px', fontSize: 13, color: 'var(--text-3)' }}>
                  Добавьте первый источник →
                </span>
              )}
              {!showAddSource && (
                <button
                  type="button"
                  className="seg-src__add"
                  onClick={() => setShowAddSource(true)}
                  disabled={submitting}
                >
                  <Plus size={13} strokeWidth={2.5} />
                  Новый
                </button>
              )}
            </div>

            {/* Inline add-source form */}
            {showAddSource && (
              <div className="src-add-row">
                <input
                  ref={addSourceInputRef}
                  className="src-add-row__inp"
                  type="text"
                  placeholder="Название источника"
                  value={newIncomeSourceName}
                  onChange={(e) => setNewIncomeSourceName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleCreateSource();
                    if (e.key === 'Escape') { setShowAddSource(false); setNewIncomeSourceName(''); }
                  }}
                  disabled={creatingSource}
                />
                <button
                  className="dlg-add-btn"
                  type="button"
                  disabled={creatingSource || !newIncomeSourceName.trim()}
                  onClick={handleCreateSource}
                >
                  {creatingSource ? '...' : 'Добавить'}
                </button>
                <button
                  type="button"
                  style={{ color: 'var(--text-3)', fontSize: 18, lineHeight: 1 }}
                  onClick={() => { setShowAddSource(false); setNewIncomeSourceName(''); }}
                >
                  ×
                </button>
              </div>
            )}

            {/* Distribution area */}
            {incomeSourceId && (
              <div className="src-dist">
                {patternLoading ? (
                  <div className="src-dist__row">
                    <span className="src-dist__label" style={{ color: 'var(--text-3)' }}>...</span>
                  </div>
                ) : showPatternEditor ? (
                  <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <span className="fl">Распределение по счетам</span>

                    {patternLines.map((line) => (
                      <div key={line.key} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                        <select
                          className="pat-sel"
                          value={line.bank_account_id}
                          onChange={(e) => setPatternLines((prev) =>
                            prev.map((l) => l.key === line.key ? { ...l, bank_account_id: e.target.value } : l)
                          )}
                          disabled={savingPattern}
                        >
                          <option value="">Выбери счёт</option>
                          {bankAccounts.map((ba) => (
                            <option key={ba.id} value={ba.id}>
                              {formatOwnerLabel(ba.owner_type)} · {ba.name}
                            </option>
                          ))}
                        </select>
                        <div style={{ position: 'relative', flexShrink: 0 }}>
                          <input
                            className="pat-pct"
                            type="text"
                            inputMode="decimal"
                            placeholder="0"
                            value={line.percent}
                            onChange={(e) => setPatternLines((prev) =>
                              prev.map((l) => l.key === line.key ? { ...l, percent: sanitizeDecimalInput(e.target.value) } : l)
                            )}
                            disabled={savingPattern}
                          />
                          <span style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', fontSize: 11, color: 'var(--text-3)', pointerEvents: 'none' }}>%</span>
                        </div>
                        <button
                          type="button"
                          className="pat-rm"
                          onClick={() => setPatternLines((prev) => prev.filter((l) => l.key !== line.key))}
                          disabled={savingPattern || patternLines.length === 1}
                        >
                          ×
                        </button>
                      </div>
                    ))}

                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <button
                        className="dlg-tag-btn"
                        type="button"
                        onClick={() => setPatternLines((prev) => [...prev, createPatternLine(prev.length + 1)])}
                        disabled={savingPattern}
                      >
                        + Счёт
                      </button>
                      <span style={{ fontSize: 12, fontWeight: 600, marginLeft: 'auto', color: Math.abs(totalPercent - 100) < 0.1 ? 'var(--pos)' : 'var(--text-3)' }}>
                        {totalPercent.toFixed(0)} / 100%
                      </span>
                    </div>

                    {patternError && <p className="dlg-error">{patternError}</p>}

                    <div style={{ display: 'flex', gap: 8, paddingTop: 8, borderTop: '1px solid var(--line)' }}>
                      {hasPattern && (
                        <button
                          className="sh-btn"
                          type="button"
                          onClick={handleDeletePattern}
                          disabled={savingPattern || deletingPattern}
                          style={{ background: 'var(--neg-bg)', color: 'var(--neg)', flex: 'none', padding: '8px 14px', fontSize: 13 }}
                        >
                          {deletingPattern ? '...' : 'Удалить'}
                        </button>
                      )}
                      <button
                        className="sh-btn sh-btn--ghost"
                        type="button"
                        onClick={() => { setShowPatternEditor(false); setPatternError(null); }}
                        disabled={savingPattern}
                        style={{ fontSize: 13 }}
                      >
                        Отмена
                      </button>
                      <button
                        className="sh-btn sh-btn--primary"
                        type="button"
                        onClick={handleSavePattern}
                        disabled={savingPattern}
                        style={{ fontSize: 13 }}
                      >
                        {savingPattern ? '...' : 'Сохранить'}
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    {displayLines.map((line, i) => (
                      <div key={i} className="src-dist__row">
                        <span className="src-dist__label">
                          {line.label}
                        </span>
                        <span className="src-dist__pct">{Math.round(line.share * 100)}%</span>
                        {totalAmount > 0 && (
                          <span className="src-dist__amt">
                            {(distributionAmount * line.share).toFixed(2)} {incomeCurrencyCode}
                          </span>
                        )}
                      </div>
                    ))}
                    <div className="src-dist__row" style={{ justifyContent: 'flex-end', borderTop: 'none' }}>
                      <button
                        type="button"
                        className="dlg-tag-btn"
                        onClick={openPatternEditor}
                        disabled={patternLoading}
                      >
                        Изменить
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>

          {/* ── Сумма ── */}
          <div className="field">
            <span className="fl">Сумма</span>
            <div className="amt">
              <input
                className="amt__inp"
                type="text"
                inputMode="decimal"
                placeholder="0"
                value={incomeAmount}
                onChange={(e) => setIncomeAmount(sanitizeDecimalInput(e.target.value))}
                autoFocus
              />
              <CurrencyPicker
                currencies={currencies}
                value={incomeCurrencyCode}
                onChange={setIncomeCurrencyCode}
              />
            </div>
            {isNonBase && (
              <input
                className="inp-v2"
                type="text"
                inputMode="decimal"
                placeholder={`Сумма в ${user.base_currency_code}`}
                value={incomeBudgetAmountInBase}
                onChange={(e) => setIncomeBudgetAmountInBase(sanitizeDecimalInput(e.target.value))}
              />
            )}
          </div>

          {/* ── Дата + Налог ── */}
          <div className="field field--row">
            <div className="field field--col">
              <span className="fl">Дата</span>
              <input
                className="picker-v2"
                type="date"
                value={incomeDate}
                onChange={(e) => setIncomeDate(e.target.value)}
                style={{ cursor: 'pointer' }}
              />
            </div>
            <div className="field field--col">
              <span className="fl">Налог</span>
              <input
                className="picker-v2"
                type="text"
                inputMode="decimal"
                placeholder="–"
                value={incomeTaxPercent}
                onChange={(e) => setIncomeTaxPercent(sanitizeDecimalInput(e.target.value))}
                style={{ paddingRight: 28 }}
              />
            </div>
          </div>

          {hasTax && isTaxValid && totalAmount > 0 && (
            <div style={{ fontSize: 12.5, color: 'var(--text-3)', padding: '0 2px', lineHeight: 1.5 }}>
              Налог {taxAmount.toFixed(2)} {incomeCurrencyCode}
              {' · '}
              К распределению <span style={{ color: 'var(--text-2)', fontWeight: 600 }}>{distributionAmount.toFixed(2)} {incomeCurrencyCode}</span>
              {isNonBase && taxAmountInBase > 0 && ` · ${taxAmountInBase.toFixed(2)} ${user.base_currency_code}`}
            </div>
          )}

          {!isTaxValid && (
            <p className="dlg-error">Налог должен быть больше 0 и меньше 100%.</p>
          )}

          {/* ── Комментарий ── */}
          <div className="field">
            <span className="fl">Комментарий</span>
            <input
              className="inp-v2"
              type="text"
              placeholder="Необязательно"
              value={incomeComment}
              onChange={(e) => setIncomeComment(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && canSubmit && handleSubmit()}
            />
          </div>

          {error && <p className="dlg-error">{error}</p>}
        </>
      )}
    </BottomSheet>
  );
}
