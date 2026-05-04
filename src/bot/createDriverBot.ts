import { Markup, Telegraf, type Context } from 'telegraf';

import type { AppConfig } from '../config/env.js';
import { PostgresRidePoolStore } from '../db/postgresRidePoolStore.js';
import { createRequestHash, runIdempotent } from '../domain/idempotency.js';
import { RidePoolService } from '../domain/ridePoolService.js';
import type { RidePool, TelegramUserProfile } from '../domain/types.js';
import type { BotRegistry } from './botRegistry.js';
import { ensureDriverBotStarted, ensurePrivateDriverChat } from './driverAccess.js';
import { parseDriverPinMessage } from './driverPinMessage.js';
import {
  driverAssignedGroupMessage,
  driverArrivalRequestCaptainMessage,
  driverArrivalRequestSentMessage,
  driverManifestMessage,
  passengerDriverAssignedMessage,
  tripCompletedDriverMessage,
  tripCompletedPassengerMessage
} from './messages.js';

interface DriverBotDeps {
  config: AppConfig;
  store: PostgresRidePoolStore;
  service: RidePoolService;
  bots: BotRegistry;
}

export function createDriverBot({ config, store, service, bots }: DriverBotDeps): Telegraf<Context> {
  if (!config.driverBotToken) {
    throw new Error('DRIVER_BOT_TOKEN is required to create the driver bot');
  }

  const bot = new Telegraf(config.driverBotToken);

  bot.start(async (ctx) => {
    const profile = await upsertUserFromContext(ctx, store, 'driver');
    if (!(await ensurePrivateDriverChat(ctx))) {
      return;
    }
    await store.markDriverBotStarted(profile.telegramId);
    await ctx.reply(
      [
        'Driver bot ready.',
        'You can accept jobs from the driver group.',
        'After a trip, send the 4-digit PIN here.'
      ].join('\n')
    );
  });

  bot.command('complete', async (ctx) => {
    const telegramId = requireTelegramUserId(ctx);
    if (!telegramId) {
      return;
    }

    if (!(await ensurePrivateDriverChat(ctx))) {
      return;
    }

    await upsertUserFromContext(ctx, store, 'driver');
    await store.markDriverBotStarted(telegramId);
    const pinCode = readCommandArgument(ctx);
    if (!pinCode) {
      await ctx.reply('Usage: /complete 4334');
      return;
    }

    await completeTripFromPin(ctx, config, store, service, bots.passengerBot ?? bot, pinCode);
  });

  bot.hears(/^\s*\d{4}\s*$/, async (ctx) => {
    const pinCode = parseDriverPinMessage(ctx.message.text);
    if (!pinCode) {
      return;
    }

    const telegramId = requireTelegramUserId(ctx);
    if (!telegramId) {
      return;
    }
    if (!(await ensurePrivateDriverChat(ctx))) {
      return;
    }
    await upsertUserFromContext(ctx, store, 'driver');
    await store.markDriverBotStarted(telegramId);
    await completeTripFromPin(ctx, config, store, service, bots.passengerBot ?? bot, pinCode);
  });

  bot.action(/^accept:(.+)$/, async (ctx) => {
    await runTelegramAction(ctx, store, `accept:${ctx.match[1]}`, async () => {
      const telegramId = requireTelegramUserId(ctx);
      if (!telegramId) {
        await ctx.answerCbQuery('Open the driver bot first, then try again.');
        return;
      }

      if (!(await ensureDriverBotStarted(ctx, store, telegramId))) {
        return;
      }

      const driverProfile = await upsertUserFromContext(ctx, store, 'driver');
      const result = await service.acceptJob(ctx.match[1], telegramId);

      if (result.kind === 'already_taken') {
        await ctx.answerCbQuery('Sorry, this job has already been taken.', { show_alert: true });
        return;
      }

      await ctx.answerCbQuery('You accepted the job.');
      const driverLabel = driverProfile.username
        ? `@${driverProfile.username}`
        : driverProfile.firstName ?? `Telegram ${driverProfile.telegramId}`;

      try {
        await ctx.editMessageText(driverAssignedGroupMessage(result.pool, driverLabel));
      } catch (error) {
        console.warn('Could not edit driver group alert', error);
      }

      await store.enqueueNotification({
        targetBot: 'driver',
        chatId: telegramId,
        messageType: 'driver_manifest',
        payload: {
          text: driverManifestMessage(result.pool, result.manifest),
          replyMarkup: Markup.inlineKeyboard([
            [Markup.button.callback('I Arrived', `arrived:${result.pool.id}`)]
          ]).reply_markup
        }
      });

      await notifyPassengersDriverAssigned(bots.passengerBot ?? bot, store, result.pool, driverProfile);
    });
  });

  bot.action(/^arrived:(.+)$/, async (ctx) => {
    await runTelegramAction(ctx, store, `arrived:${ctx.match[1]}`, async () => {
      const telegramId = requireTelegramUserId(ctx);
      if (!telegramId) {
        await ctx.answerCbQuery('Open the driver bot first, then try again.');
        return;
      }

      const driverProfile = await upsertUserFromContext(ctx, store, 'driver');
      const result = await service.requestDriverArrival(ctx.match[1], telegramId);
      if (result.kind === 'not_allowed') {
        await ctx.answerCbQuery('Arrival request is not available for this job.', {
          show_alert: true
        });
        return;
      }

      await ctx.answerCbQuery('Arrival request sent.');
      await ctx.reply(driverArrivalRequestSentMessage(result.pool));

      const passengerIds = [result.captainTelegramId, ...result.passengerIdsToNotify];
      await store.enqueueNotifications(
        passengerIds.map((passengerId) => ({
          targetBot: 'passenger' as const,
          chatId: passengerId,
          messageType: 'driver_arrival_requested',
          payload: {
            text: driverArrivalRequestCaptainMessage(result.pool, driverProfile),
            replyMarkup: Markup.inlineKeyboard([
              [Markup.button.callback('Confirm Arrival', `confirm_arrival:${result.pool.id}`)],
              [Markup.button.callback('Driver Not Here', `reject_arrival:${result.pool.id}`)]
            ]).reply_markup
          }
        }))
      );
    });
  });

  bot.catch(async (error, ctx) => {
    console.error('Driver bot error', error);
    try {
      await ctx.reply('Sorry, something went wrong. Please try again.');
    } catch (replyError) {
      console.error('Could not send driver bot error reply', replyError);
    }
  });

  return bot;
}

