import { useState } from 'react';
import { updateUserSettings } from '../api';

const KEY = 'budget_hints_enabled';

export function useHints() {
  const [hintsEnabled, setHintsEnabled] = useState(() => {
    const stored = localStorage.getItem(KEY);
    return stored === null ? true : stored === 'true';
  });

  const toggle = () => {
    const newValue = !hintsEnabled;
    localStorage.setItem(KEY, String(newValue));
    setHintsEnabled(newValue);
    void updateUserSettings(newValue);
  };

  return { hintsEnabled, toggle };
}
