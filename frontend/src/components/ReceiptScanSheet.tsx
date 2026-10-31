import { Plus, X } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import BottomSheet from './BottomSheet';

import { scanReceipt } from '../api';
import type { ReceiptScan } from '../types';
import {
  buildReceiptComment,
  displayReceiptAmount,
  localToday,
  receiptDateForExpense,
  receiptExpenseAmount,
  receiptItemsDiff,
  receiptRowsReady,
  receiptRowsTotal,
} from '../utils/receiptScan';
import { sanitizeDecimalInput } from '../utils/validation';

export interface ReceiptApplyResult {
  /** Only set when the currency was recognised and the account has it. */
  amount: string | null;
  currency: string | null;
  date: string | null;
  comment: string;
}

interface Props {
  /** Fiat codes the selected account can spend. */
  availableCurrencies: string[];
  onApply: (result: ReceiptApplyResult) => void;
  onClose: () => void;
}

/** A line of the list as the user edits it. */
interface Row {
  key: number;
  /** The printed text, kept only when the model translated it into something else. */
  original: string | null;
  name: string;
  /** Absolute value as typed; the iOS decimal keypad has no minus, so the sign lives apart. */
  amount: string;
  negative: boolean;
}

function rowsFromScan(scan: ReceiptScan): Row[] {
  return scan.items.map((item, index) => ({
    key: index,
    original: item.name !== item.name_ru ? item.name : null,
    name: item.name_ru,
    amount: item.amount.replace(/^-/, ''),
    negative: item.amount.startsWith('-'),
  }));
}

type Step =
  | { kind: 'pick' }
  | { kind: 'loading' }
  | { kind: 'decode-error' }
  | { kind: 'error'; message: string }
  | { kind: 'result'; scan: ReceiptScan };

const MAX_SIDE = 2000;

// Re-encoding on a canvas drops EXIF (location, device) and turns HEIC into JPEG.
async function toJpeg(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas is not available');
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
  if (!blob) throw new Error('JPEG encoding failed');
  return blob;
}

// Server texts are Russian; a raw network error ("Load failed") is not.
function readableError(reason: unknown): string {
  const message = reason instanceof Error ? reason.message : '';
  return /[а-яё]/i.test(message) ? message : 'Не удалось распознать чек — проверьте связь и попробуйте ещё раз';
}

// A name field grows with its text, so a long translated name wraps instead of being cut.
function fitHeight(field: HTMLTextAreaElement | null) {
  if (!field) return;
  field.style.height = 'auto';
  field.style.height = `${field.scrollHeight}px`;
}

function formatDate(iso: string): string {
  const [year, month, day] = iso.split('-');
  return `${day}.${month}.${year}`;
}

