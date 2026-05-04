import { describe, expect, it, vi } from 'vitest';

import {
  cancelPoolBeforeAssignment,
  repostReadyPoolDriverAlert,
  retryFailedNotifications
} from '../src/http/adminOperations.js';
import type { AppConfig } from '../src/config/env.js';
import type { NotificationOutboxInput, PoolEventInput, RidePool } from '../src/domain/types.js';

const readyPool: RidePool = {
  id: '9',
  routeId: '3',
  routeName: 'Mexico -> CMC',
  workflowChannel: 'telegram',
  pinCode: '6893',
  captainTelegramId: '7673099955',
  status: 'ready',
  passengerCount: 1,
  driverTelegramId: null,
  driverAlertMessageId: null,
  driverGroupChatId: null,
  isEarlyDispatch: true,
  earlyDispatchRequestedAt: null,
  arrivalRequestedAt: null,
  arrivedAt: null,
  priceAmount: 200,
  priceCurrency: 'ETB'
};

const config = {
  driverGroupChatId: '-100123'
} as AppConfig;

describe('admin operations', () => {
  it('queues a driver alert repost for a ready pool', async () => {
    const store = {
      getPool: vi.fn().mockResolvedValue(readyPool),
      enqueueNotification: vi.fn().mockResolvedValue('1'),
      insertPoolEvent: vi.fn().mockResolvedValue(undefined)
    };

    const result = await repostReadyPoolDriverAlert({
      store,
      config,
      poolId: '9',
      actorTelegramId: '7673099955'
    });

    expect(result.kind).toBe('queued');
    expect(store.enqueueNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        targetBot: 'driver',
        chatId: '-100123',
        messageType: 'driver_pool_reposted',
        payload: expect.objectContaining({
          poolId: '9',
          text: expect.stringContaining('Mexico -> CMC')
        })
      })
    );
    expect(store.insertPoolEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        poolId: '9',
        actorRole: 'admin',
        eventType: 'driver_alert_queued'
      })
    );
  });

  it('cancels a pool only before driver assignment', async () => {
    const store = {
      cancelPoolBeforeAssignment: vi.fn().mockResolvedValue({ ...readyPool, status: 'cancelled' }),
      insertPoolEvent: vi.fn().mockResolvedValue(undefined)
    };

    const result = await cancelPoolBeforeAssignment({
      store,
      poolId: '9',
      actorTelegramId: '7673099955'
    });

    expect(result.kind).toBe('cancelled');
    expect(store.cancelPoolBeforeAssignment).toHaveBeenCalledWith('9');
    expect(store.insertPoolEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        poolId: '9',
        actorRole: 'admin',
        eventType: 'pool_cancelled'
      })
    );
  });

  it('retries failed notifications', async () => {
    const store = {
      retryFailedNotifications: vi.fn().mockResolvedValue(3)
    };

    await expect(retryFailedNotifications({ store })).resolves.toEqual({
      kind: 'retried',
      count: 3
    });
  });
});
