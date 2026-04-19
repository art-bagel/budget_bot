import { useState } from 'react';
import BottomSheet from './BottomSheet';
import { parseCategoryIcon, categoryDisplayName } from '../utils/categoryIcon';
import { CategorySvgIcon } from './CategorySvgIcon';
import { formatAmount } from '../utils/format';
import { sanitizeDecimalInput } from '../utils/validation';
import { allocateBudget } from '../api';
import type { TransferSource } from './TransferDialog';
import type { AllocateBudgetRequest } from '../types';

interface FreeBudgetTarget {
  category_id: number;
  name: string;
  balance: number;
  currency_code: string;
  owner_type: 'user' | 'family';
}

interface Props {
  personal: FreeBudgetTarget;
  family?: FreeBudgetTarget | null;
  sources: TransferSource[];
  baseCurrencyCode: string;
  onClose: () => void;
  onSuccess: () => void;
}

const FreeBudgetIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 2L2 7l10 5 10-5-10-5z"/>
    <path d="M2 17l10 5 10-5"/>
    <path d="M2 12l10 5 10-5"/>
  </svg>
);

const colorClasses = ['--g', '--o', '--b', '--p', '--r', '--v'] as const;

export default function FreeBudgetActionSheet({ personal, family, sources, baseCurrencyCode, onClose, onSuccess }: Props) {
  const hasFamily = !!family;
  const targets: FreeBudgetTarget[] = hasFamily && family ? [personal, family] : [personal];

  const [activeTarget, setActiveTarget] = useState<FreeBudgetTarget>(personal);
  const [showTargetPicker, setShowTargetPicker] = useState(false);

  // Sources filtered by the active target's owner_type
  const visibleSources = sources.filter((s) => !s.owner_type || s.owner_type === activeTarget.owner_type);

  const [sourceId, setSourceId] = useState('');
  const [showSourcePicker, setShowSourcePicker] = useState(false);
  const [amount, setAmount] = useState('');
  const [comment, setComment] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const selectedSource = visibleSources.find((s) => String(s.category_id) === sourceId) || null;
  const amountValue = parseFloat(amount);
  const hasPositiveBalance = (selectedSource?.balance || 0) > 0;
  const exceedsBalance = !!selectedSource && amountValue > selectedSource.balance;
  const validationMsg = !selectedSource
    ? null
    : !hasPositiveBalance
      ? 'В выбранной категории нет денег для перевода.'
      : exceedsBalance
        ? `Нельзя перевести больше: ${formatAmount(selectedSource.balance, selectedSource.currency_code)}.`
        : null;

  const canSubmit = !submitting && !!selectedSource && amountValue > 0 && !validationMsg;

  const handleTargetSelect = (t: FreeBudgetTarget) => {
    setActiveTarget(t);
    setShowTargetPicker(false);
    // reset source if it doesn't belong to the new target's owner_type
    const stillValid = sources.some(
      (s) => String(s.category_id) === sourceId && (!s.owner_type || s.owner_type === t.owner_type),
    );
    if (!stillValid) setSourceId('');
  };

  const handleSubmit = async () => {
    if (!selectedSource || amountValue <= 0 || validationMsg) return;
    setSubmitting(true);
    setError(null);
    try {
      await allocateBudget({
        from_category_id: selectedSource.category_id,
        to_category_id: activeTarget.category_id,
        amount_in_base: amountValue,
        comment: comment.trim() || undefined,
      } as AllocateBudgetRequest);
      onSuccess();
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <BottomSheet
      open
      tag="Бюджет"
      title="Свободный остаток"
      icon={<FreeBudgetIcon />}
      iconColor="b"
      onClose={() => !submitting && onClose()}
      actions={
        <div style={{ display: 'flex', gap: 8, width: '100%' }}>
          <button className="sh-btn sh-btn--ghost" type="button" onClick={onClose} disabled={submitting}>Отмена</button>
          <button className="sh-btn sh-btn--primary" type="button" disabled={!canSubmit} onClick={handleSubmit} style={{ flex: 1 }}>
            {submitting ? '...' : 'Перевести'}
          </button>
        </div>
      }
    >
      {/* Balance stat */}
      <div className="sheet-stat">
        <span className="sheet-stat__tag">{hasFamily ? activeTarget.name : 'Остаток к распределению'}</span>
        <div className="sheet-stat__num">
          <span className="sheet-stat__val">
            {new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(activeTarget.balance)}
          </span>
          <span className="sheet-stat__sym">{activeTarget.currency_code}</span>
        </div>
      </div>

      {/* Transfer UI */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div className="xfer">

          {/* FROM card — source picker */}
          <button
            className="xfer__card"
            type="button"
            onClick={() => !submitting && setShowSourcePicker((v) => !v)}
            disabled={submitting}
          >
            <span className="xfer__tag">Откуда</span>
            <div className="xfer__row">
              {selectedSource ? (
                <>
                  <span className={`sheet-ico sheet-ico--sm sheet-ico${colorClasses[selectedSource.category_id % 6]}`}>
                    {(() => {
                      const p = parseCategoryIcon(selectedSource.name);
                      return p.kind === 'svg' && p.icon
                        ? <CategorySvgIcon code={p.icon} />
                        : p.kind === 'emoji' && p.icon
                          ? <span style={{ fontSize: 14 }}>{p.icon}</span>
                          : null;
                    })()}
                  </span>
                  <div className="xfer__text">
                    <span className="xfer__name">{categoryDisplayName(selectedSource.name)}</span>
                    <span className="xfer__sub">{formatAmount(selectedSource.balance, selectedSource.currency_code)}</span>
                  </div>
                </>
              ) : (
                <div className="xfer__text">
                  <span className="xfer__name" style={{ color: 'var(--text-3)', fontWeight: 500 }}>Выберите источник</span>
                </div>
              )}
              <svg className="xfer__chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d={showSourcePicker ? 'm6 15 6-6 6 6' : 'm6 9 6 6 6-6'} />
              </svg>
            </div>
          </button>

          {/* Inline source picker */}
          {showSourcePicker && (
            <div className="xfer__source-list">
              {visibleSources.length === 0 && (
                <div style={{ padding: '12px 14px', fontSize: 13, color: 'var(--text-3)' }}>Нет доступных источников</div>
              )}
              {visibleSources.map((s) => {
                const sp = parseCategoryIcon(s.name);
                const sColor = colorClasses[s.category_id % 6];
                return (
                  <button
                    key={s.category_id}
                    type="button"
                    className={`xfer__source-item${String(s.category_id) === sourceId ? ' xfer__source-item--active' : ''}`}
                    onClick={() => { setSourceId(String(s.category_id)); setShowSourcePicker(false); }}
                  >
                    <span className={`sheet-ico sheet-ico--sm sheet-ico${sColor}`} style={{ flexShrink: 0 }}>
                      {sp.kind === 'svg' && sp.icon
                        ? <CategorySvgIcon code={sp.icon} />
                        : sp.kind === 'emoji' && sp.icon
                          ? <span style={{ fontSize: 14 }}>{sp.icon}</span>
                          : null}
                    </span>
                    <span className="xfer__source-item__name">{categoryDisplayName(s.name)}</span>
                    <span className="xfer__source-item__bal">{formatAmount(s.balance, s.currency_code)}</span>
                  </button>
                );
              })}
            </div>
          )}

          {/* Arrow */}
          <div className="xfer__arrow">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 5v14M6 13l6 6 6-6" />
            </svg>
          </div>

          {/* TO card — target picker (clickable only when hasFamily) */}
          {hasFamily ? (
            <>
              <button
                className="xfer__card xfer__card--to"
                type="button"
                onClick={() => !submitting && setShowTargetPicker((v) => !v)}
                disabled={submitting}
              >
                <span className="xfer__tag">Куда</span>
                <div className="xfer__row">
                  <span className="sheet-ico sheet-ico--sm sheet-ico--b">
                    <FreeBudgetIcon />
                  </span>
                  <div className="xfer__text">
                    <span className="xfer__name">{activeTarget.name}</span>
                    <span className="xfer__sub">{formatAmount(activeTarget.balance, activeTarget.currency_code)}</span>
                  </div>
                  <svg className="xfer__chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d={showTargetPicker ? 'm6 15 6-6 6 6' : 'm6 9 6 6 6-6'} />
                  </svg>
                </div>
              </button>

              {/* Inline target picker */}
              {showTargetPicker && (
                <div className="xfer__source-list">
                  {targets.map((t) => (
                    <button
                      key={t.category_id}
                      type="button"
                      className={`xfer__source-item${t.category_id === activeTarget.category_id ? ' xfer__source-item--active' : ''}`}
                      onClick={() => handleTargetSelect(t)}
                    >
                      <span className="sheet-ico sheet-ico--sm sheet-ico--b" style={{ flexShrink: 0 }}>
                        <FreeBudgetIcon />
                      </span>
                      <span className="xfer__source-item__name">{t.name}</span>
                      <span className="xfer__source-item__bal">{formatAmount(t.balance, t.currency_code)}</span>
                    </button>
                  ))}
                </div>
              )}
            </>
          ) : (
            <div className="xfer__card xfer__card--to">
              <span className="xfer__tag">Куда</span>
              <div className="xfer__row">
                <span className="sheet-ico sheet-ico--sm sheet-ico--b">
                  <FreeBudgetIcon />
                </span>
                <div className="xfer__text">
                  <span className="xfer__name">{activeTarget.name}</span>
                  <span className="xfer__sub">{formatAmount(activeTarget.balance, activeTarget.currency_code)}</span>
                </div>
              </div>
            </div>
          )}
        </div>

        {validationMsg && <p className="dlg-error">{validationMsg}</p>}

        <div className="field">
          <span className="fl">Сумма</span>
          <div className="amt">
            <input
              className="amt__inp"
              type="text"
              inputMode="decimal"
              placeholder="0"
              value={amount}
              onChange={(e) => setAmount(sanitizeDecimalInput(e.target.value))}
              disabled={submitting}
            />
            <span className="amt__cur" style={{ fontSize: 18, fontWeight: 600, color: 'var(--text-2)' }}>{baseCurrencyCode}</span>
          </div>
        </div>

        <div className="field">
          <span className="fl">Комментарий</span>
          <input
            className="inp-v2"
            type="text"
            placeholder="Необязательно"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !submitting && void handleSubmit()}
          />
        </div>

        {error && <p className="dlg-error">{error}</p>}
      </div>
    </BottomSheet>
  );
}
