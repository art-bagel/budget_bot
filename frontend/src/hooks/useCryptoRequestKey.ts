import { useRef } from 'react';

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
      saved = { fingerprint, id: crypto.randomUUID() };
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
