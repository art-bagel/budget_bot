export interface TelegramWebAppUser {
  id: number;
  username?: string;
  first_name?: string;
  last_name?: string;
}

interface TelegramBackButton {
  show: () => void;
  hide: () => void;
  onClick: (callback: () => void) => void;
  offClick: (callback: () => void) => void;
}

interface TelegramMainButton {
  show: () => void;
  hide: () => void;
  setText?: (text: string) => void;
  onClick?: (callback: () => void) => void;
  offClick?: (callback: () => void) => void;
}

interface TelegramWebApp {
  initData: string;
  initDataUnsafe?: {
    user?: TelegramWebAppUser;
  };
  colorScheme?: 'light' | 'dark';
  isVerticalSwipesEnabled?: boolean;
  BackButton?: TelegramBackButton;
  MainButton?: TelegramMainButton;
  ready: () => void;
  expand: () => void;
  disableVerticalSwipes?: () => void;
  enableClosingConfirmation?: () => void;
  setHeaderColor?: (color: string) => void;
  setBackgroundColor?: (color: string) => void;
  onEvent?: (eventType: string, callback: () => void) => void;
  offEvent?: (eventType: string, callback: () => void) => void;
}

declare global {
  interface Window {
    Telegram?: {
      WebApp?: TelegramWebApp;
    };
  }
}

const EXPLICIT_DEV_TELEGRAM_USER_ID = import.meta.env.VITE_DEV_TELEGRAM_USER_ID?.trim() || '';

function getImplicitDevTelegramUserId(): string {
  const hostname = window.location.hostname;

  if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '0.0.0.0') {
    return '1';
  }

  return '';
}

export function getTelegramWebApp(): TelegramWebApp | null {
  return window.Telegram?.WebApp || null;
}

export function initTelegramWebApp(): void {
  const webApp = getTelegramWebApp();

  if (!webApp) {
    return;
  }

  webApp.ready();
  webApp.expand();
  webApp.disableVerticalSwipes?.();

  const rootStyles = getComputedStyle(document.documentElement);
  const backgroundColor = rootStyles.getPropertyValue('--bg-root').trim();

  if (backgroundColor) {
    webApp.setBackgroundColor?.(backgroundColor);
    webApp.setHeaderColor?.(backgroundColor);
  }

  webApp.MainButton?.hide();
}

export function getTelegramInitData(): string | null {
  const initData = getTelegramWebApp()?.initData?.trim();
  return initData || null;
}

export function getTelegramUserId(): string | null {
  const devTelegramUserId = EXPLICIT_DEV_TELEGRAM_USER_ID || getImplicitDevTelegramUserId();
  const webAppUserId = getTelegramWebApp()?.initDataUnsafe?.user?.id;

  if (typeof webAppUserId === 'number') {
    return String(webAppUserId);
  }

  return devTelegramUserId || null;
}

export function hasTelegramContext(): boolean {
  return Boolean(getTelegramInitData() || getTelegramUserId());
}

export function getTelegramColorScheme(): 'light' | 'dark' | null {
  return getTelegramWebApp()?.colorScheme || null;
}

export function subscribeTelegramThemeChanged(callback: () => void): () => void {
  const webApp = getTelegramWebApp();

  if (!webApp?.onEvent || !webApp.offEvent) {
    return () => {};
  }

  webApp.onEvent('themeChanged', callback);

  return () => {
    webApp.offEvent?.('themeChanged', callback);
  };
}

export function bindTelegramBackButton(isVisible: boolean, onClick: () => void): () => void {
  const backButton = getTelegramWebApp()?.BackButton;

  if (!backButton) {
    return () => {};
  }

  if (isVisible) {
    backButton.show();
    backButton.onClick(onClick);
  } else {
    backButton.hide();
  }

  return () => {
    backButton.offClick(onClick);
    backButton.hide();
  };
}
