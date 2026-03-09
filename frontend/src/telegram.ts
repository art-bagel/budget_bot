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

interface TelegramSafeAreaInset {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

interface TelegramWebApp {
  initData: string;
  initDataUnsafe?: {
    user?: TelegramWebAppUser;
  };
  colorScheme?: 'light' | 'dark';
  isVerticalSwipesEnabled?: boolean;
  safeAreaInset?: TelegramSafeAreaInset;
  contentSafeAreaInset?: TelegramSafeAreaInset;
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

export function initVisualViewportVar(): void {
  function update() {
    const height = window.visualViewport?.height ?? window.innerHeight;
    const offsetTop = window.visualViewport?.offsetTop ?? 0;
    document.documentElement.style.setProperty('--visual-viewport-height', `${height}px`);
    document.documentElement.style.setProperty('--visual-viewport-offset-top', `${offsetTop}px`);
  }
  update();
  window.visualViewport?.addEventListener('resize', update);
  window.visualViewport?.addEventListener('scroll', update);
}

function applySafeAreaVars(webApp: TelegramWebApp): void {
  const root = document.documentElement;

  // safeAreaInset.top = system status bar only (notch / Dynamic Island)
  const safeTop = webApp.safeAreaInset?.top ?? 0;
  const safeBottom = webApp.safeAreaInset?.bottom ?? 0;
  const contentTop = webApp.contentSafeAreaInset?.top ?? 0;
  const fallbackHeaderHeight = 52;
  const minimumTelegramTopOffset = 64;
  const resolvedContentTop = Math.max(contentTop, safeTop + fallbackHeaderHeight, minimumTelegramTopOffset);

  root.style.setProperty('--tg-content-safe-area-inset-top', `${resolvedContentTop}px`);
  root.style.setProperty('--tg-app-top-offset', `${resolvedContentTop}px`);
  root.style.setProperty('--tg-safe-area-inset-top', `${safeTop}px`);
  root.style.setProperty('--tg-safe-area-inset-bottom', `${safeBottom}px`);
}

export function initTelegramWebApp(): void {
  const webApp = getTelegramWebApp();

  if (!webApp) {
    return;
  }

  webApp.ready();
  webApp.expand();
  webApp.disableVerticalSwipes?.();
  webApp.enableClosingConfirmation?.();

  document.addEventListener('touchmove', (e) => {
    if (e.touches.length > 1) {
      e.preventDefault();
    }
  }, { passive: false });

  document.addEventListener('gesturestart', (e) => {
    e.preventDefault();
  });

  const rootStyles = getComputedStyle(document.documentElement);
  const backgroundColor = rootStyles.getPropertyValue('--bg-root').trim();

  if (backgroundColor) {
    webApp.setBackgroundColor?.(backgroundColor);
    webApp.setHeaderColor?.(backgroundColor);
  }

  webApp.MainButton?.hide();

  // Apply safe area CSS variables from JS (reliable across all Telegram versions)
  applySafeAreaVars(webApp);
  webApp.onEvent?.('safeAreaChanged', () => applySafeAreaVars(webApp));
  webApp.onEvent?.('contentSafeAreaChanged', () => applySafeAreaVars(webApp));
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
