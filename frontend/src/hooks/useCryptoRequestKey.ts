import { useRef } from 'react';

// randomUUID exists only in secure contexts (and iOS 15.4+); getRandomValues
// works everywhere and is just as random for a v4 UUID.
function uuid(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

// Retain an uncertain request across retries/reopening in the same browser tab.
// A confirmed success clears it so an intentional identical next action is new.
export function useCryptoRequestKey(scope: string) {
  const memory = useRef<{ fingerprint: string; id: string } | null>(null);
  const storageKey = `crypto-request:${scope}`;
  const requestId = (payload: unknown): string => {
    const fingerprint = JSON.stringify(payload);
    let saved = memory.current;
    try {
      const raw = sessionStorage.getItem(storageKey);
      if (raw) saved = JSON.parse(raw) as typeof saved;
    } catch { /* Storage may be unavailable; the open form still retains its key. */ }
    if (!saved || saved.fingerprint !== fingerprint || typeof saved.id !== 'string') {
      saved = { fingerprint, id: uuid() };
    }
    memory.current = saved;
    try { sessionStorage.setItem(storageKey, JSON.stringify(saved)); } catch { /* Optional persistence. */ }
    return saved.id;
  };
  const completed = () => {
    memory.current = null;
    try { sessionStorage.removeItem(storageKey); } catch { /* Optional persistence. */ }
  };
  return { requestId, completed };
}
