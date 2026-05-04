import type { PassengerPoolView, PrimaryAction, Route, TelegramUserProfile } from './types';

export function formatPrice(price: { priceAmount: number | null; priceCurrency: string }): string {
  if (price.priceAmount === null) {
    return 'not set';
  }

  return `${Number.isInteger(price.priceAmount) ? price.priceAmount : price.priceAmount.toFixed(2)} ${
    price.priceCurrency
  }`;
}

export function formatPassengerName(user: TelegramUserProfile | null): string {
  if (!user) {
    return 'Passenger';
  }

  if (user.username) {
    return `@${user.username}`;
  }

  const fullName = `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim();
  return fullName || `Telegram ${user.telegramId}`;
}

export function primaryActionLabel(action: PrimaryAction): string {
  const labels: Record<PrimaryAction, string> = {
    choose_route: 'Choose Route',
    confirm_payment: 'I Have Paid',
    wait_for_pool: 'Waiting for Pool',
    request_early_dispatch: "Let's Go Now",
    wait_for_driver: 'Waiting for Driver',
    confirm_arrival: 'Confirm Driver Arrival',
    in_trip: 'Trip in Progress',
    completed: 'Trip Complete'
  };

  return labels[action];
}

export function formatPoolSeatLabel(pool: { passengerCount: number; seatsLeft: number }): string {
  if (pool.seatsLeft <= 1 && pool.passengerCount > 0) {
    return 'Almost full';
  }

  return `${pool.seatsLeft} ${pool.seatsLeft === 1 ? 'seat' : 'seats'} left`;
}

export function poolOccupancyLabel(pool: { passengerCount: number }, poolSize: number): string {
  return `${pool.passengerCount} / ${poolSize} seats`;
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

export function resolveMiniAppError(error: unknown, context: 'passenger' | 'admin' = 'passenger'): string {
  const status = getErrorStatus(error);
  const code = getErrorCode(error);

  if (status === 401) {
    return context === 'admin' ? 'Open this dashboard from Telegram.' : 'Open this app from Telegram.';
  }

  if (status === 403) {
    return context === 'admin' ? 'Admin access required.' : 'This action is not allowed for your account.';
  }

  if (status === 409) {
    if (code === 'phone_required') {
      return 'Save your phone number before creating, joining, or paying for a pool.';
    }

    if (code === 'workflow_channel_mismatch' || code === 'active_pool_exists') {
      return 'This ride is already active in another place. Refresh and continue there.';
    }

    if (code === 'pool_not_joinable') {
      return 'This pool is no longer available. Please start a new pool.';
    }

    return 'This changed already. Refresh and try again.';
  }

  if (status !== null && status >= 500) {
    return 'Service is temporarily unavailable. Try again.';
  }

  if (error instanceof TypeError) {
    return 'Service unavailable. Check connection and try again.';
  }

  return context === 'admin' ? 'Could not update admin dashboard.' : 'Could not update. Try again.';
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
