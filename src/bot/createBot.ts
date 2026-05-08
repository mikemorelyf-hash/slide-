import { Markup, Telegraf, type Context } from 'telegraf';

import type { AppConfig } from '../config/env.js';
import { createRequestHash, runIdempotent } from '../domain/idempotency.js';
import { RidePoolService } from '../domain/ridePoolService.js';
import type {
  PendingPassengerAction,
  PendingPassengerActionInput,
  PoolPassenger,
  RidePool,
  Route,
  TelegramUserProfile
} from '../domain/types.js';
import { PostgresRidePoolStore } from '../db/postgresRidePoolStore.js';
import { isSupportedLanguageCode, type SupportedLanguageCode } from '../domain/language.js';
import { parseSetPriceCommand } from './adminPriceCommand.js';
import type { BotRegistry } from './botRegistry.js';
import { ensureDriverBotStarted } from './driverAccess.js';
import { getLanguageTargets, getUserLanguage, profileLanguage } from './language.js';
import {
  adminPoolSummary,
  adminRouteSummary,
  botLabel,
  earlyDispatchCancelledMessage,
  earlyDispatchRequestMessage,
  earlyDispatchStartedMessage,
  driverAssignedGroupMessage,
  driverArrivalConfirmedDriverMessage,
  driverArrivalConfirmedPassengerMessage,
  driverArrivalRejectedDriverMessage,
  driverArrivalRequestCaptainMessage,
  driverArrivalRequestSentMessage,
  driverGroupAlertMessage,
  driverManifestMessage,
  myPoolMessage,
  noOpenPoolMessage,
  openPoolMessage,
  passengerConfirmedMessage,
  passengerDriverAssignedMessage,
  paymentPromptMessage,
  poolReadyPassengerMessage,
  profilePromptMessage,
  profileStatusMessage,
  languageMenuMessage,
  languageUpdatedMessage,
  routeButtonLabel,
  routeIntroMessage,
  tripCompletedDriverMessage,
  tripCompletedPassengerMessage
} from './messages.js';

interface BotDeps {
  config: AppConfig;
  store: PostgresRidePoolStore;
  service: RidePoolService;
  bots: BotRegistry;
}

interface NotifyPoolReadyOptions {
  excludePassengerTelegramIds?: string[];
}

const PENDING_PASSENGER_ACTION_TTL_MS = 15 * 60 * 1000;

