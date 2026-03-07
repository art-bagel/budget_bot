import { useEffect, useState } from 'react';
import { register } from '../api';
import type { UserContext } from '../types';

const DEFAULT_BASE_CURRENCY = 'RUB';

export function useAuth() {
  const [user, setUser] = useState<UserContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    register(DEFAULT_BASE_CURRENCY)
      .then(setUser)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  return { user, loading, error };
}
