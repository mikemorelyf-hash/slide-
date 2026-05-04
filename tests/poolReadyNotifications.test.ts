import { Telegram } from 'telegraf';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createRidePoolBot } from '../src/bot/createBot.js';
import { poolReadyPassengerMessage } from '../src/bot/messages.js';
import type { AppConfig } from '../src/config/env.js';
import type { RidePoolService } from '../src/domain/ridePoolService.js';
import type {
  NotificationOutboxInput,
  PoolPassenger,
  RidePool,
  Route,
  TelegramUserProfile
} from '../src/domain/types.js';
import type { PostgresRidePoolStore } from '../src/db/postgresRidePoolStore.js';

const route: Route = {
  id: 'route-1',
  name: 'Mexico -> Piyasa',
  isActive: true,
  priceAmount: 85,
  priceCurrency: 'ETB'
};

const pool: RidePool = {
  id: 'pool-1',
  routeId: route.id,
  routeName: route.name,
  workflowChannel: 'telegram',
  pinCode: '4304',
  captainTelegramId: '111',
  status: 'ready',
  passengerCount: 2,
  driverTelegramId: null,
  driverAlertMessageId: null,
  driverGroupChatId: null,
  isEarlyDispatch: true,
  earlyDispatchRequestedAt: new Date('2026-05-02T00:00:00.000Z'),
  arrivalRequestedAt: null,
  arrivedAt: null,
  priceAmount: 85,
  priceCurrency: 'ETB'
};

const confirmedCaptain: PoolPassenger = {
  poolId: pool.id,
  telegramId: '111',
  isCaptain: true,
  paymentStatus: 'confirmed',
  earlyDispatchVote: 'pending'
};

const profile: TelegramUserProfile = {
  telegramId: '111',
  firstName: 'Michael',
  lastName: null,
  username: 'michael_test',
  phoneNumber: '+251900000000',
  locationLabel: null,
  role: 'passenger',
  driverBotStartedAt: null
};

function testConfig(): AppConfig {
  return {
    nodeEnv: 'test',
    port: 3000,
    databaseUrl: 'postgresql://test',
    pgSslMode: 'disable',
    pgPoolMax: 6,
    pgIdleTimeoutMs: 15_000,
    pgConnectionTimeoutMs: 5_000,
    botToken: '123456:test',
    driverBotToken: '654321:test',
    botMode: 'polling',
    baseUrl: null,
    webhookPath: '/telegram/webhook',
    driverWebhookPath: '/telegram/driver-webhook',
    webhookSecret: null,
    driverGroupChatId: '-100123',
    adminChatId: null,
    adminTelegramIds: [],
    frontendOrigin: true,
    poolSize: 4,
    driverArrivalTimeoutMinutes: 10,
    lateDriverSweepIntervalSeconds: 60,
    autoSeedRoutes: false,
    routes: [],
    miniAppUrl: null,
    miniAppInitDataMaxAgeSeconds: 86_400
  };
}

interface TelegramApiCall {
  method: string;
  payload: Record<string, unknown>;
}

function stubTelegramApi(): TelegramApiCall[] {
  const calls: TelegramApiCall[] = [];
  vi.spyOn(Telegram.prototype, 'callApi').mockImplementation(
    async (method, payload: Record<string, unknown>) => {
      calls.push({ method, payload });
      if (method === 'getMe') {
        return {
          id: 123456,
          is_bot: true,
          first_name: 'Test Bot',
          username: 'test_bot',
          can_join_groups: true,
          can_read_all_group_messages: false,
          supports_inline_queries: false
        };
      }
      return true;
    }
  );
  return calls;
}

