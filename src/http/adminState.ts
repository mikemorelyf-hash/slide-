import type { AdminOverview, AdminPoolSummary } from '../domain/adminTypes.js';
import type { Route } from '../domain/types.js';

export type RoutePriceParseResult =
  | { ok: true; amount: number; currency: string }
  | { ok: false; error: 'invalid_price_amount' | 'invalid_price_currency' };

export interface BuildAdminOverviewInput {
  routes: Route[];
  pools: AdminPoolSummary[];
  completedToday: number;
  pendingNotifications?: number;
  failedNotifications?: number;
  now?: Date;
}

const activeStatuses = new Set(['open', 'ready', 'assigned', 'arrival_requested', 'in_progress']);

export function isAdminTelegramId(
  telegramId: string | null | undefined,
  adminTelegramIds: string[]
): boolean {
  return Boolean(telegramId && adminTelegramIds.includes(telegramId));
}

export function parseRoutePriceBody(body: unknown): RoutePriceParseResult {
  const record = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  const rawAmount = record.amount ?? record.priceAmount;
  const amount = typeof rawAmount === 'number' ? rawAmount : Number(rawAmount);

  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false, error: 'invalid_price_amount' };
  }

  const rawCurrency = record.currency ?? record.priceCurrency ?? 'ETB';
  if (typeof rawCurrency !== 'string' || rawCurrency.trim() === '') {
    return { ok: false, error: 'invalid_price_currency' };
  }

  const currency = rawCurrency.trim().toUpperCase();
  if (!/^[A-Z]{3,8}$/.test(currency)) {
    return { ok: false, error: 'invalid_price_currency' };
  }

  return {
    ok: true,
    amount,
    currency
  };
}

export function buildAdminOverview({
  routes,
  pools,
  completedToday,
  pendingNotifications = 0,
  failedNotifications = 0,
  now = new Date()
}: BuildAdminOverviewInput): AdminOverview {
  return {
    metrics: {
      activePools: pools.filter((pool) => activeStatuses.has(pool.status)).length,
      openPools: pools.filter((pool) => pool.status === 'open').length,
      waitingDriverPools: pools.filter((pool) => pool.status === 'ready').length,
      arrivalPendingPools: pools.filter((pool) => pool.status === 'arrival_requested').length,
      inProgressTrips: pools.filter((pool) => pool.status === 'in_progress').length,
      completedToday
    },
    stability: {
      pendingNotifications,
      failedNotifications,
      stuckPools: pools.flatMap((pool) => {
        const reason = getStuckPoolReason(pool, now);
        return reason
          ? [
              {
                poolId: pool.id,
                routeName: pool.routeName,
                status: pool.status,
                reason
              }
            ]
          : [];
      })
    },
    routes,
    pools
  };
}

function getStuckPoolReason(pool: AdminPoolSummary, now: Date): string | null {
  if (pool.status === 'ready' && !pool.driverAlertMessageId) {
    return 'Pool is ready but the driver alert has not been sent yet.';
  }

  if (pool.status === 'assigned' && pool.acceptedAt && minutesBetween(pool.acceptedAt, now) > 10) {
    return 'Driver accepted but has not arrived within the expected time.';
  }

  if (
    pool.status === 'arrival_requested' &&
    pool.arrivalRequestedAt &&
    minutesBetween(pool.arrivalRequestedAt, now) > 5
  ) {
    return 'Driver arrival is waiting for passenger confirmation.';
  }

  return null;
}

function minutesBetween(from: Date, to: Date): number {
  return (to.getTime() - from.getTime()) / 60_000;
}
