import { describe, expect, it, vi } from 'vitest';

import { runRecoverySweep } from '../src/workers/recoveryWorker.js';
import type { RidePool } from '../src/domain/types.js';

const readyPool: RidePool = {
  id: '11',
  routeId: '7',
  routeName: 'Mexico -> Bole',
  workflowChannel: 'telegram',
  pinCode: '4334',
  captainTelegramId: '101',
  status: 'ready',
  passengerCount: 4,
  driverTelegramId: null,
  driverAlertMessageId: null,
  driverGroupChatId: null,
  isEarlyDispatch: false,
  earlyDispatchRequestedAt: null,
  arrivalRequestedAt: null,
  arrivedAt: null,
  priceAmount: 120,
  priceCurrency: 'ETB'
};

describe('recovery worker', () => {
  it('queues missing driver alerts instead of sending directly', async () => {
    const store = {
      listReadyPoolsMissingDriverAlert: vi.fn().mockResolvedValue([readyPool]),
      findLateAssignedPools: vi.fn().mockResolvedValue([]),
      enqueueNotification: vi.fn().mockResolvedValue('99'),
      insertPoolEvent: vi.fn().mockResolvedValue(undefined),
      expireOpenReservations: vi.fn().mockResolvedValue(0),
      cancelEmptyStaleOpenPools: vi.fn().mockResolvedValue(0)
    };

    await runRecoverySweep({
      store: store as never,
      driverGroupChatId: '-100123',
      driverArrivalTimeoutMinutes: 10
    });

    expect(store.enqueueNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        targetBot: 'driver',
        chatId: '-100123',
        messageType: 'driver_pool_ready'
      })
    );
    expect(store.insertPoolEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        poolId: '11',
        actorRole: 'system',
        eventType: 'driver_alert_queued'
      })
    );
  });
});
