import { useEffect, useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { X } from 'lucide-react';

interface Props {
  open: boolean;
  title: string;
  tag?: string;
  icon?: ReactNode;
  iconColor?: string;
  onClose: () => void;
  children: ReactNode;
  actions?: ReactNode;
  gray?: boolean;
}

export default function BottomSheet({ open, title, tag, icon, iconColor, onClose, children, actions, gray }: Props) {
  const [visible, setVisible] = useState(false);
  const sheetRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  // Keyboard users land inside the sheet and return to the opener on close.
  // The opener is captured during render: by the time effects run, an
  // autoFocus field inside the sheet has already taken focus.
  const openerRef = useRef<HTMLElement | null>(null);
  const wasOpenRef = useRef(false);
  if (open !== wasOpenRef.current) {
    wasOpenRef.current = open;
    if (open) openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  }
  useEffect(() => {
    if (!open) return;
    const opener = openerRef.current;
    const sheet = sheetRef.current;
    if (sheet && !sheet.contains(document.activeElement)) sheet.focus({ preventScroll: true });
    return () => opener?.focus({ preventScroll: true });
  }, [open]);

  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => setVisible(true));
    } else {
      setVisible(false);
    }
  }, [open]);

  // scroll focused input into view after keyboard appears
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const handler = (e: FocusEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA') {
        setTimeout(() => target.scrollIntoView({ behavior: 'smooth', block: 'center' }), 350);
      }
    };
    el.addEventListener('focusin', handler);
    return () => el.removeEventListener('focusin', handler);
  }, []);

  // swipe-to-close: only from handle/header, never from scrollable body
  const startYRef = useRef<number | null>(null);
  const handleDragTouchStart = (e: React.TouchEvent) => { startYRef.current = e.touches[0].clientY; };
  const handleDragTouchEnd = (e: React.TouchEvent) => {
    if (startYRef.current === null) return;
    if (e.changedTouches[0].clientY - startYRef.current > 60) onClose();
    startYRef.current = null;
  };

  if (!open && !visible) return null;

  return (
    <div
      className="sheet-root"
      data-open={open ? '' : undefined}
      onKeyDown={(e) => {
        if (e.key !== 'Escape') return;
        // Nested sheets: only the innermost one closes.
        e.stopPropagation();
        onClose();
      }}
    >
      <div className="sheet-backdrop" onClick={onClose} />
      <div
        ref={sheetRef}
        className={`sheet${gray ? ' sheet--gray' : ''}`}
        data-visible={visible ? '' : undefined}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <div
          className="sheet__handle"
          onTouchStart={handleDragTouchStart}
          onTouchEnd={handleDragTouchEnd}
        />
        <div
          className="sheet__head"
          onTouchStart={handleDragTouchStart}
          onTouchEnd={handleDragTouchEnd}
        >
          <div className="sheet__head-left">
            {icon && <div className={`sheet-ico${iconColor ? ` sheet-ico--${iconColor}` : ''}`}>{icon}</div>}
            <div>
              {tag && <div className="sheet__tag">{tag}</div>}
              <div className="sheet__title" id={titleId}>{title}</div>
            </div>
          </div>
          <button className="sheet__close" type="button" onClick={onClose} aria-label="Закрыть">
            <X size={16} strokeWidth={2} />
          </button>
        </div>
        <div className="sheet__body" ref={bodyRef}>{children}</div>
        {actions && <div className="sheet__actions">{actions}</div>}
      </div>
    </div>
  );
}