export default function ReceiptScanSheet({ availableCurrencies, onApply, onClose }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [step, setStep] = useState<Step>({ kind: 'pick' });
  const [preview, setPreview] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const nextKeyRef = useRef(0);
  const [focusKey, setFocusKey] = useState<number | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  // The button that was pressed disappears with each step, so focus would fall to
  // <body> and a screen reader would not hear the result: move it to the new lead.
  const leadRef = useRef<HTMLElement | null>(null);
  const lead = (element: HTMLElement | null) => {
    leadRef.current = element;
  };
  useEffect(() => {
    if (step.kind !== 'pick') leadRef.current?.focus();
  }, [step]);
  useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview);
  }, [preview]);

  const pickPhoto = () => inputRef.current?.click();

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    // Taken before re-encoding: closing the sheet or picking another photo while
    // the canvas works must not let this one reach the paid model call.
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    let photo: Blob;
    try {
      photo = await toJpeg(file);
    } catch {
      if (!controller.signal.aborted) setStep({ kind: 'decode-error' });
      return;
    }
    if (controller.signal.aborted) return;
    setPreview(URL.createObjectURL(photo));
    setStep({ kind: 'loading' });
    try {
      const scan = await scanReceipt(photo, controller.signal);
      if (controller.signal.aborted) return;
      setRows(rowsFromScan(scan));
      nextKeyRef.current = scan.items.length;
      setStep({ kind: 'result', scan });
    } catch (reason) {
      if (controller.signal.aborted) return;
      setStep({ kind: 'error', message: readableError(reason) });
    }
  };

  const close = () => {
    abortRef.current?.abort();
    onClose();
  };

  const scan = step.kind === 'result' ? step.scan : null;
  const isEmpty = scan !== null && scan.total === null && scan.items.length === 0;
  const signed = rows.map((row) => ({
    name_ru: row.name.trim(),
    amount: row.amount === '' ? '' : `${row.negative ? '-' : ''}${row.amount}`,
  }));
  // Rows keep their fields across scans («Другое фото»), so every scan refits them all.
  const listRef = useRef<HTMLUListElement>(null);
  useLayoutEffect(() => {
    if (scan) listRef.current?.querySelectorAll('textarea').forEach(fitHeight);
  }, [scan]);
  useEffect(() => {
    if (focusKey === null) return;
    listRef.current?.querySelector<HTMLTextAreaElement>(`textarea[data-key="${focusKey}"]`)?.focus();
    setFocusKey(null);
  }, [focusKey]);

  // The total is the rows as they are now; the printed one only stays while the
  // model found no lines at all (a terminal screen) and none were added by hand.
  const usesPrintedTotal = scan !== null && scan.items.length === 0 && rows.length === 0;
  const total = scan ? (usesPrintedTotal ? scan.total : receiptRowsTotal(signed)) : null;
  const ready = receiptRowsReady(signed);
  const amount = receiptExpenseAmount(total);
  const currencyOk = Boolean(scan?.currency && availableCurrencies.includes(scan.currency));
  const date = scan ? receiptDateForExpense(scan.date, localToday()) : null;

  const hints: string[] = [];
  if (scan && !isEmpty) {
    // total is null only for an empty scan, which has its own state above.
    if (!scan.currency) hints.push('Валюта не распознана — введите сумму вручную.');
    else if (!currencyOk) hints.push(`На выбранном счёте нет ${scan.currency} — введите сумму вручную.`);
    else if (amount === null) hints.push('Итог должен быть больше нуля — введите сумму вручную.');
    if (scan.date && date === null) hints.push(`Дата на чеке ${formatDate(scan.date)} — проверьте.`);
    if (usesPrintedTotal) hints.push('Позиции не найдены — подставим итог с чека.');
  }
  // The printed total stays as a reference: a misread line or a store's rounding shows up here.
  const printedNote = scan?.total && total !== null && !usesPrintedTotal && receiptItemsDiff(scan.total, [{ amount: total }]) !== '0'
    ? `Итог на чеке: ${displayReceiptAmount(scan.total)}.`
    : null;
  const meta = scan ? [scan.merchant, date ? formatDate(date) : null].filter(Boolean).join(' · ') : '';

  const updateRow = (key: number, change: Partial<Row>) =>
    setRows((prev) => prev.map((row) => (row.key === key ? { ...row, ...change } : row)));
  const addRow = () => {
    const key = nextKeyRef.current;
    nextKeyRef.current += 1;
    setRows((prev) => [...prev, { key, original: null, name: '', amount: '', negative: false }]);
    setFocusKey(key);
  };

  const apply = () => {
    if (!scan || !ready) return;
    onApply({
      amount: currencyOk ? amount : null,
      currency: currencyOk ? scan.currency : null,
      date,
      comment: buildReceiptComment(scan.merchant, signed),
    });
  };

  let actions: ReactNode;
  if (step.kind === 'pick') {
    actions = (
      <>
        <button className="sh-btn sh-btn--ghost" type="button" onClick={close}>Отмена</button>
        <button className="sh-btn sh-btn--primary" type="button" onClick={pickPhoto}>Выбрать фото</button>
      </>
    );
  } else if (step.kind === 'loading') {
    actions = <button ref={lead} className="sh-btn sh-btn--ghost" type="button" onClick={close}>Отмена</button>;
  } else if (scan && !isEmpty) {
    actions = (
      <>
        <button className="sh-btn sh-btn--ghost" type="button" onClick={pickPhoto}>Другое фото</button>
        <button className="sh-btn sh-btn--primary" type="button" onClick={apply} disabled={!ready}>Подставить</button>
      </>
    );
  } else {
    actions = (
      <>
        <button className="sh-btn sh-btn--ghost" type="button" onClick={close}>Отмена</button>
        <button className="sh-btn sh-btn--primary" type="button" onClick={pickPhoto}>Другое фото</button>
      </>
    );
  }

  return (
    <BottomSheet open tag="Чек" title="Распознать чек" onClose={close} actions={<div className="rcpt-actions">{actions}</div>}>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          void handleFile(file);
        }}
      />
      <div className="rcpt">
        {step.kind === 'pick' && (
          <p className="rcpt-note">Сфотографируйте чек или выберите фото. Найдём итог и покупки — всё можно поправить.</p>
        )}
        {step.kind === 'loading' && (
          <>
            {preview && <img className="rcpt-preview" src={preview} alt="Фото чека" />}
            <p className="rcpt-note" role="status">Распознаём чек…</p>
          </>
        )}
        {step.kind === 'decode-error' && (
          <p ref={lead} tabIndex={-1} className="dlg-error" role="alert">Не удалось открыть фото — выберите другое</p>
        )}
        {step.kind === 'error' && <p ref={lead} tabIndex={-1} className="dlg-error" role="alert">{step.message}</p>}
        {isEmpty && (
          <p ref={lead} tabIndex={-1} className="rcpt-note">На фото не нашли чек. Попробуйте снять ближе и ровнее.</p>
        )}
        {scan && !isEmpty && (
          <>
            <div ref={lead} tabIndex={-1} className="sheet-stat">
              <span className="sheet-stat__tag">Итог</span>
              <div className="sheet-stat__num">
                <span className="sheet-stat__val">{total !== null ? displayReceiptAmount(total) : '—'}</span>
                {scan.currency && <span className="sheet-stat__sym">{scan.currency}</span>}
              </div>
            </div>
            {meta && <p className="rcpt-note">{meta}</p>}
            {hints.map((hint) => <p className="rcpt-note" key={hint}>{hint}</p>)}
            {/* Above the list, not under it: after 30 rows it would be off screen. */}
            {printedNote && <p className="rcpt-note">{printedNote}</p>}
            {rows.length > 0 && (
              <ul ref={listRef} className="rcpt-list" aria-label="Позиции чека">
                {rows.map((row, position) => (
                  <li className="rcpt-row" key={row.key}>
                    <div className="rcpt-row__names">
                      <textarea
                        className="inp-v2 rcpt-row__name"
                        rows={1}
                        data-key={row.key}
                        value={row.name}
                        placeholder="Название"
                        aria-label={`Название позиции ${position + 1}`}
                        onChange={(event) => {
                          const field = event.target;
                          // One line in the comment: Enter or a pasted line break becomes a space.
                          if (/[\r\n]/.test(field.value)) field.value = field.value.replace(/[\r\n]+/g, ' ');
                          fitHeight(field);
                          updateRow(row.key, { name: field.value });
                        }}
                      />
                      {row.original && <span className="rcpt-row__orig">{row.original}</span>}
                    </div>
                    <div className="rcpt-row__amt">
                      {row.negative && <span className="rcpt-row__sign" aria-hidden="true">−</span>}
                      <input
                        className="inp-v2 rcpt-row__amt-input"
                        type="text"
                        inputMode="decimal"
                        placeholder="0"
                        value={row.amount}
                        aria-label={`Сумма позиции ${position + 1}${row.negative ? ', скидка' : ''}`}
                        onChange={(event) => updateRow(row.key, { amount: sanitizeDecimalInput(event.target.value) })}
                      />
                    </div>
                    <button
                      className="rcpt-row__del"
                      type="button"
                      aria-label={`Удалить позицию «${row.name.trim() || 'без названия'}»`}
                      onClick={() => setRows((prev) => prev.filter((item) => item.key !== row.key))}
                    >
                      <X size={16} aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <button type="button" className="dlg-tag-btn rcpt-add" onClick={addRow}>
              <Plus size={14} aria-hidden="true" />
              Добавить позицию
            </button>
            {!ready && <p className="rcpt-note">Заполните название и сумму у каждой позиции.</p>}
          </>
        )}
      </div>
    </BottomSheet>
  );
}
