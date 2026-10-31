import { X } from 'lucide-react';
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
} from '../utils/receiptScan';

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
  return /[а-яё]/i.test(message) ? message : 'Не удалось распознать чек. Проверьте связь и попробуйте ещё раз.';
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
  const [names, setNames] = useState<string[]>([]);
  const [removed, setRemoved] = useState<Set<number>>(() => new Set());

  useEffect(() => () => abortRef.current?.abort(), []);
  useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview);
  }, [preview]);

  const pickPhoto = () => inputRef.current?.click();

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    abortRef.current?.abort();
    let photo: Blob;
    try {
      photo = await toJpeg(file);
    } catch {
      setStep({ kind: 'decode-error' });
      return;
    }
    setPreview(URL.createObjectURL(photo));
    setStep({ kind: 'loading' });
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const scan = await scanReceipt(photo, controller.signal);
      if (controller.signal.aborted) return;
      setNames(scan.items.map((item) => item.name_ru));
      setRemoved(new Set());
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
  const kept = scan
    ? scan.items
      .map((item, index) => ({ ...item, name_ru: names[index]?.trim() || item.name_ru, index }))
      .filter((item) => !removed.has(item.index))
    : [];
  // Rows keep their fields across scans («Другое фото»), so every scan refits them all.
  const listRef = useRef<HTMLUListElement>(null);
  useLayoutEffect(() => {
    if (scan) listRef.current?.querySelectorAll('textarea').forEach(fitHeight);
  }, [scan]);
  const removedItems = scan ? scan.items.filter((_, index) => removed.has(index)) : [];
  const amount = scan ? receiptExpenseAmount(scan.total, removedItems) : null;
  const currencyOk = Boolean(scan?.currency && availableCurrencies.includes(scan.currency));
  const date = scan ? receiptDateForExpense(scan.date, localToday()) : null;

  const hints: string[] = [];
  if (scan && !isEmpty) {
    if (scan.total === null) hints.push('Итог не найден — введите сумму вручную.');
    else if (!scan.currency) hints.push('Валюта не распознана — введите сумму вручную.');
    else if (!currencyOk) hints.push(`На выбранном счёте нет ${scan.currency} — введите сумму вручную.`);
    else if (amount === null) hints.push('Удалённые позиции стоят не меньше итога — введите сумму вручную.');
    if (scan.date && date === null) hints.push(`Дата на чеке ${formatDate(scan.date)} — проверьте.`);
    if (scan.items.length === 0) hints.push('Позиции не найдены — подставим только сумму.');
  }
  const diff = scan?.total && scan.items.length > 0 ? receiptItemsDiff(scan.total, scan.items) : '0';
  const diffText = diff === '0'
    ? null
    : `Сумма позиций на ${displayReceiptAmount(diff.replace('-', ''))} ${diff.startsWith('-') ? 'больше' : 'меньше'} итога.`;
  const meta = scan ? [scan.merchant, date ? formatDate(date) : null].filter(Boolean).join(' · ') : '';

  const apply = () => {
    if (!scan) return;
    onApply({
      amount: currencyOk ? amount : null,
      currency: currencyOk ? scan.currency : null,
      date,
      comment: buildReceiptComment(scan.merchant, kept),
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
    actions = <button className="sh-btn sh-btn--ghost" type="button" onClick={close}>Отмена</button>;
  } else if (scan && !isEmpty) {
    actions = (
      <>
        <button className="sh-btn sh-btn--ghost" type="button" onClick={pickPhoto}>Другое фото</button>
        <button className="sh-btn sh-btn--primary" type="button" onClick={apply}>Подставить</button>
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
          <p className="dlg-error" role="alert">Не удалось открыть фото — выберите другое.</p>
        )}
        {step.kind === 'error' && <p className="dlg-error" role="alert">{step.message}</p>}
        {isEmpty && <p className="rcpt-note">На фото не нашли чек. Попробуйте снять ближе и ровнее.</p>}
        {scan && !isEmpty && (
          <>
            <div className="sheet-stat">
              <span className="sheet-stat__tag">Итог по чеку</span>
              <div className="sheet-stat__num">
                <span className="sheet-stat__val">{scan.total ? displayReceiptAmount(scan.total) : '—'}</span>
                {scan.currency && <span className="sheet-stat__sym">{scan.currency}</span>}
              </div>
            </div>
            {meta && <p className="rcpt-note">{meta}</p>}
            {hints.map((hint) => <p className="rcpt-note" key={hint}>{hint}</p>)}
            {/* Above the list, not under it: after 30 rows it would be off screen. */}
            {diffText && <p className="rcpt-note">{diffText}</p>}
            {kept.length > 0 && (
              <ul ref={listRef} className="rcpt-list" aria-label="Позиции чека">
                {kept.map((item) => (
                  <li className="rcpt-row" key={item.index}>
                    <div className="rcpt-row__names">
                      <textarea
                        className="inp-v2 rcpt-row__name"
                        rows={1}
                        value={names[item.index] ?? ''}
                        aria-label={`Название позиции ${item.index + 1}`}
                        onChange={(event) => {
                          const field = event.target;
                          // One line in the comment: Enter or a pasted line break becomes a space.
                          if (/[\r\n]/.test(field.value)) field.value = field.value.replace(/[\r\n]+/g, ' ');
                          fitHeight(field);
                          const value = field.value;
                          setNames((prev) => prev.map((name, index) => (index === item.index ? value : name)));
                        }}
                      />
                      {item.name !== scan.items[item.index].name_ru && <span className="rcpt-row__orig">{item.name}</span>}
                    </div>
                    <span className="rcpt-row__amt">{displayReceiptAmount(item.amount)}</span>
                    <button
                      className="rcpt-row__del"
                      type="button"
                      aria-label={`Удалить позицию «${item.name_ru}»`}
                      onClick={() => setRemoved((prev) => new Set(prev).add(item.index))}
                    >
                      <X size={16} aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </BottomSheet>
  );
}
