import { useEffect, useRef, useState } from 'react';
import { searchMoexSecurities } from '../utils/moex';
import type { MoexSecurityInfo } from '../utils/moex';

export function useMoexSearch(query: string, delay = 400) {
  const [results, setResults] = useState<MoexSecurityInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    timerRef.current = setTimeout(() => {
      searchMoexSecurities(q)
        .then(setResults)
        .catch(() => setResults([]))
        .finally(() => setLoading(false));
    }, delay);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [query, delay]);

  return { results, loading };
}
