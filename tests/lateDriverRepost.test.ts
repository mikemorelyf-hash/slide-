import { describe, expect, it, vi } from 'vitest';
import type { Context, Telegraf } from 'telegraf';

import type { AppConfig } from '../src/config/env.js';
import type { RidePool } from '../src/domain/types.js';
import { repostLateDrivers } from '../src/bot/lateDriverRepost.js';
import type { PostgresRidePoolStore } from '../src/db/postgresRidePoolStore.js';
import type { RidePoolService } from '../src/domain/ridePoolService.js';

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

const config = {
  driverGroupChatId: '-100123',
  driverArrivalTimeoutMinutes: 10
} as AppConfig;

describe('late driver repost sweep', () => {
  it('posts ready pools that do not have a driver alert message', async () => {
    const store = {
      listReadyPoolsMissingDriverAlert: vi.fn().mockResolvedValue([readyPool]),
      findLateAssignedPools: vi.fn().mockResolvedValue([]),
      expireOpenReservations: vi.fn().mockResolvedValue(0),
      cancelEmptyStaleOpenPools: vi.fn().mockResolvedValue(0),
      enqueueNotification: vi.fn().mockResolvedValue('notification-1'),
      insertPoolEvent: vi.fn().mockResolvedValue(undefined)
    };
    const service = {
      markDriverAlertSent: vi.fn().mockResolvedValue(undefined)
    };
    const bot = {
      telegram: {
        sendMessage: vi.fn().mockResolvedValue({ message_id: 884 })
      }
    };

    await repostLateDrivers({
      config,
      store: store as unknown as PostgresRidePoolStore,
      service: service as unknown as RidePoolService,
      bot: bot as unknown as Telegraf<Context>
    });

    expect(store.listReadyPoolsMissingDriverAlert).toHaveBeenCalled();
    expect(store.enqueueNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        targetBot: 'driver',
        chatId: '-100123',
        messageType: 'driver_pool_ready',
        payload: expect.objectContaining({
          poolId: '11',
          text: expect.stringContaining('New Ride Pool Available')
        })
      })
    );
    expect(store.insertPoolEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        poolId: '11',
        actorRole: 'system',
        eventType: 'driver_alert_queued'
      })
    );
    expect(bot.telegram.sendMessage).not.toHaveBeenCalled();
    expect(service.markDriverAlertSent).not.toHaveBeenCalled();
  });
});