function buttonLabels(payload: Record<string, unknown>): string[] {
  const replyMarkup = payload.reply_markup as
    | { inline_keyboard?: Array<Array<{ text?: string }>> }
    | undefined;
  return replyMarkup?.inline_keyboard?.flatMap((row) => row.map((button) => button.text ?? '')) ?? [];
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('pool ready Telegram notifications', () => {
  it('does not queue the same pool-ready text for the passenger who already got a callback reply', async () => {
    const enqueued: NotificationOutboxInput[] = [];
    const store = {
      getCompletedIdempotency: vi.fn().mockResolvedValue(null),
      createIdempotencyProcessing: vi.fn().mockResolvedValue('created'),
      completeIdempotency: vi.fn().mockResolvedValue(undefined),
      failIdempotency: vi.fn().mockResolvedValue(undefined),
      upsertTelegramUser: vi.fn().mockResolvedValue(undefined),
      getUserProfile: vi.fn().mockResolvedValue(profile),
      getConfirmedPassengerTelegramIds: vi.fn().mockResolvedValue(['111', '222']),
      enqueueNotifications: vi.fn().mockImplementation(async (inputs: NotificationOutboxInput[]) => {
        enqueued.push(...inputs);
        return inputs.map((_, index) => `notification-${index}`);
      })
    } as unknown as PostgresRidePoolStore;
    const service = {
      confirmPayment: vi.fn().mockResolvedValue({
        kind: 'pool_ready',
        pool,
        passenger: { isCaptain: true },
        passengerCount: 2
      })
    } as unknown as RidePoolService;
    const bot = createRidePoolBot({
      config: testConfig(),
      store,
      service,
      bots: {}
    });
    const apiCalls = stubTelegramApi();

    await bot.handleUpdate({
      update_id: 101,
      callback_query: {
        id: 'callback-101',
        from: {
          id: 111,
          is_bot: false,
          first_name: 'Michael',
          username: 'michael_test'
        },
        message: {
          message_id: 9,
          date: 1_774_000_000,
          chat: { id: 111, type: 'private' },
          text: 'Payment prompt'
        },
        chat_instance: 'chat-instance',
        data: `paid:${pool.id}`
      }
    } as never);

    const passengerVisibleMessages = apiCalls
      .filter((call) => call.method === 'sendMessage' || call.method === 'editMessageText')
      .map((call) => call.payload.text);
    expect(passengerVisibleMessages).toContain(poolReadyPassengerMessage(pool));
    expect(enqueued.filter((item) => item.messageType === 'pool_ready').map((item) => item.chatId)).toEqual(['222']);
  });

  it('edits the route menu into the selected route card instead of sending another route card', async () => {
    const store = {
      upsertTelegramUser: vi.fn().mockResolvedValue(undefined),
      getUserProfile: vi.fn().mockResolvedValue(profile),
      getRoute: vi.fn().mockResolvedValue(route)
    } as unknown as PostgresRidePoolStore;
    const service = {
      findOpenPoolForRoute: vi.fn().mockResolvedValue(null)
    } as unknown as RidePoolService;
    const bot = createRidePoolBot({
      config: testConfig(),
      store,
      service,
      bots: {}
    });
    const apiCalls = stubTelegramApi();

    await bot.handleUpdate({
      update_id: 102,
      callback_query: {
        id: 'callback-102',
        from: {
          id: 111,
          is_bot: false,
          first_name: 'Michael',
          username: 'michael_test'
        },
        message: {
          message_id: 12,
          date: 1_774_000_000,
          chat: { id: 111, type: 'private' },
          text: 'Choose a route to find or create a ride pool.'
        },
        chat_instance: 'chat-instance',
        data: `route:${route.id}`
      }
    } as never);

    expect(
      apiCalls.some(
        (call) =>
          call.method === 'editMessageText' &&
          typeof call.payload.text === 'string' &&
          call.payload.text.includes(`No active pool available for ${route.name}.`)
      )
    ).toBe(true);
    expect(
      apiCalls.some(
        (call) =>
          call.method === 'sendMessage' &&
          typeof call.payload.text === 'string' &&
          call.payload.text.includes(`No active pool available for ${route.name}.`)
      )
    ).toBe(false);
  });

  it("does not show Let's Go Now until the confirmed captain has shared a phone number", async () => {
    const store = {
      getCompletedIdempotency: vi.fn().mockResolvedValue(null),
      createIdempotencyProcessing: vi.fn().mockResolvedValue('created'),
      completeIdempotency: vi.fn().mockResolvedValue(undefined),
      failIdempotency: vi.fn().mockResolvedValue(undefined),
      upsertTelegramUser: vi.fn().mockResolvedValue(undefined),
      getUserProfile: vi.fn().mockResolvedValue({ ...profile, phoneNumber: null })
    } as unknown as PostgresRidePoolStore;
    const service = {
      confirmPayment: vi.fn().mockResolvedValue({
        kind: 'confirmed',
        pool: { ...pool, status: 'open', passengerCount: 1 },
        passenger: confirmedCaptain,
        passengerCount: 1
      })
    } as unknown as RidePoolService;
    const bot = createRidePoolBot({
      config: testConfig(),
      store,
      service,
      bots: {}
    });
    const apiCalls = stubTelegramApi();

    await bot.handleUpdate({
      update_id: 103,
      callback_query: {
        id: 'callback-103',
        from: {
          id: 111,
          is_bot: false,
          first_name: 'Michael',
          username: 'michael_test'
        },
        message: {
          message_id: 13,
          date: 1_774_000_000,
          chat: { id: 111, type: 'private' },
          text: 'Pool Mexico -> Piyasa'
        },
        chat_instance: 'chat-instance',
        data: `paid:${pool.id}`
      }
    } as never);

    expect(apiCalls.flatMap((call) => buttonLabels(call.payload))).not.toContain("Let's Go Now");
  });

  it("shows Let's Go Now after a confirmed captain shares their phone number", async () => {
    const activePool = { ...pool, status: 'open' as const, passengerCount: 1 };
    const store = {
      upsertTelegramUser: vi.fn().mockResolvedValue(undefined),
      getUserProfile: vi.fn().mockResolvedValue(profile),
      updateUserContact: vi.fn().mockResolvedValue(undefined),
      getPendingPassengerAction: vi.fn().mockResolvedValue(null),
      getActivePoolForPassenger: vi.fn().mockResolvedValue({
        pool: activePool,
        passenger: confirmedCaptain
      })
    } as unknown as PostgresRidePoolStore;
    const bot = createRidePoolBot({
      config: testConfig(),
      store,
      service: {} as RidePoolService,
      bots: {}
    });
    const apiCalls = stubTelegramApi();

    await bot.handleUpdate({
      update_id: 104,
      message: {
        message_id: 14,
        date: 1_774_000_000,
        chat: { id: 111, type: 'private' },
        from: {
          id: 111,
          is_bot: false,
          first_name: 'Michael',
          username: 'michael_test'
        },
        contact: {
          phone_number: '+251900000000',
          first_name: 'Michael',
          user_id: 111
        }
      }
    } as never);

    expect(apiCalls.flatMap((call) => buttonLabels(call.payload))).toContain("Let's Go Now");
  });

  it('requires a phone number before creating a pool and saves the intended route', async () => {
    const savePendingPassengerAction = vi.fn().mockResolvedValue(undefined);
    const createPool = vi.fn();
    const store = {
      getCompletedIdempotency: vi.fn().mockResolvedValue(null),
      createIdempotencyProcessing: vi.fn().mockResolvedValue('created'),
      completeIdempotency: vi.fn().mockResolvedValue(undefined),
      failIdempotency: vi.fn().mockResolvedValue(undefined),
      upsertTelegramUser: vi.fn().mockResolvedValue(undefined),
      getUserProfile: vi.fn().mockResolvedValue({ ...profile, phoneNumber: null }),
      savePendingPassengerAction
    } as unknown as PostgresRidePoolStore;
    const service = { createPool } as unknown as RidePoolService;
    const bot = createRidePoolBot({
      config: testConfig(),
      store,
      service,
      bots: {}
    });
    const apiCalls = stubTelegramApi();

    await bot.handleUpdate({
      update_id: 105,
      callback_query: {
        id: 'callback-105',
        from: {
          id: 111,
          is_bot: false,
          first_name: 'Michael',
          username: 'michael_test'
        },
        message: {
          message_id: 15,
          date: 1_774_000_000,
          chat: { id: 111, type: 'private' },
          text: 'No active pool available'
        },
        chat_instance: 'chat-instance',
        data: `create:${route.id}`
      }
    } as never);

    expect(createPool).not.toHaveBeenCalled();
    expect(savePendingPassengerAction).toHaveBeenCalledWith(
      expect.objectContaining({
        telegramId: '111',
        actionType: 'create_pool',
        routeId: route.id,
        poolId: null
      })
    );
    expect(
      apiCalls.some(
        (call) =>
          (call.method === 'editMessageText' || call.method === 'sendMessage') &&
          typeof call.payload.text === 'string' &&
          call.payload.text.includes('Share your phone number before payment')
      )
    ).toBe(true);
  });

  it('requires a phone number before joining a pool and saves the intended pool', async () => {
    const savePendingPassengerAction = vi.fn().mockResolvedValue(undefined);
    const joinPool = vi.fn();
    const store = {
      getCompletedIdempotency: vi.fn().mockResolvedValue(null),
      createIdempotencyProcessing: vi.fn().mockResolvedValue('created'),
      completeIdempotency: vi.fn().mockResolvedValue(undefined),
      failIdempotency: vi.fn().mockResolvedValue(undefined),
      upsertTelegramUser: vi.fn().mockResolvedValue(undefined),
      getUserProfile: vi.fn().mockResolvedValue({ ...profile, phoneNumber: null }),
      savePendingPassengerAction
    } as unknown as PostgresRidePoolStore;
    const service = { joinPool } as unknown as RidePoolService;
    const bot = createRidePoolBot({
      config: testConfig(),
      store,
      service,
      bots: {}
    });
    const apiCalls = stubTelegramApi();

    await bot.handleUpdate({
      update_id: 106,
      callback_query: {
        id: 'callback-106',
        from: {
          id: 111,
          is_bot: false,
          first_name: 'Michael',
          username: 'michael_test'
        },
        message: {
          message_id: 16,
          date: 1_774_000_000,
          chat: { id: 111, type: 'private' },
          text: 'Open pool found'
        },
        chat_instance: 'chat-instance',
        data: `join:${pool.id}`
      }
    } as never);

    expect(joinPool).not.toHaveBeenCalled();
    expect(savePendingPassengerAction).toHaveBeenCalledWith(
      expect.objectContaining({
        telegramId: '111',
        actionType: 'join_pool',
        routeId: null,
        poolId: pool.id
      })
    );
    expect(
      apiCalls.some(
        (call) =>
          (call.method === 'editMessageText' || call.method === 'sendMessage') &&
          typeof call.payload.text === 'string' &&
          call.payload.text.includes('Share your phone number before payment')
      )
    ).toBe(true);
  });

  it('continues a saved create-pool action after the passenger shares their phone', async () => {
    const clearPendingPassengerAction = vi.fn().mockResolvedValue(undefined);
    const createdPool = { ...pool, status: 'open' as const, passengerCount: 1 };
    const store = {
      upsertTelegramUser: vi.fn().mockResolvedValue(undefined),
      getUserProfile: vi.fn().mockResolvedValue(profile),
      updateUserContact: vi.fn().mockResolvedValue(undefined),
      getPendingPassengerAction: vi.fn().mockResolvedValue({
        telegramId: '111',
        actionType: 'create_pool',
        routeId: route.id,
        poolId: null
      }),
      clearPendingPassengerAction,
      getActivePoolForPassenger: vi.fn().mockResolvedValue(null)
    } as unknown as PostgresRidePoolStore;
    const service = {
      createPool: vi.fn().mockResolvedValue({
        kind: 'payment_required',
        pool: createdPool,
        passenger: { ...confirmedCaptain, paymentStatus: 'pending' }
      })
    } as unknown as RidePoolService;
    const bot = createRidePoolBot({
      config: testConfig(),
      store,
      service,
      bots: {}
    });
    const apiCalls = stubTelegramApi();

    await bot.handleUpdate({
      update_id: 107,
      message: {
        message_id: 17,
        date: 1_774_000_000,
        chat: { id: 111, type: 'private' },
        from: {
          id: 111,
          is_bot: false,
          first_name: 'Michael',
          username: 'michael_test'
        },
        contact: {
          phone_number: '+251900000000',
          first_name: 'Michael',
          user_id: 111
        }
      }
    } as never);

    expect(service.createPool).toHaveBeenCalledWith(route.id, '111');
    expect(clearPendingPassengerAction).toHaveBeenCalledWith('111');
    expect(
      apiCalls.some(
        (call) =>
          call.method === 'sendMessage' &&
          typeof call.payload.text === 'string' &&
          call.payload.text.includes('Tap I Have Paid after you complete payment')
      )
    ).toBe(true);
  });
});
