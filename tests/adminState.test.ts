import { describe, expect, it } from 'vitest';

import {
  buildAdminOverview,
  isAdminTelegramId,
  parseRoutePriceBody
} from '../src/http/adminState.js';
import type { AdminPoolSummary } from '../src/domain/adminTypes.js';
import type { Route } from '../src/domain/types.js';

const route: Route = {
  id: '1',
  name: 'Mexico -> Bole',
  isActive: true,
  priceAmount: 120,
  priceCurrency: 'ETB'
};

const basePool: AdminPoolSummary = {
  id: '11',
  routeId: '1',
  routeName: 'Mexico -> Bole',
  workflowChannel: 'telegram',
  pinCode: '4334',
  captainTelegramId: '101',
  status: 'open',
  passengerCount: 1,
  driverTelegramId: null,
  driverAlertMessageId: null,
  driverGroupChatId: null,
  isEarlyDispatch: false,
  earlyDispatchRequestedAt: null,
  arrivalRequestedAt: null,
  arrivedAt: null,
  priceAmount: 120,
  priceCurrency: 'ETB',
  pendingPassengerCount: 1,
  cancelledPassengerCount: 0,
  captain: {
    telegramId: '101',
    firstName: 'Michael',
    lastName: 'Fasil',
    username: 'michael'
  },
  driver: null,
  sentToDriversAt: null,
  acceptedAt: null,
  createdAt: new Date('2026-04-29T09:00:00.000Z'),
  updatedAt: new Date('2026-04-29T09:05:00.000Z')
};

describe('admin dashboard state helpers', () => {
  it('allows only configured Telegram admin IDs', () => {
    expect(isAdminTelegramId('101', ['101', '202'])).toBe(true);
    expect(isAdminTelegramId('303', ['101', '202'])).toBe(false);
    expect(isAdminTelegramId(null, ['101'])).toBe(false);
  });

  it('parses valid route price updates with a default currency', () => {
    expect(parseRoutePriceBody({ amount: 75 })).toEqual({
      ok: true,
      amount: 75,
      currency: 'ETB'
    });
    expect(parseRoutePriceBody({ priceAmount: '120.5', priceCurrency: 'usd' })).toEqual({
      ok: true,
      amount: 120.5,
      currency: 'USD'
    });
  });

  it('rejects invalid route price updates', () => {
    expect(parseRoutePriceBody({ amount: 0 })).toEqual({ ok: false, error: 'invalid_price_amount' });
    expect(parseRoutePriceBody({ amount: -1 })).toEqual({ ok: false, error: 'invalid_price_amount' });
    expect(parseRoutePriceBody({ amount: 10, currency: '' })).toEqual({
      ok: false,
      error: 'invalid_price_currency'
    });
  });

  it('builds overview metrics from real pool statuses', () => {
    const overview = buildAdminOverview({
      routes: [route],
      completedToday: 4,
      pools: [
        { ...basePool, id: '1', status: 'open' },
        { ...basePool, id: '2', status: 'ready' },
        {
          ...basePool,
          id: '3',
          status: 'arrival_requested',
          arrivalRequestedAt: new Date('2026-04-29T09:10:00.000Z')
        },
        { ...basePool, id: '4', status: 'in_progress' },
        { ...basePool, id: '5', status: 'completed' }
      ],
      pendingNotifications: 2,
      failedNotifications: 1,
      now: new Date('2026-04-29T09:20:00.000Z')
    });

    expect(overview.metrics).toEqual({
      activePools: 4,
      openPools: 1,
      waitingDriverPools: 1,
      arrivalPendingPools: 1,
      inProgressTrips: 1,
      completedToday: 4
    });
    expect(overview.stability.pendingNotifications).toBe(2);
    expect(overview.stability.failedNotifications).toBe(1);
    expect(overview.stability.stuckPools).toEqual([
      {
        poolId: '2',
        routeName: 'Mexico -> Bole',
        status: 'ready',
        reason: 'Pool is ready but the driver alert has not been sent yet.'
      },
      {
        poolId: '3',
        routeName: 'Mexico -> Bole',
        status: 'arrival_requested',
        reason: 'Driver arrival is waiting for passenger confirmation.'
      }
    ]);
    expect(overview.routes).toEqual([route]);
    expect(overview.pools).toHaveLength(5);
  });
});
