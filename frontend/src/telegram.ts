interface TelegramWebApp {
  initData: string;
  colorScheme?: 'light' | 'dark';
  ready: () => void;
  expand: () => void;
  HapticFeedback?: {
    impactOccurred: (style: 'light' | 'medium' | 'heavy') => void;
    notificationOccurred: (type: 'error' | 'success' | 'warning') => void;
  };
}

declare global {
  interface Window {
    Telegram?: {
      WebApp?: TelegramWebApp;
    };
  }
}

export function getTelegramWebApp(): TelegramWebApp | null {
  return window.Telegram?.WebApp ?? null;
}

export function getTelegramInitData(): string {
  return getTelegramWebApp()?.initData || import.meta.env.VITE_DEV_TELEGRAM_INIT_DATA || '';
}

export function prepareTelegramShell(): void {
  const webApp = getTelegramWebApp();
  if (!webApp) {
    return;
  }

  webApp.ready();
  webApp.expand();
}

export function notifySuccess(): void {
  getTelegramWebApp()?.HapticFeedback?.notificationOccurred('success');
}

export function notifyError(): void {
  getTelegramWebApp()?.HapticFeedback?.notificationOccurred('error');
}
