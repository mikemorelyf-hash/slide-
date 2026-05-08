import type { PassengerPoolView, PrimaryAction, Route, TelegramUserProfile } from './types';
import { translate, type LanguageCode } from './i18n';

export function formatPrice(
  price: { priceAmount: number | null; priceCurrency: string },
  language: LanguageCode = 'en'
): string {
  if (price.priceAmount === null) {
    return language === 'am' ? 'አልተዘጋጀም' : 'not set';
  }

  return `${Number.isInteger(price.priceAmount) ? price.priceAmount : price.priceAmount.toFixed(2)} ${
    price.priceCurrency
  }`;
}

export function formatPassengerName(user: TelegramUserProfile | null, language: LanguageCode = 'en'): string {
  if (!user) {
    return language === 'am' ? 'ተሳፋሪ' : 'Passenger';
  }

  if (user.username) {
    return `@${user.username}`;
  }

  const fullName = `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim();
  return fullName || `Telegram ${user.telegramId}`;
}

export function primaryActionLabel(action: PrimaryAction, language: LanguageCode = 'en'): string {
  const labels: Record<LanguageCode, Record<PrimaryAction, string>> = {
    en: {
      choose_route: 'Choose Route',
      confirm_payment: 'I Have Paid',
      wait_for_pool: 'Waiting for Pool',
      request_early_dispatch: "Let's Go Now",
      wait_for_driver: 'Waiting for Driver',
      confirm_arrival: 'Confirm Driver Arrival',
      in_trip: 'Trip in Progress',
      completed: 'Trip Complete'
    },
    am: {
      choose_route: 'መንገድ ይምረጡ',
      confirm_payment: 'ከፍያለሁ',
      wait_for_pool: 'ፑል በመጠበቅ',
      request_early_dispatch: 'አሁን እንሂድ',
      wait_for_driver: 'ሾፌር በመጠበቅ',
      confirm_arrival: 'የሾፌር መድረስ አረጋግጥ',
      in_trip: 'ጉዞ በሂደት ላይ',
      completed: 'ጉዞ ተጠናቋል'
    }
  };

  return labels[language][action];
}

export function formatPoolSeatLabel(
  pool: { passengerCount: number; seatsLeft: number },
  language: LanguageCode = 'en'
): string {
  if (pool.seatsLeft <= 1 && pool.passengerCount > 0) {
    return language === 'am' ? 'ሊሞላ ነው' : 'Almost full';
  }

  if (language === 'am') {
    return `${pool.seatsLeft} መቀመጫ ቀርቷል`;
  }

  return `${pool.seatsLeft} ${pool.seatsLeft === 1 ? 'seat' : 'seats'} left`;
}

export function poolOccupancyLabel(
  pool: { passengerCount: number },
  poolSize: number,
  language: LanguageCode = 'en'
): string {
  return language === 'am'
    ? `${pool.passengerCount} / ${poolSize} መቀመጫ`
    : `${pool.passengerCount} / ${poolSize} seats`;
}

export function isRouteBookable(route: Pick<Route, 'priceAmount'>): boolean {
  return route.priceAmount !== null;
}

export function passengerHasPhone(user: Pick<TelegramUserProfile, 'phoneNumber'> | null): boolean {
  return Boolean(user?.phoneNumber?.trim());
}

export function isLockedToTelegramWorkflow(
  activePool: { pool: Pick<PassengerPoolView['pool'], 'workflowChannel'> } | null
): boolean {
  return activePool?.pool.workflowChannel === 'telegram';
}

export function shouldShowCompletedTrip(
  completedPool: { pool: { id: string } } | null,
  dismissedCompletedPoolId: string | null
): boolean {
  return Boolean(completedPool && completedPool.pool.id !== dismissedCompletedPoolId);
}

export function shouldClearRoutePoolsAfterStateRefresh(
  state: {
    activePool: unknown | null;
    lastCompletedPool: { pool: { id: string } } | null;
  },
  dismissedCompletedPoolId: string | null
): boolean {
  return Boolean(state.activePool || shouldShowCompletedTrip(state.lastCompletedPool, dismissedCompletedPoolId));
}

export function resolveMiniAppError(
  error: unknown,
  context: 'passenger' | 'admin' = 'passenger',
  language: LanguageCode = 'en'
): string {
  const status = getErrorStatus(error);
  const code = getErrorCode(error);

  if (status === 401) {
    return context === 'admin'
      ? translate(language, 'errorOpenDashboard')
      : translate(language, 'errorOpenTelegram');
  }

  if (status === 403) {
    return context === 'admin'
      ? translate(language, 'errorAdminAccess')
      : translate(language, 'errorActionNotAllowed');
  }

  if (status === 409) {
    if (code === 'phone_required') {
      return translate(language, 'errorPhoneRequired');
    }

    if (code === 'workflow_channel_mismatch' || code === 'active_pool_exists') {
      return translate(language, 'activePoolExists');
    }

    if (code === 'pool_not_joinable') {
      return translate(language, 'errorPoolGone');
    }

    return translate(language, 'errorChanged');
  }

  if (status !== null && status >= 500) {
    return translate(language, 'errorServer');
  }

  if (error instanceof TypeError) {
    return translate(language, 'errorNetwork');
  }

  return context === 'admin' ? translate(language, 'errorGenericAdmin') : translate(language, 'errorGeneric');
}

export function buildAuthHeaders(initData: string): Record<string, string> {
  return {
    'X-Telegram-Init-Data': initData
  };
}

function getErrorStatus(error: unknown): number | null {
  if (!error || typeof error !== 'object') {
    return null;
  }

  const maybeStatus = (error as { status?: unknown }).status;
  return typeof maybeStatus === 'number' ? maybeStatus : null;
}

function getErrorCode(error: unknown): string | null {
  if (!error || typeof error !== 'object') {
    return null;
  }

  const maybeCode = (error as { code?: unknown }).code;
  return typeof maybeCode === 'string' ? maybeCode : null;
}
