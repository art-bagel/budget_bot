import { useCallback, useEffect, useState } from 'react';
import { getTelegramColorScheme, getTelegramUserId, getTelegramWebApp, subscribeTelegramThemeChanged } from '../telegram';
import { updateUserSettings } from '../api';

export type Theme = 'light' | 'dark' | 'system';

function getStorageKey(): string {
  const uid = getTelegramUserId();
  return uid ? `budgeting-theme-${uid}` : 'budgeting-theme';
}

function getSystemTheme(): 'light' | 'dark' {
  const telegramColorScheme = getTelegramColorScheme();

  if (telegramColorScheme) {
    return telegramColorScheme;
  }

  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function useTheme() {
  const [theme, setThemeRaw] = useState<Theme>(() => {
    const stored = localStorage.getItem(getStorageKey());
    return (stored as Theme) || 'system';
  });

  const resolved = theme === 'system' ? getSystemTheme() : theme;

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'system') {
      root.removeAttribute('data-theme');
    } else {
      root.setAttribute('data-theme', theme);
    }
    localStorage.setItem(getStorageKey(), theme);

    const webApp = getTelegramWebApp();
    const backgroundColor = getComputedStyle(root).getPropertyValue('--bg').trim();

    if (backgroundColor) {
      webApp?.setBackgroundColor?.(backgroundColor);
      webApp?.setHeaderColor?.(backgroundColor);
    }
  }, [theme]);

  useEffect(() => {
    if (theme !== 'system') return;

    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => setThemeRaw('system');
    mq.addEventListener('change', handler);
    const unsubscribeTelegram = subscribeTelegramThemeChanged(handler);

    return () => {
      mq.removeEventListener('change', handler);
      unsubscribeTelegram();
    };
  }, [theme]);

  const setTheme = useCallback((t: Theme) => {
    setThemeRaw(t);
    void updateUserSettings({ theme: t });
  }, []);

  return { theme, resolved, setTheme };
}