export function createRidePoolBot({ config, store, service, bots }: BotDeps): Telegraf<Context> {
  const bot = new Telegraf(config.botToken);

  bot.start(async (ctx) => {
    const profile = await upsertUserFromContext(ctx, store);
    await sendRouteList(ctx, config, store, profileLanguage(profile));
  });

  bot.command('routes', async (ctx) => {
    const profile = await upsertUserFromContext(ctx, store);
    await sendRouteList(ctx, config, store, profileLanguage(profile));
  });

  bot.command('language', async (ctx) => {
    const profile = await upsertUserFromContext(ctx, store);
    const language = profileLanguage(profile);
    await ctx.reply(languageMenuMessage(language), languageKeyboard(language));
  });

  bot.command('profile', async (ctx) => {
    const profile = await upsertUserFromContext(ctx, store);
    await sendProfilePrompt(ctx, store, profileLanguage(profile));
  });

  bot.command('my_pool', async (ctx) => {
    const profile = await upsertUserFromContext(ctx, store);
    await sendMyPool(ctx, config, store, profileLanguage(profile));
  });

  bot.command('cancel', async (ctx) => {
    const telegramId = requireTelegramUserId(ctx);
    if (!telegramId) {
      return;
    }

    const profile = await upsertUserFromContext(ctx, store);
    const language = profileLanguage(profile);
    const active = await store.getActivePoolForPassenger(telegramId);
    const result = active ? await service.cancelBeforeDispatch(active.pool.id, telegramId) : { kind: 'not_allowed' as const };
    if (result.kind === 'workflow_channel_mismatch') {
      await ctx.reply(miniAppWorkflowMessage(language), miniAppKeyboard(config, language));
      return;
    }

    await ctx.reply(
      result.kind === 'cancelled'
        ? botLabel('poolParticipationCancelled', language)
        : botLabel('noCancellablePool', language),
      backToRoutesKeyboard(language)
    );
  });

  bot.command('complete', async (ctx) => {
    const telegramId = requireTelegramUserId(ctx);
    if (!telegramId) {
      return;
    }

    const profile = await upsertUserFromContext(ctx, store, 'driver');
    const language = profileLanguage(profile);
    const pinCode = readCommandArgument(ctx);
    if (!pinCode) {
      await ctx.reply(botLabel('usageComplete', language));
      return;
    }

    const result = await service.completeTrip(pinCode, telegramId);
    if (result.kind === 'invalid_pin') {
      await ctx.reply(botLabel('invalidPin', language));
      return;
    }

    await ctx.reply(tripCompletedDriverMessage(result.pool, language));
    await notifyTripCompleted(bot, config, store, result.pool);
  });

  bot.command('admin', async (ctx) => {
    if (!isAdmin(ctx, config)) {
      await ctx.reply('Admin access only.');
      return;
    }

    const adminMessage = [
      '/pools - view active pools',
      '/jobs - view ready and assigned jobs',
      '/admin_routes - view route IDs and prices',
      '/set_price <route_id> <amount> [currency] - set route price'
    ].join('\n');
    const adminDashboardUrl = config.miniAppUrl ? `${config.miniAppUrl.replace(/\/$/, '')}/admin` : null;

    await ctx.reply(
      adminMessage,
      adminDashboardUrl
        ? Markup.inlineKeyboard([[Markup.button.webApp('Open Admin Dashboard', adminDashboardUrl)]])
        : undefined
    );
  });

  bot.command('admin_routes', async (ctx) => {
    if (!isAdmin(ctx, config)) {
      await ctx.reply('Admin access only.');
      return;
    }

    const routes = await store.listActiveRoutes();
    await ctx.reply(routes.length ? routes.map(adminRouteSummary).join('\n') : 'No active routes.');
  });

  bot.command('set_price', async (ctx) => {
    if (!isAdmin(ctx, config)) {
      await ctx.reply('Admin access only.');
      return;
    }

    const text = getMessageText(ctx);
    const command = text ? parseSetPriceCommand(text) : null;
    if (!command) {
      await ctx.reply('Usage: /set_price <route_id> <amount> [currency]\nExample: /set_price 1 120 ETB');
      return;
    }

    const route = await store.updateRoutePrice(command.routeId, command.amount, command.currency);
    if (!route) {
      await ctx.reply('Route not found. Use /admin_routes to see route IDs.');
      return;
    }

    await ctx.reply(`Route price updated.\n${adminRouteSummary(route)}`);
  });

  bot.command('pools', async (ctx) => {
    if (!isAdmin(ctx, config)) {
      await ctx.reply('Admin access only.');
      return;
    }

    const pools = await store.listPoolsByStatuses(['open', 'ready', 'assigned', 'arrival_requested', 'in_progress'], 20);
    await ctx.reply(pools.length ? pools.map(adminPoolSummary).join('\n\n') : 'No active pools.');
  });

  bot.command('jobs', async (ctx) => {
    if (!isAdmin(ctx, config)) {
      await ctx.reply('Admin access only.');
      return;
    }

    const jobs = await store.listPoolsByStatuses(['ready', 'assigned', 'arrival_requested', 'in_progress'], 20);
    await ctx.reply(jobs.length ? jobs.map(adminPoolSummary).join('\n\n') : 'No active jobs.');
  });

  bot.action('routes', async (ctx) => {
    await ctx.answerCbQuery();
    const profile = await upsertUserFromContext(ctx, store);
    await sendRouteList(ctx, config, store, profileLanguage(profile), true);
  });

  bot.action('language_menu', async (ctx) => {
    await ctx.answerCbQuery();
    const profile = await upsertUserFromContext(ctx, store);
    const language = profileLanguage(profile);
    await editOrReply(ctx, languageMenuMessage(language), languageKeyboard(language));
  });

  bot.action(/^language:(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const telegramId = requireTelegramUserId(ctx);
    if (!telegramId) {
      return;
    }

    const nextLanguage = isSupportedLanguageCode(ctx.match[1]) ? ctx.match[1] : 'en';
    await upsertUserFromContext(ctx, store);
    await store.updateUserLanguage(telegramId, nextLanguage);
    await editOrReply(ctx, languageUpdatedMessage(nextLanguage), languageKeyboard(nextLanguage));
  });

  bot.action(/^route:(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const profile = await upsertUserFromContext(ctx, store);
    const language = profileLanguage(profile);
    const routeId = ctx.match[1];
    const route = await store.getRoute(routeId);

    if (!route?.isActive) {
      await editOrReply(ctx, botLabel('routeNotAvailable', language), backToRoutesKeyboard(language));
      return;
    }

    if (route.priceAmount === null) {
      await editOrReply(
        ctx,
        botLabel('routePriceUnsetChoose', language),
        backToRoutesKeyboard(language)
      );
      return;
    }

    const openPool = await service.findOpenPoolForRoute(route.id);
    if (openPool) {
      await editOrReply(
        ctx,
        openPoolMessage(openPool, config.poolSize, language),
        Markup.inlineKeyboard([
          [Markup.button.callback(botLabel('joinPool', language), `join:${openPool.id}`)],
          [Markup.button.callback(botLabel('backToRoutes', language), 'routes')]
        ])
      );
      return;
    }

    await editOrReply(
      ctx,
      noOpenPoolMessage(route.name, language),
      Markup.inlineKeyboard([
        [Markup.button.callback(botLabel('createPool', language), `create:${route.id}`)],
        [Markup.button.callback(botLabel('backToRoutes', language), 'routes')]
      ])
    );
  });

  bot.action(/^create:(.+)$/, async (ctx) => {
    await runTelegramAction(ctx, store, `create:${ctx.match[1]}`, async () => {
      await ctx.answerCbQuery();
      const telegramId = requireTelegramUserId(ctx);
      if (!telegramId) {
        return;
      }
      const profile = await upsertUserFromContext(ctx, store);
      const language = profileLanguage(profile);

      if (
        await requirePhoneBeforePayment(
          ctx,
          store,
          {
            telegramId,
            actionType: 'create_pool',
            routeId: ctx.match[1],
            poolId: null,
            expiresAt: pendingPassengerActionExpiry()
          },
          language
        )
      ) {
        return;
      }

      const result = await service.createPool(ctx.match[1], telegramId);
      await handleCreatePoolResult(ctx, config, store, result, true, language);
    });
  });

  bot.action(/^join:(.+)$/, async (ctx) => {
    await runTelegramAction(ctx, store, `join:${ctx.match[1]}`, async () => {
      await ctx.answerCbQuery();
      const telegramId = requireTelegramUserId(ctx);
      if (!telegramId) {
        return;
      }
      const profile = await upsertUserFromContext(ctx, store);
      const language = profileLanguage(profile);

      if (
        await requirePhoneBeforePayment(
          ctx,
          store,
          {
            telegramId,
            actionType: 'join_pool',
            routeId: null,
            poolId: ctx.match[1],
            expiresAt: pendingPassengerActionExpiry()
          },
          language
        )
      ) {
        return;
      }

      const result = await service.joinPool(ctx.match[1], telegramId);
      await handleJoinPoolResult(ctx, config, store, result, true, language);
    });
  });

  bot.action(/^paid:(.+)$/, async (ctx) => {
    await runTelegramAction(ctx, store, `paid:${ctx.match[1]}`, async () => {
      const telegramId = requireTelegramUserId(ctx);
      if (!telegramId) {
        return;
      }
      const profile = await upsertUserFromContext(ctx, store);
      const language = profileLanguage(profile);
      await ctx.answerCbQuery(language === 'am' ? 'የክፍያ ማረጋገጫ ተቀብሏል።' : 'Payment confirmation received.');

      const result = await service.confirmPayment(ctx.match[1], telegramId);
      if (result.kind === 'workflow_channel_mismatch') {
        await editOrReply(ctx, miniAppWorkflowMessage(language), miniAppKeyboard(config, language));
        return;
      }

      if (result.kind === 'not_found') {
        await ctx.reply(botLabel('pendingPaymentNotFound', language), backToRoutesKeyboard(language));
        return;
      }

      if (result.kind === 'pool_not_joinable') {
        await ctx.reply(botLabel('poolAlreadyLeft', language), backToRoutesKeyboard(language));
        return;
      }

      if (result.kind === 'pool_ready') {
        await editOrReply(ctx, poolReadyPassengerMessage(result.pool, language));
        await sendProfilePrompt(ctx, store, language);
        await notifyPoolReady(bot, bots.driverBot ?? bot, config, store, service, result.pool, {
          excludePassengerTelegramIds: [telegramId]
        });
        return;
      }

      await sendPassengerConfirmed(ctx, config, store, result.pool, result.passenger, result.passengerCount, true, language);
      await sendProfilePrompt(ctx, store, language);
    });
  });

  bot.action(/^cancel:(.+)$/, async (ctx) => {
    await runTelegramAction(ctx, store, `cancel:${ctx.match[1]}`, async () => {
      await ctx.answerCbQuery();
      const telegramId = requireTelegramUserId(ctx);
      if (!telegramId) {
        return;
      }
      const language = await getUserLanguage(store, telegramId);

      const result = await service.cancelBeforeDispatch(ctx.match[1], telegramId);
      if (result.kind === 'workflow_channel_mismatch') {
        await editOrReply(ctx, miniAppWorkflowMessage(language), miniAppKeyboard(config, language));
        return;
      }

      await editOrReply(
        ctx,
        result.kind === 'cancelled'
          ? botLabel('poolParticipationCancelled', language)
          : botLabel('noCancellablePool', language),
        backToRoutesKeyboard(language)
      );
    });
  });

  bot.action(/^accept:(.+)$/, async (ctx) => {
    await runTelegramAction(ctx, store, `accept:${ctx.match[1]}`, async () => {
      const telegramId = requireTelegramUserId(ctx);
      if (!telegramId) {
        await ctx.answerCbQuery(botLabel('openBotFirst'));
        return;
      }
      const language = await getUserLanguage(store, telegramId);

      if (bots.driverBot && !(await ensureDriverBotStarted(ctx, store, telegramId, language))) {
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
          targetBot: bots.driverBot ? 'driver' : 'passenger',
          chatId: telegramId,
          messageType: 'driver_manifest',
          payload: {
          text: driverManifestMessage(result.pool, result.manifest, language),
          replyMarkup: Markup.inlineKeyboard([
            [Markup.button.callback(botLabel('iArrived', language), `arrived:${result.pool.id}`)]
          ]).reply_markup
        }
      });

      await notifyPassengersDriverAssigned(bot, store, result.pool, driverProfile);
    });
  });

  bot.action(/^arrived:(.+)$/, async (ctx) => {
    await runTelegramAction(ctx, store, `arrived:${ctx.match[1]}`, async () => {
      const telegramId = requireTelegramUserId(ctx);
      if (!telegramId) {
        await ctx.answerCbQuery(botLabel('openBotFirst'));
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
      const targets = await getLanguageTargets(store, passengerIds);
      await store.enqueueNotifications(
        targets.map(({ telegramId: passengerId, language: passengerLanguage }) => ({
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

  bot.action(/^confirm_arrival:(.+)$/, async (ctx) => {
    await runTelegramAction(ctx, store, `confirm_arrival:${ctx.match[1]}`, async () => {
      await ctx.answerCbQuery();
      const telegramId = requireTelegramUserId(ctx);
      if (!telegramId) {
        return;
      }

      const profile = await upsertUserFromContext(ctx, store);
      const language = profileLanguage(profile);
      const result = await service.confirmDriverArrival(ctx.match[1], telegramId);
      if (result.kind === 'workflow_channel_mismatch') {
        await editOrReply(ctx, miniAppWorkflowMessage(language), miniAppKeyboard(config, language));
        return;
      }

      if (result.kind === 'not_allowed') {
        await ctx.reply(
          language === 'am'
            ? 'ጥያቄው ንቁ ሳለ መድረስን ማረጋገጥ የሚችሉት በዚህ ፑል ውስጥ የተረጋገጡ ተሳፋሪዎች ብቻ ናቸው።'
            : 'Only confirmed passengers in this pool can confirm driver arrival while the request is active.'
        );
        return;
      }

      await replaceOrReply(ctx, driverArrivalConfirmedPassengerMessage(result.pool, language));
      await notifyPassengersDriverArrivalConfirmed(bot, store, result.pool, telegramId);
      await notifyDriverArrivalConfirmed(store, result.pool);
    });
  });

  bot.action(/^reject_arrival:(.+)$/, async (ctx) => {
    await runTelegramAction(ctx, store, `reject_arrival:${ctx.match[1]}`, async () => {
      await ctx.answerCbQuery();
      const telegramId = requireTelegramUserId(ctx);
      if (!telegramId) {
        return;
      }

      const profile = await upsertUserFromContext(ctx, store);
      const language = profileLanguage(profile);
      const result = await service.rejectDriverArrival(ctx.match[1], telegramId);
      if (result.kind === 'workflow_channel_mismatch') {
        await editOrReply(ctx, miniAppWorkflowMessage(language), miniAppKeyboard(config, language));
        return;
      }

      if (result.kind === 'not_allowed') {
        await ctx.reply(
          language === 'am'
            ? 'ጥያቄው ንቁ ሳለ የሾፌር መድረስን አለመቀበል የሚችሉት በዚህ ፑል ውስጥ የተረጋገጡ ተሳፋሪዎች ብቻ ናቸው።'
            : 'Only confirmed passengers in this pool can reject driver arrival while the request is active.'
        );
        return;
      }

      await replaceOrReply(ctx, botLabel('driverArrivalNotConfirmed', language));
      await notifyDriverArrivalRejected(store, result.pool);
    });
  });

  bot.action(/^early:(.+)$/, async (ctx) => {
    await runTelegramAction(ctx, store, `early:${ctx.match[1]}`, async () => {
      await ctx.answerCbQuery();
      const telegramId = requireTelegramUserId(ctx);
      if (!telegramId) {
        return;
      }

      const profile = await upsertUserFromContext(ctx, store);
      const language = profileLanguage(profile);
      const result = await service.requestEarlyDispatch(ctx.match[1], telegramId);
      if (result.kind === 'workflow_channel_mismatch') {
        await editOrReply(ctx, miniAppWorkflowMessage(language), miniAppKeyboard(config, language));
        return;
      }

      if (result.kind === 'not_allowed') {
        await ctx.reply(botLabel('earlyNotAvailable', language));
        return;
      }

      if (result.kind === 'early_dispatch_ready') {
        await editOrReply(ctx, poolReadyPassengerMessage(result.pool, language));
        await notifyPoolReady(bot, bots.driverBot ?? bot, config, store, service, result.pool, {
          excludePassengerTelegramIds: [telegramId]
        });
        return;
      }

      await editOrReply(ctx, earlyDispatchStartedMessage(result.pool, language));
      const targets = await getLanguageTargets(store, result.passengerIdsToNotify);
      await store.enqueueNotifications(
        targets.map(({ telegramId: passengerId, language: passengerLanguage }) => ({
          targetBot: 'passenger' as const,
          chatId: passengerId,
          messageType: 'early_dispatch_request',
          payload: {
            text: earlyDispatchRequestMessage(result.pool, passengerLanguage),
            replyMarkup: Markup.inlineKeyboard([
              [Markup.button.callback(botLabel('acceptEarlyDispatch', passengerLanguage), `early_accept:${result.pool.id}`)],
              [Markup.button.callback(botLabel('reject', passengerLanguage), `early_reject:${result.pool.id}`)]
            ]).reply_markup
          }
        }))
      );
    });
  });

  bot.action(/^early_accept:(.+)$/, async (ctx) => {
    await runTelegramAction(ctx, store, `early_accept:${ctx.match[1]}`, async () => {
      await handleEarlyDispatchVote(ctx, bot, bots.driverBot ?? bot, config, store, service, ctx.match[1], 'accepted');
    });
  });

  bot.action(/^early_reject:(.+)$/, async (ctx) => {
    await runTelegramAction(ctx, store, `early_reject:${ctx.match[1]}`, async () => {
      await handleEarlyDispatchVote(ctx, bot, bots.driverBot ?? bot, config, store, service, ctx.match[1], 'rejected');
    });
  });

  bot.on('contact', async (ctx) => {
    const telegramId = requireTelegramUserId(ctx);
    if (!telegramId) {
      return;
    }

    const profile = await upsertUserFromContext(ctx, store);
    const language = profileLanguage(profile);
    const contact = ctx.message.contact;
    if (contact.user_id && String(contact.user_id) !== telegramId) {
      await ctx.reply(botLabel('shareOwnPhone', language), profileKeyboard(language));
      return;
    }

    await store.updateUserContact(telegramId, contact.phone_number);
    const pendingAction = await store.getPendingPassengerAction(telegramId);
    if (pendingAction) {
      await store.clearPendingPassengerAction(telegramId);
      await ctx.reply(botLabel('phoneSavedContinuing', language), Markup.removeKeyboard());
      await continuePendingPassengerAction(ctx, config, store, service, pendingAction, telegramId, language);
      return;
    }

    await ctx.reply(botLabel('phoneSaved', language), Markup.removeKeyboard());
    await sendMyPool(ctx, config, store, language);
  });

  bot.on('location', async (ctx) => {
    const language = await getUserLanguage(store, requireTelegramUserId(ctx));
    await ctx.reply(botLabel('pickupNotNeeded', language), Markup.removeKeyboard());
  });

  bot.hears([botLabel('skipForNow', 'en'), botLabel('skipForNow', 'am')], async (ctx) => {
    const language = await getUserLanguage(store, requireTelegramUserId(ctx));
    await ctx.reply(botLabel('skipProfileLater', language), Markup.removeKeyboard());
  });

  bot.catch(async (error, ctx) => {
    console.error('Telegram bot error', error);
    try {
      const language = await getUserLanguage(store, requireTelegramUserId(ctx));
      await ctx.reply(botLabel('genericError', language));
    } catch (replyError) {
      console.error('Could not send error reply', replyError);
    }
  });

  return bot;
}

async function sendRouteList(
  ctx: Context,
  config: AppConfig,
  store: PostgresRidePoolStore,
  language: SupportedLanguageCode,
  editCurrent = false
): Promise<void> {
  const routes = await store.listActiveRoutes();
  if (routes.length === 0) {
    await ctx.reply(botLabel('noRoutesConfigured', language));
    return;
  }

  const message = routeIntroMessage(language);
  const extra = routeKeyboard(routes, config.miniAppUrl, language);
  if (editCurrent) {
    await editOrReply(ctx, message, extra);
    return;
  }

  await ctx.reply(message, extra);
}

function routeKeyboard(routes: Route[], miniAppUrl: string | null, language: SupportedLanguageCode) {
  return Markup.inlineKeyboard(
    [
      ...(miniAppUrl ? [[Markup.button.webApp(botLabel('openPassengerApp', language), miniAppUrl)]] : []),
      [Markup.button.callback(botLabel('languageMenuButton', language), 'language_menu')],
      ...routes.map((route) => [Markup.button.callback(routeButtonLabel(route, language), `route:${route.id}`)])
    ]
  );
}

function backToRoutesKeyboard(language: SupportedLanguageCode) {
  return Markup.inlineKeyboard([[Markup.button.callback(botLabel('backToRoutes', language), 'routes')]]);
}

function miniAppWorkflowMessage(language: SupportedLanguageCode): string {
  return language === 'am'
    ? ['ይህ ጉዞ በMini App ውስጥ እየተቀናበረ ነው።', 'ጉዞው እስኪጠናቀቅ ወይም እስኪሰረዝ ድረስ እዚያ ይቀጥሉ።'].join('\n')
    : [
        'This ride is being managed in the Mini App.',
        'Please continue there until the ride is finished or cancelled.'
      ].join('\n');
}

function miniAppKeyboard(config: AppConfig, language: SupportedLanguageCode) {
  return config.miniAppUrl
    ? Markup.inlineKeyboard([[Markup.button.webApp(botLabel('openPassengerApp', language), config.miniAppUrl)]])
    : undefined;
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
    ],
    [Markup.button.callback(botLabel('backToRoutes', language), 'routes')]
  ]);
}

async function requirePhoneBeforePayment(
  ctx: Context,
  store: PostgresRidePoolStore,
  input: PendingPassengerActionInput,
  language: SupportedLanguageCode
): Promise<boolean> {
  const profile = await store.getUserProfile(input.telegramId);
  if (profile?.phoneNumber?.trim()) {
    return false;
  }

  await store.savePendingPassengerAction(input);
  await editOrReply(ctx, phoneRequiredBeforePaymentMessage(input.actionType, language));
  await ctx.reply(botLabel('savePhoneFirst', language), requiredPhoneKeyboard(language));
  return true;
}

function pendingPassengerActionExpiry(): Date {
  return new Date(Date.now() + PENDING_PASSENGER_ACTION_TTL_MS);
}

function phoneRequiredBeforePaymentMessage(
  actionType: PendingPassengerAction['actionType'],
  language: SupportedLanguageCode
): string {
  return language === 'am'
    ? [
        'ስልክ ቁጥር ያስፈልጋል።',
        '',
        'ፑልዎ ከተመደበ በኋላ ሾፌሩ እንዲያገኝዎት ከክፍያ በፊት ስልክ ቁጥርዎን ያጋሩ።',
        actionType === 'create_pool'
          ? 'ካጋሩት በኋላ ፑልዎን እፈጥራለሁ እና የክፍያ ካርድ አሳያለሁ።'
          : 'ካጋሩት በኋላ መቀመጫዎን አስይዛለሁ እና የክፍያ ካርድ አሳያለሁ።'
      ].join('\n')
    : [
        'Phone number required.',
        '',
        'Share your phone number before payment so the driver can contact you after the pool is assigned.',
        actionType === 'create_pool'
          ? 'After you share it, I will create your pool and show the payment card.'
          : 'After you share it, I will reserve your seat and show the payment card.'
      ].join('\n');
}

function requiredPhoneKeyboard(language: SupportedLanguageCode) {
  return Markup.keyboard([[Markup.button.contactRequest(botLabel('sharePhone', language))]])
    .oneTime()
    .resize();
}

async function sendPaymentPrompt(
  ctx: Context,
  pool: RidePool,
  editCurrent = false,
  language: SupportedLanguageCode
): Promise<void> {
  const extra = Markup.inlineKeyboard([
    [Markup.button.callback(botLabel('iHavePaid', language), `paid:${pool.id}`)],
    [Markup.button.callback(botLabel('cancel', language), `cancel:${pool.id}`)]
  ]);

  const message = paymentPromptMessage(pool, language);
  if (editCurrent) {
    await editOrReply(ctx, message, extra);
    return;
  }

  await ctx.reply(message, extra);
}

async function handleCreatePoolResult(
  ctx: Context,
  config: AppConfig,
  store: PostgresRidePoolStore,
  result: Awaited<ReturnType<RidePoolService['createPool']>>,
  editCurrent: boolean,
  language: SupportedLanguageCode
): Promise<void> {
  if (result.kind === 'route_not_found') {
    await sendStepMessage(ctx, botLabel('routeNotAvailable', language), backToRoutesKeyboard(language), editCurrent);
    return;
  }

  if (result.kind === 'route_price_not_set') {
    await sendStepMessage(ctx, botLabel('routePriceNotSet', language), backToRoutesKeyboard(language), editCurrent);
    return;
  }

  if (result.kind === 'active_pool_exists') {
    await sendStepMessage(ctx, botLabel('activePoolExistsStart', language), undefined, editCurrent);
    await sendMyPool(ctx, config, store, language);
    return;
  }

  if (result.kind === 'workflow_channel_mismatch') {
    await sendStepMessage(ctx, miniAppWorkflowMessage(language), miniAppKeyboard(config, language), editCurrent);
    return;
  }

  await sendPaymentPrompt(ctx, result.pool, editCurrent, language);
}

async function handleJoinPoolResult(
  ctx: Context,
  config: AppConfig,
  store: PostgresRidePoolStore,
  result: Awaited<ReturnType<RidePoolService['joinPool']>>,
  editCurrent: boolean,
  language: SupportedLanguageCode
): Promise<void> {
  if (result.kind === 'pool_not_joinable') {
    await sendStepMessage(ctx, botLabel('poolNoLongerAvailable', language), backToRoutesKeyboard(language), editCurrent);
    return;
  }

  if (result.kind === 'active_pool_exists') {
    await sendStepMessage(ctx, botLabel('activePoolExistsJoin', language), undefined, editCurrent);
    await sendMyPool(ctx, config, store, language);
    return;
  }

  if (result.kind === 'workflow_channel_mismatch') {
    await sendStepMessage(ctx, miniAppWorkflowMessage(language), miniAppKeyboard(config, language), editCurrent);
    return;
  }

  if (result.kind === 'already_joined' && result.passenger.paymentStatus === 'confirmed') {
    await sendPassengerConfirmed(
      ctx,
      config,
      store,
      result.pool,
      result.passenger,
      result.pool.passengerCount,
      editCurrent,
      language
    );
    return;
  }

  await sendPaymentPrompt(ctx, result.pool, editCurrent, language);
}

async function continuePendingPassengerAction(
  ctx: Context,
  config: AppConfig,
  store: PostgresRidePoolStore,
  service: RidePoolService,
  action: PendingPassengerAction,
  telegramId: string,
  language: SupportedLanguageCode
): Promise<void> {
  if (action.actionType === 'create_pool' && action.routeId) {
    const result = await service.createPool(action.routeId, telegramId);
    await handleCreatePoolResult(ctx, config, store, result, false, language);
    return;
  }

  if (action.actionType === 'join_pool' && action.poolId) {
    const result = await service.joinPool(action.poolId, telegramId);
    await handleJoinPoolResult(ctx, config, store, result, false, language);
    return;
  }

  await ctx.reply(botLabel('actionExpired', language), backToRoutesKeyboard(language));
}

async function sendStepMessage(
  ctx: Context,
  message: string,
  extra: Parameters<Context['reply']>[1] | undefined,
  editCurrent: boolean
): Promise<void> {
  if (editCurrent) {
    await editOrReply(ctx, message, extra);
    return;
  }

  await ctx.reply(message, extra);
}

async function sendPassengerConfirmed(
  ctx: Context,
  config: AppConfig,
  store: PostgresRidePoolStore,
  pool: RidePool,
  passenger: PoolPassenger,
  passengerCount: number,
  editCurrent = false,
  language: SupportedLanguageCode = 'en'
): Promise<void> {
  const message = passengerConfirmedMessage(pool, passengerCount, config.poolSize, language);
  const canRequestEarlyDispatch = await canShowEarlyDispatchButton(store, pool, passenger, config.poolSize);
  const extra = canRequestEarlyDispatch
    ? Markup.inlineKeyboard([[Markup.button.callback(botLabel('letGoNow', language), `early:${pool.id}`)]])
    : undefined;

  if (editCurrent) {
    await editOrReply(ctx, message, extra);
    return;
  }

  await ctx.reply(message, extra);
}

async function canShowEarlyDispatchButton(
  store: PostgresRidePoolStore,
  pool: RidePool,
  passenger: PoolPassenger,
  poolSize: number
): Promise<boolean> {
  if (
    !passenger.isCaptain ||
    passenger.paymentStatus !== 'confirmed' ||
    pool.status !== 'open' ||
    pool.passengerCount < 1 ||
    pool.passengerCount >= poolSize
  ) {
    return false;
  }

  const profile = await store.getUserProfile(passenger.telegramId);
  return Boolean(profile?.phoneNumber?.trim());
}

async function sendMyPool(
  ctx: Context,
  config: AppConfig,
  store: PostgresRidePoolStore,
  language: SupportedLanguageCode
): Promise<void> {
  const telegramId = requireTelegramUserId(ctx);
  if (!telegramId) {
    return;
  }

  const active = await store.getActivePoolForPassenger(telegramId);
  if (!active) {
    await ctx.reply(botLabel('noActivePool', language), backToRoutesKeyboard(language));
    return;
  }

  if (active.pool.workflowChannel === 'mini_app') {
    await ctx.reply(miniAppWorkflowMessage(language), miniAppKeyboard(config, language));
    return;
  }

  const buttons = [];
  if (await canShowEarlyDispatchButton(store, active.pool, active.passenger, config.poolSize)) {
    buttons.push([Markup.button.callback(botLabel('letGoNow', language), `early:${active.pool.id}`)]);
  }
  if (
    ['open', 'ready'].includes(active.pool.status) &&
    !active.pool.driverTelegramId &&
    ['pending', 'confirmed'].includes(active.passenger.paymentStatus)
  ) {
    buttons.push([Markup.button.callback(botLabel('cancel', language), `cancel:${active.pool.id}`)]);
  }
  if (
    active.pool.status === 'arrival_requested' &&
    active.passenger.paymentStatus === 'confirmed'
  ) {
    buttons.push([Markup.button.callback(botLabel('confirmArrival', language), `confirm_arrival:${active.pool.id}`)]);
    buttons.push([Markup.button.callback(botLabel('driverNotHere', language), `reject_arrival:${active.pool.id}`)]);
  }

  await ctx.reply(
    myPoolMessage(active.pool, active.passenger.isCaptain, config.poolSize, language),
    buttons.length ? Markup.inlineKeyboard(buttons) : undefined
  );
}

async function sendProfilePrompt(
  ctx: Context,
  store: PostgresRidePoolStore,
  language: SupportedLanguageCode
): Promise<void> {
  const telegramId = requireTelegramUserId(ctx);
  const profile = telegramId ? await store.getUserProfile(telegramId) : null;
  await ctx.reply([profileStatusMessage(profile, language), '', profilePromptMessage(language)].join('\n'), profileKeyboard(language));
}

function profileKeyboard(language: SupportedLanguageCode) {
  return Markup.keyboard([
    [Markup.button.contactRequest(botLabel('sharePhone', language))],
    [botLabel('skipForNow', language)]
  ])
    .oneTime()
    .resize();
}

async function notifyPoolReady(
  passengerBot: Telegraf<Context>,
  driverBot: Telegraf<Context>,
  config: AppConfig,
  store: PostgresRidePoolStore,
  service: RidePoolService,
  pool: RidePool,
  options: NotifyPoolReadyOptions = {}
): Promise<void> {
  const excludedPassengerIds = new Set(options.excludePassengerTelegramIds ?? []);
  const passengerIds = (await store.getConfirmedPassengerTelegramIds(pool.id)).filter(
    (telegramId) => !excludedPassengerIds.has(telegramId)
  );
  const passengerTargets = await getLanguageTargets(store, passengerIds);
  await store.enqueueNotifications([
    {
      targetBot: driverBot === passengerBot ? 'passenger' : 'driver',
      chatId: config.driverGroupChatId,
      messageType: 'driver_pool_ready',
      payload: driverAlertPayload(pool, driverGroupAlertMessage(pool))
    },
    ...passengerTargets.map(({ telegramId, language }) => ({
      targetBot: 'passenger' as const,
      chatId: telegramId,
      messageType: 'pool_ready',
      payload: { text: poolReadyPassengerMessage(pool, language) }
    }))
  ]);
}

async function handleEarlyDispatchVote(
  ctx: Context,
  passengerBot: Telegraf<Context>,
  driverBot: Telegraf<Context>,
  config: AppConfig,
  store: PostgresRidePoolStore,
  service: RidePoolService,
  poolId: string,
  vote: 'accepted' | 'rejected'
): Promise<void> {
  await ctx.answerCbQuery();
  const telegramId = requireTelegramUserId(ctx);
  if (!telegramId) {
    return;
  }

  const profile = await upsertUserFromContext(ctx, store);
  const language = profileLanguage(profile);
  const result = await service.voteEarlyDispatch(poolId, telegramId, vote);
  if (result.kind === 'workflow_channel_mismatch') {
    await editOrReply(ctx, miniAppWorkflowMessage(language), miniAppKeyboard(config, language));
    return;
  }

  if (result.kind === 'not_allowed') {
    await editOrReply(
      ctx,
      language === 'am' ? 'ይህ የቀድሞ መላክ ድምጽ ከእንግዲህ ንቁ አይደለም።' : 'This early dispatch vote is no longer active.'
    );
    return;
  }

  if (result.kind === 'early_dispatch_cancelled') {
    await editOrReply(ctx, botLabel('earlyRejected', language));
    const passengerIds = await store.getConfirmedPassengerTelegramIds(result.pool.id);
    const targets = await getLanguageTargets(store, passengerIds);
    await store.enqueueNotifications(
      targets.map(({ telegramId: passengerId, language: passengerLanguage }) => ({
        targetBot: 'passenger' as const,
        chatId: passengerId,
        messageType: 'early_dispatch_cancelled',
        payload: { text: earlyDispatchCancelledMessage(result.pool, passengerLanguage) }
      }))
    );
    return;
  }

  if (result.kind === 'early_dispatch_ready') {
    await editOrReply(ctx, poolReadyPassengerMessage(result.pool, language));
    await notifyPoolReady(passengerBot, driverBot, config, store, service, result.pool, {
      excludePassengerTelegramIds: [telegramId]
    });
    return;
  }

  await editOrReply(ctx, botLabel('earlyVoteSaved', language));
}

async function replaceOrReply(ctx: Context, message: string): Promise<void> {
  try {
    await ctx.editMessageText(message);
  } catch {
    await ctx.reply(message);
  }
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

async function notifyPassengersDriverArrivalConfirmed(
  bot: Telegraf<Context>,
  store: PostgresRidePoolStore,
  pool: RidePool,
  captainTelegramId: string
): Promise<void> {
  const passengerIds = await store.getConfirmedPassengerTelegramIds(pool.id);
  const targets = await getLanguageTargets(store, passengerIds.filter((telegramId) => telegramId !== captainTelegramId));
  await store.enqueueNotifications(
    targets
      .map(({ telegramId, language }) => ({
        targetBot: 'passenger' as const,
        chatId: telegramId,
        messageType: 'arrival_confirmed_passenger',
        payload: { text: driverArrivalConfirmedPassengerMessage(pool, language) }
      }))
  );
}

async function notifyDriverArrivalConfirmed(store: PostgresRidePoolStore, pool: RidePool): Promise<void> {
  if (!pool.driverTelegramId) {
    return;
  }

  const language = await getUserLanguage(store, pool.driverTelegramId);
  await store.enqueueNotification({
    targetBot: 'driver',
    chatId: pool.driverTelegramId,
    messageType: 'arrival_confirmed_driver',
    payload: { text: driverArrivalConfirmedDriverMessage(pool, language) }
  });
}

async function notifyDriverArrivalRejected(store: PostgresRidePoolStore, pool: RidePool): Promise<void> {
  if (!pool.driverTelegramId) {
    return;
  }

  const language = await getUserLanguage(store, pool.driverTelegramId);
  await store.enqueueNotification({
    targetBot: 'driver',
    chatId: pool.driverTelegramId,
    messageType: 'arrival_rejected_driver',
    payload: {
      text: driverArrivalRejectedDriverMessage(pool, language),
      replyMarkup: Markup.inlineKeyboard([
        [Markup.button.callback(botLabel('iArrived', language), `arrived:${pool.id}`)]
      ]).reply_markup
    }
  });
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

function driverAlertPayload(
  pool: RidePool,
  text: string,
  language: SupportedLanguageCode = 'en'
): Record<string, unknown> {
  return {
    poolId: pool.id,
    text,
    replyMarkup: Markup.inlineKeyboard([
      [Markup.button.callback(botLabel('acceptJob', language), `accept:${pool.id}`)]
    ]).reply_markup
  };
}

async function upsertUserFromContext(
  ctx: Context,
  store: PostgresRidePoolStore,
  role: TelegramUserProfile['role'] = 'passenger'
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
  return getMessageText(ctx)?.trim().split(/\s+/)[1] ?? null;
}

function isAdmin(ctx: Context, config: AppConfig): boolean {
  const telegramId = requireTelegramUserId(ctx);
  return Boolean(telegramId && config.adminTelegramIds.includes(telegramId));
}

function getMessageText(ctx: Context): string | null {
  const message = ctx.message;
  if (!message || !('text' in message) || typeof message.text !== 'string') {
    return null;
  }

  return message.text;
}
