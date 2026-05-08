import { Markup, Telegraf, type Context } from 'telegraf';

import type { AppConfig } from '../config/env.js';
import { PostgresRidePoolStore } from '../db/postgresRidePoolStore.js';
import { createRequestHash, runIdempotent } from '../domain/idempotency.js';
import { isSupportedLanguageCode, type SupportedLanguageCode } from '../domain/language.js';
import { RidePoolService } from '../domain/ridePoolService.js';
import type { RidePool, TelegramUserProfile } from '../domain/types.js';
import type { BotRegistry } from './botRegistry.js';
import { ensureDriverBotStarted, ensurePrivateDriverChat } from './driverAccess.js';
import { parseDriverPinMessage } from './driverPinMessage.js';
import { getLanguageTargets, getUserLanguage, profileLanguage } from './language.js';
import {
  botLabel,
  driverAssignedGroupMessage,
  driverArrivalRequestCaptainMessage,
  driverArrivalRequestSentMessage,
  driverManifestMessage,
  languageMenuMessage,
  languageUpdatedMessage,
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
    const language = profileLanguage(profile);
    if (!(await ensurePrivateDriverChat(ctx, language))) {
      return;
    }
    await store.markDriverBotStarted(profile.telegramId);
    await ctx.reply(botLabel('driverBotReady', language));
  });

  bot.command('language', async (ctx) => {
    const profile = await upsertUserFromContext(ctx, store, 'driver');
    const language = profileLanguage(profile);
    await ctx.reply(languageMenuMessage(language), languageKeyboard(language));
  });

  bot.action(/^language:(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const telegramId = requireTelegramUserId(ctx);
    if (!telegramId) {
      return;
    }

    const nextLanguage = isSupportedLanguageCode(ctx.match[1]) ? ctx.match[1] : 'en';
    await upsertUserFromContext(ctx, store, 'driver');
    await store.updateUserLanguage(telegramId, nextLanguage);
    await editOrReply(ctx, languageUpdatedMessage(nextLanguage), languageKeyboard(nextLanguage));
  });

  bot.command('complete', async (ctx) => {
    const telegramId = requireTelegramUserId(ctx);
    if (!telegramId) {
      return;
    }

    const language = await getUserLanguage(store, telegramId);
    if (!(await ensurePrivateDriverChat(ctx, language))) {
      return;
    }

    await upsertUserFromContext(ctx, store, 'driver');
    await store.markDriverBotStarted(telegramId);
    const pinCode = readCommandArgument(ctx);
    if (!pinCode) {
      await ctx.reply(botLabel('usageComplete', language));
      return;
    }

    await completeTripFromPin(ctx, config, store, service, bots.passengerBot ?? bot, pinCode, language);
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
    const language = await getUserLanguage(store, telegramId);
    if (!(await ensurePrivateDriverChat(ctx, language))) {
      return;
    }
    await upsertUserFromContext(ctx, store, 'driver');
    await store.markDriverBotStarted(telegramId);
    await completeTripFromPin(ctx, config, store, service, bots.passengerBot ?? bot, pinCode, language);
  });

  bot.action(/^accept:(.+)$/, async (ctx) => {
    await runTelegramAction(ctx, store, `accept:${ctx.match[1]}`, async () => {
      const telegramId = requireTelegramUserId(ctx);
      if (!telegramId) {
        await ctx.answerCbQuery(botLabel('openDriverBotFirst'));
        return;
      }

      const language = await getUserLanguage(store, telegramId);
      if (!(await ensureDriverBotStarted(ctx, store, telegramId, language))) {
        return;
      }

      const driverProfile = await upsertUserFromContext(ctx, store, 'driver');
      const result = await service.acceptJob(ctx.match[1], telegramId);

      if (result.kind === 'already_taken') {
        await ctx.answerCbQuery(botLabel('jobTaken', language), { show_alert: true });
        return;
      }

      await ctx.answerCbQuery(botLabel('jobAccepted', language));
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
          text: driverManifestMessage(result.pool, result.manifest, language),
          replyMarkup: Markup.inlineKeyboard([
            [Markup.button.callback(botLabel('iArrived', language), `arrived:${result.pool.id}`)]
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
        await ctx.answerCbQuery(botLabel('openDriverBotFirst'));
        return;
      }

      const language = await getUserLanguage(store, telegramId);
      const driverProfile = await upsertUserFromContext(ctx, store, 'driver');
      const result = await service.requestDriverArrival(ctx.match[1], telegramId);
      if (result.kind === 'not_allowed') {
        await ctx.answerCbQuery(botLabel('arrivalNotAvailable', language), {
          show_alert: true
        });
        return;
      }

      await ctx.answerCbQuery(botLabel('arrivalRequestSentCallback', language));
      await ctx.reply(driverArrivalRequestSentMessage(result.pool, language));

      const passengerIds = [result.captainTelegramId, ...result.passengerIdsToNotify];
      const passengerTargets = await getLanguageTargets(store, passengerIds);
      await store.enqueueNotifications(
        passengerTargets.map(({ telegramId: passengerId, language: passengerLanguage }) => ({
          targetBot: 'passenger' as const,
          chatId: passengerId,
          messageType: 'driver_arrival_requested',
          payload: {
            text: driverArrivalRequestCaptainMessage(result.pool, driverProfile, passengerLanguage),
            replyMarkup: Markup.inlineKeyboard([
              [Markup.button.callback(botLabel('confirmArrival', passengerLanguage), `confirm_arrival:${result.pool.id}`)],
              [Markup.button.callback(botLabel('driverNotHere', passengerLanguage), `reject_arrival:${result.pool.id}`)]
            ]).reply_markup
          }
        }))
      );
    });
  });

  bot.catch(async (error, ctx) => {
    console.error('Driver bot error', error);
    try {
      const language = await getUserLanguage(store, requireTelegramUserId(ctx));
      await ctx.reply(botLabel('genericError', language));
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
  pinCode: string,
  language: SupportedLanguageCode
): Promise<void> {
  const telegramId = requireTelegramUserId(ctx);
  if (!telegramId) {
    return;
  }

  await upsertUserFromContext(ctx, store, 'driver');
  const result = await service.completeTrip(pinCode, telegramId);
  if (result.kind === 'invalid_pin') {
    await ctx.reply(botLabel('invalidPin', language));
    return;
  }

  await ctx.reply(tripCompletedDriverMessage(result.pool, language));
  await notifyTripCompleted(passengerBot, config, store, result.pool);
}

async function notifyPassengersDriverAssigned(
  bot: Telegraf<Context>,
  store: PostgresRidePoolStore,
  pool: RidePool,
  driverProfile: TelegramUserProfile
): Promise<void> {
  const passengerIds = await store.getConfirmedPassengerTelegramIds(pool.id);
  const targets = await getLanguageTargets(store, passengerIds);
  await store.enqueueNotifications(
    targets.map(({ telegramId, language }) => ({
      targetBot: 'passenger' as const,
      chatId: telegramId,
      messageType: 'driver_assigned_passenger',
      payload: { text: passengerDriverAssignedMessage(pool, driverProfile, language) }
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
  const targets = await getLanguageTargets(store, passengerIds);
  await store.enqueueNotifications(
    targets.map(({ telegramId, language }) => ({
      targetBot: 'passenger' as const,
      chatId: telegramId,
      messageType: 'trip_completed_passenger',
      payload: { text: tripCompletedPassengerMessage(pool, language) }
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

function languageKeyboard(language: SupportedLanguageCode) {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback(
        `${botLabel('languageEnglish', language)}${language === 'en' ? ' ✓' : ''}`,
        'language:en'
      ),
      Markup.button.callback(
        `${botLabel('languageAmharic', language)}${language === 'am' ? ' ✓' : ''}`,
        'language:am'
      )
    ]
  ]);
}

async function editOrReply(
  ctx: Context,
  message: string,
  extra?: Parameters<Context['reply']>[1]
): Promise<void> {
  try {
    await ctx.editMessageText(message, extra as Parameters<Context['editMessageText']>[1]);
  } catch {
    await ctx.reply(message, extra);
  }
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
      const language = await getUserLanguage(store, telegramId);
      try {
        await ctx.answerCbQuery(botLabel('alreadyProcessing', language));
      } catch {
        await ctx.reply(botLabel('alreadyProcessing', language));
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