async function completeTripFromPin(
  ctx: Context,
  config: AppConfig,
  store: PostgresRidePoolStore,
  service: RidePoolService,
  passengerBot: Telegraf<Context>,
  pinCode: string
): Promise<void> {
  const telegramId = requireTelegramUserId(ctx);
  if (!telegramId) {
    return;
  }

  await upsertUserFromContext(ctx, store, 'driver');
  const result = await service.completeTrip(pinCode, telegramId);
  if (result.kind === 'invalid_pin') {
    await ctx.reply('Invalid PIN. Please check with the passengers and try again.');
    return;
  }

  await ctx.reply(tripCompletedDriverMessage(result.pool));
  await notifyTripCompleted(passengerBot, config, store, result.pool);
}

async function notifyPassengersDriverAssigned(
  bot: Telegraf<Context>,
  store: PostgresRidePoolStore,
  pool: RidePool,
  driverProfile: TelegramUserProfile
): Promise<void> {
  const passengerIds = await store.getConfirmedPassengerTelegramIds(pool.id);
  await store.enqueueNotifications(
    passengerIds.map((telegramId) => ({
      targetBot: 'passenger' as const,
      chatId: telegramId,
      messageType: 'driver_assigned_passenger',
      payload: { text: passengerDriverAssignedMessage(pool, driverProfile) }
    }))
  );
}

async function notifyTripCompleted(
  bot: Telegraf<Context>,
  config: AppConfig,
  store: PostgresRidePoolStore,
  pool: RidePool
): Promise<void> {
  const passengerIds = await store.getConfirmedPassengerTelegramIds(pool.id);
  await store.enqueueNotifications(
    passengerIds.map((telegramId) => ({
      targetBot: 'passenger' as const,
      chatId: telegramId,
      messageType: 'trip_completed_passenger',
      payload: { text: tripCompletedPassengerMessage(pool) }
    }))
  );

  if (config.adminChatId) {
    await store.enqueueNotification({
      targetBot: 'passenger',
      chatId: config.adminChatId,
      messageType: 'trip_completed_admin',
      payload: {
        text: [
          `Trip completed.`,
          `Route: ${pool.routeName}`,
          `PIN: ${pool.pinCode}`,
          `Driver: ${pool.driverTelegramId}`
        ].join('\n')
      }
    });
  }
}

async function upsertUserFromContext(
  ctx: Context,
  store: PostgresRidePoolStore,
  role: TelegramUserProfile['role'] = 'driver'
): Promise<TelegramUserProfile> {
  const from = ctx.from;
  if (!from) {
    throw new Error('Telegram update did not include a user');
  }

  const profile: TelegramUserProfile = {
    telegramId: String(from.id),
    firstName: from.first_name ?? null,
    lastName: from.last_name ?? null,
    username: from.username ?? null,
    role
  };
  await store.upsertTelegramUser(profile);
  return (await store.getUserProfile(profile.telegramId)) ?? profile;
}

async function runTelegramAction(
  ctx: Context,
  store: PostgresRidePoolStore,
  action: string,
  work: () => Promise<void>
): Promise<void> {
  const telegramId = requireTelegramUserId(ctx);
  const updateId = 'update_id' in ctx.update ? ctx.update.update_id : 'unknown';
  const callbackQuery = 'callbackQuery' in ctx ? ctx.callbackQuery : undefined;
  const callbackId =
    callbackQuery && 'id' in callbackQuery && typeof callbackQuery.id === 'string'
      ? callbackQuery.id
      : null;

  try {
    await runIdempotent(store, {
      key: callbackId
        ? `telegram-callback:${callbackId}`
        : `telegram-action:${telegramId ?? 'unknown'}:${updateId}:${action}`,
      source: 'telegram_callback',
      actorTelegramId: telegramId,
      requestHash: createRequestHash({ action, telegramId }),
      expiresInSeconds: 86_400,
      work: async () => {
        await work();
        return { ok: true };
      }
    });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Action is already being processed')) {
      try {
        await ctx.answerCbQuery('Already processing. Please wait.');
      } catch {
        await ctx.reply('Already processing. Please wait.');
      }
      return;
    }

    throw error;
  }
}

function requireTelegramUserId(ctx: Context): string | null {
  if (!ctx.from?.id) {
    return null;
  }

  return String(ctx.from.id);
}

function readCommandArgument(ctx: Context): string | null {
  const message = ctx.message;
  if (!message || !('text' in message) || typeof message.text !== 'string') {
    return null;
  }

  return message.text.trim().split(/\s+/)[1] ?? null;
}
