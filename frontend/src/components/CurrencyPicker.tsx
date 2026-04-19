import { useEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import type { Currency } from '../types';

interface Props {
  currencies: Currency[];
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}

export default function CurrencyPicker({ currencies, value, onChange, disabled }: Props) {
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
      <button
        type="button"
        className="amt__cur-btn"
        onClick={() => !disabled && setOpen((v) => !v)}
        disabled={disabled}
      >
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
