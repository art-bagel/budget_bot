import { useEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import type { Currency } from '../types';

export interface CurrencyPickerOption {
  value: string;
  label: string;
  group?: string;
}

interface Props {
  currencies: Currency[];
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  options?: CurrencyPickerOption[];
}

export default function CurrencyPicker({ currencies, value, onChange, disabled, options }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const items: CurrencyPickerOption[] = options ?? currencies.map((c) => ({ value: c.code, label: c.code }));
  const selected = items.find((item) => item.value === value);
  const grouped = items.reduce<Array<{ group: string | null; items: CurrencyPickerOption[] }>>((acc, item) => {
    const group = item.group ?? null;
    const last = acc[acc.length - 1];
    if (last && last.group === group) {
      last.items.push(item);
    } else {
      acc.push({ group, items: [item] });
    }
    return acc;
  }, []);

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
        {selected?.label ?? value}
        <ChevronDown size={12} strokeWidth={2.5} />
      </button>
      {open && (
        <div className="cur-drop">
          {grouped.map((group, index) => (
            <div key={`${group.group ?? 'ungrouped'}-${index}`}>
              {group.group && <div className="cur-drop__group">{group.group}</div>}
              {group.items.map((item) => (
                <button
                  key={item.value}
                  type="button"
                  className={`cur-drop__item${item.value === value ? ' cur-drop__item--on' : ''}`}
                  onClick={() => { onChange(item.value); setOpen(false); }}
                >
                  {item.label}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
