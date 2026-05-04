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
import { parseSetPriceCommand } from './adminPriceCommand.js';
import type { BotRegistry } from './botRegistry.js';
import { ensureDriverBotStarted } from './driverAccess.js';
import {
  adminPoolSummary,
  adminRouteSummary,
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
    await upsertUserFromContext(ctx, store);
    await sendRouteList(ctx, config, store);
  });

  bot.command('routes', async (ctx) => {
    await upsertUserFromContext(ctx, store);
    await sendRouteList(ctx, config, store);
  });

  bot.command('profile', async (ctx) => {
    await upsertUserFromContext(ctx, store);
    await sendProfilePrompt(ctx, store);
  });

  bot.command('my_pool', async (ctx) => {
    await upsertUserFromContext(ctx, store);
    await sendMyPool(ctx, config, store);
  });

  bot.command('cancel', async (ctx) => {
    const telegramId = requireTelegramUserId(ctx);
    if (!telegramId) {
      return;
    }

    await upsertUserFromContext(ctx, store);
    const active = await store.getActivePoolForPassenger(telegramId);
    const result = active ? await service.cancelBeforeDispatch(active.pool.id, telegramId) : { kind: 'not_allowed' as const };
    if (result.kind === 'workflow_channel_mismatch') {
      await ctx.reply(miniAppWorkflowMessage(), miniAppKeyboard(config));
      return;
    }

    await ctx.reply(
      result.kind === 'cancelled'
        ? 'Your pool participation was cancelled before dispatch.'
        : 'No cancellable pool was found. If a driver already accepted, please coordinate with the driver/admin.',
      backToRoutesKeyboard()
    );
  });

  bot.command('complete', async (ctx) => {
    const telegramId = requireTelegramUserId(ctx);
    if (!telegramId) {
      return;
    }

    await upsertUserFromContext(ctx, store, 'driver');
    const pinCode = readCommandArgument(ctx);
    if (!pinCode) {
      await ctx.reply('Usage: /complete 4334');
      return;
    }

    const result = await service.completeTrip(pinCode, telegramId);
    if (result.kind === 'invalid_pin') {
      await ctx.reply('Invalid PIN. Please check with the passengers and try again.');
      return;
    }

    await ctx.reply(tripCompletedDriverMessage(result.pool));
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
    await upsertUserFromContext(ctx, store);
    await sendRouteList(ctx, config, store, true);
  });

  bot.action(/^route:(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    await upsertUserFromContext(ctx, store);
    const routeId = ctx.match[1];
    const route = await store.getRoute(routeId);

    if (!route?.isActive) {
      await editOrReply(ctx, 'That route is not available right now.', backToRoutesKeyboard());
      return;
    }

    if (route.priceAmount === null) {
      await editOrReply(
        ctx,
        'That route price is not set yet. Please choose a route with a price.',
        backToRoutesKeyboard()
      );
      return;
    }

    const openPool = await service.findOpenPoolForRoute(route.id);
    if (openPool) {
      await editOrReply(
        ctx,
        openPoolMessage(openPool, config.poolSize),
        Markup.inlineKeyboard([
          [Markup.button.callback('Join Pool', `join:${openPool.id}`)],
          [Markup.button.callback('Back to Routes', 'routes')]
        ])
      );
      return;
    }

    await editOrReply(
      ctx,
      noOpenPoolMessage(route.name),
      Markup.inlineKeyboard([
        [Markup.button.callback('Create Pool', `create:${route.id}`)],
        [Markup.button.callback('Back to Routes', 'routes')]
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
      await upsertUserFromContext(ctx, store);

      if (
        await requirePhoneBeforePayment(ctx, store, {
          telegramId,
          actionType: 'create_pool',
          routeId: ctx.match[1],
          poolId: null,
          expiresAt: pendingPassengerActionExpiry()
        })
      ) {
        return;
      }

      const result = await service.createPool(ctx.match[1], telegramId);
      await handleCreatePoolResult(ctx, config, store, result, true);
    });
  });

  bot.action(/^join:(.+)$/, async (ctx) => {
    await runTelegramAction(ctx, store, `join:${ctx.match[1]}`, async () => {
      await ctx.answerCbQuery();
      const telegramId = requireTelegramUserId(ctx);
      if (!telegramId) {
        return;
      }
      await upsertUserFromContext(ctx, store);

      if (
        await requirePhoneBeforePayment(ctx, store, {
          telegramId,
          actionType: 'join_pool',
          routeId: null,
          poolId: ctx.match[1],
          expiresAt: pendingPassengerActionExpiry()
        })
      ) {
        return;
      }

      const result = await service.joinPool(ctx.match[1], telegramId);
      await handleJoinPoolResult(ctx, config, store, result, true);
    });
  });

  bot.action(/^paid:(.+)$/, async (ctx) => {
    await runTelegramAction(ctx, store, `paid:${ctx.match[1]}`, async () => {
      await ctx.answerCbQuery('Payment confirmation received.');
      const telegramId = requireTelegramUserId(ctx);
      if (!telegramId) {
        return;
      }
      await upsertUserFromContext(ctx, store);

      const result = await service.confirmPayment(ctx.match[1], telegramId);
      if (result.kind === 'workflow_channel_mismatch') {
        await editOrReply(ctx, miniAppWorkflowMessage(), miniAppKeyboard(config));
        return;
      }

      if (result.kind === 'not_found') {
        await ctx.reply('No pending payment was found for this pool.', backToRoutesKeyboard());
        return;
      }

      if (result.kind === 'pool_not_joinable') {
        await ctx.reply('Sorry, that pool already left. Please choose another pool.', backToRoutesKeyboard());
        return;
      }

      if (result.kind === 'pool_ready') {
        await editOrReply(ctx, poolReadyPassengerMessage(result.pool));
        await sendProfilePrompt(ctx, store);
        await notifyPoolReady(bot, bots.driverBot ?? bot, config, store, service, result.pool, {
          excludePassengerTelegramIds: [telegramId]
        });
        return;
      }

      await sendPassengerConfirmed(ctx, config, store, result.pool, result.passenger, result.passengerCount, true);
      await sendProfilePrompt(ctx, store);
    });
  });

  bot.action(/^cancel:(.+)$/, async (ctx) => {
    await runTelegramAction(ctx, store, `cancel:${ctx.match[1]}`, async () => {
      await ctx.answerCbQuery();
      const telegramId = requireTelegramUserId(ctx);
      if (!telegramId) {
        return;
      }

      const result = await service.cancelBeforeDispatch(ctx.match[1], telegramId);
      if (result.kind === 'workflow_channel_mismatch') {
        await editOrReply(ctx, miniAppWorkflowMessage(), miniAppKeyboard(config));
        return;
      }

      await editOrReply(
        ctx,
        result.kind === 'cancelled'
          ? 'Your pool participation was cancelled before dispatch.'
          : 'No cancellable pool was found. If a driver already accepted, please coordinate with the driver/admin.',
        backToRoutesKeyboard()
      );
    });
  });

  bot.action(/^accept:(.+)$/, async (ctx) => {
    await runTelegramAction(ctx, store, `accept:${ctx.match[1]}`, async () => {
      const telegramId = requireTelegramUserId(ctx);
      if (!telegramId) {
        await ctx.answerCbQuery('Open the bot first, then try again.');
        return;
      }

      if (bots.driverBot && !(await ensureDriverBotStarted(ctx, store, telegramId))) {
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
        targetBot: bots.driverBot ? 'driver' : 'passenger',
        chatId: telegramId,
        messageType: 'driver_manifest',
        payload: {
          text: driverManifestMessage(result.pool, result.manifest),
          replyMarkup: Markup.inlineKeyboard([
            [Markup.button.callback('I Arrived', `arrived:${result.pool.id}`)]
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
        await ctx.answerCbQuery('Open the bot first, then try again.');
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

  bot.action(/^confirm_arrival:(.+)$/, async (ctx) => {
    await runTelegramAction(ctx, store, `confirm_arrival:${ctx.match[1]}`, async () => {
      await ctx.answerCbQuery();
      const telegramId = requireTelegramUserId(ctx);
      if (!telegramId) {
        return;
      }

      await upsertUserFromContext(ctx, store);
      const result = await service.confirmDriverArrival(ctx.match[1], telegramId);
      if (result.kind === 'workflow_channel_mismatch') {
        await editOrReply(ctx, miniAppWorkflowMessage(), miniAppKeyboard(config));
        return;
      }

      if (result.kind === 'not_allowed') {
        await ctx.reply('Only confirmed passengers in this pool can confirm driver arrival while the request is active.');
        return;
      }

      await replaceOrReply(ctx, driverArrivalConfirmedPassengerMessage(result.pool));
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

      await upsertUserFromContext(ctx, store);
      const result = await service.rejectDriverArrival(ctx.match[1], telegramId);
      if (result.kind === 'workflow_channel_mismatch') {
        await editOrReply(ctx, miniAppWorkflowMessage(), miniAppKeyboard(config));
        return;
      }

      if (result.kind === 'not_allowed') {
        await ctx.reply('Only confirmed passengers in this pool can reject driver arrival while the request is active.');
        return;
      }

      await replaceOrReply(ctx, 'Driver arrival was not confirmed. The 10-minute driver timer is still active.');
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

      await upsertUserFromContext(ctx, store);
      const result = await service.requestEarlyDispatch(ctx.match[1], telegramId);
      if (result.kind === 'workflow_channel_mismatch') {
        await editOrReply(ctx, miniAppWorkflowMessage(), miniAppKeyboard(config));
        return;
      }

      if (result.kind === 'not_allowed') {
        await ctx.reply('Early dispatch is not available for this pool right now.');
        return;
      }

      if (result.kind === 'early_dispatch_ready') {
        await editOrReply(ctx, poolReadyPassengerMessage(result.pool));
        await notifyPoolReady(bot, bots.driverBot ?? bot, config, store, service, result.pool, {
          excludePassengerTelegramIds: [telegramId]
        });
        return;
      }

      await editOrReply(ctx, earlyDispatchStartedMessage(result.pool));
      await store.enqueueNotifications(
        result.passengerIdsToNotify.map((passengerId) => ({
          targetBot: 'passenger' as const,
          chatId: passengerId,
          messageType: 'early_dispatch_request',
          payload: {
            text: earlyDispatchRequestMessage(result.pool),
            replyMarkup: Markup.inlineKeyboard([
              [Markup.button.callback('Accept Early Dispatch', `early_accept:${result.pool.id}`)],
              [Markup.button.callback('Reject', `early_reject:${result.pool.id}`)]
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

    await upsertUserFromContext(ctx, store);
    const contact = ctx.message.contact;
    if (contact.user_id && String(contact.user_id) !== telegramId) {
      await ctx.reply('Please share your own phone number.', profileKeyboard());
      return;
    }

    await store.updateUserContact(telegramId, contact.phone_number);
    const pendingAction = await store.getPendingPassengerAction(telegramId);
    if (pendingAction) {
      await store.clearPendingPassengerAction(telegramId);
      await ctx.reply('Phone number saved. Continuing to payment.', Markup.removeKeyboard());
      await continuePendingPassengerAction(ctx, config, store, service, pendingAction, telegramId);
      return;
    }

    await ctx.reply('Phone number saved.', Markup.removeKeyboard());
    await sendMyPool(ctx, config, store);
  });

  bot.on('location', async (ctx) => {
    await ctx.reply('Pickup location is not needed. Please share your phone number instead.', Markup.removeKeyboard());
  });

  bot.hears('Skip for now', async (ctx) => {
    await ctx.reply('No problem. You can update your profile later with /profile.', Markup.removeKeyboard());
  });

  bot.catch(async (error, ctx) => {
    console.error('Telegram bot error', error);
    try {
      await ctx.reply('Sorry, something went wrong. Please try again.');
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
  editCurrent = false
): Promise<void> {
  const routes = await store.listActiveRoutes();
  if (routes.length === 0) {
    await ctx.reply('No routes are configured yet. Add ROUTES in env and restart the backend.');
    return;
  }

  const message = routeIntroMessage();
  const extra = routeKeyboard(routes, config.miniAppUrl);
  if (editCurrent) {
    await editOrReply(ctx, message, extra);
    return;
  }

  await ctx.reply(message, extra);
}

function routeKeyboard(routes: Route[], miniAppUrl: string | null) {
  return Markup.inlineKeyboard(
    [
      ...(miniAppUrl ? [[Markup.button.webApp('Open Passenger App', miniAppUrl)]] : []),
      ...routes.map((route) => [Markup.button.callback(routeButtonLabel(route), `route:${route.id}`)])
    ]
  );
}

function backToRoutesKeyboard() {
  return Markup.inlineKeyboard([[Markup.button.callback('Back to Routes', 'routes')]]);
}

function miniAppWorkflowMessage(): string {
  return [
    'This ride is being managed in the Mini App.',
    'Please continue there until the ride is finished or cancelled.'
  ].join('\n');
}

function miniAppKeyboard(config: AppConfig) {
  return config.miniAppUrl
    ? Markup.inlineKeyboard([[Markup.button.webApp('Open Passenger App', config.miniAppUrl)]])
    : undefined;
}

async function requirePhoneBeforePayment(
  ctx: Context,
  store: PostgresRidePoolStore,
  input: PendingPassengerActionInput
): Promise<boolean> {
  const profile = await store.getUserProfile(input.telegramId);
  if (profile?.phoneNumber?.trim()) {
    return false;
  }

  await store.savePendingPassengerAction(input);
  await editOrReply(ctx, phoneRequiredBeforePaymentMessage(input.actionType));
  await ctx.reply('Tap Share Phone below. I will continue to payment automatically after it is saved.', requiredPhoneKeyboard());
  return true;
}

function pendingPassengerActionExpiry(): Date {
  return new Date(Date.now() + PENDING_PASSENGER_ACTION_TTL_MS);
}

function phoneRequiredBeforePaymentMessage(actionType: PendingPassengerAction['actionType']): string {
  return [
    'Phone number required.',
    '',
    'Share your phone number before payment so the driver can contact you after the pool is assigned.',
    actionType === 'create_pool'
      ? 'After you share it, I will create your pool and show the payment card.'
      : 'After you share it, I will reserve your seat and show the payment card.'
  ].join('\n');
}

function requiredPhoneKeyboard() {
  return Markup.keyboard([[Markup.button.contactRequest('Share Phone')]])
    .oneTime()
    .resize();
}

async function sendPaymentPrompt(ctx: Context, pool: RidePool, editCurrent = false): Promise<void> {
  const extra = Markup.inlineKeyboard([
    [Markup.button.callback('I Have Paid', `paid:${pool.id}`)],
    [Markup.button.callback('Cancel', `cancel:${pool.id}`)]
  ]);

  const message = paymentPromptMessage(pool);
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
  editCurrent: boolean
): Promise<void> {
  if (result.kind === 'route_not_found') {
    await sendStepMessage(ctx, 'That route is not available right now.', backToRoutesKeyboard(), editCurrent);
    return;
  }

  if (result.kind === 'route_price_not_set') {
    await sendStepMessage(ctx, 'That route price is not set yet. Please choose another route.', backToRoutesKeyboard(), editCurrent);
    return;
  }

  if (result.kind === 'active_pool_exists') {
    await sendStepMessage(ctx, 'You already have an active pool. Finish or cancel that one before starting another.', undefined, editCurrent);
    await sendMyPool(ctx, config, store);
    return;
  }

  if (result.kind === 'workflow_channel_mismatch') {
    await sendStepMessage(ctx, miniAppWorkflowMessage(), miniAppKeyboard(config), editCurrent);
    return;
  }

  await sendPaymentPrompt(ctx, result.pool, editCurrent);
}

async function handleJoinPoolResult(
  ctx: Context,
  config: AppConfig,
  store: PostgresRidePoolStore,
  result: Awaited<ReturnType<RidePoolService['joinPool']>>,
  editCurrent: boolean
): Promise<void> {
  if (result.kind === 'pool_not_joinable') {
    await sendStepMessage(ctx, 'Sorry, this pool is no longer available.', backToRoutesKeyboard(), editCurrent);
    return;
  }

  if (result.kind === 'active_pool_exists') {
    await sendStepMessage(ctx, 'You already have an active pool. Finish or cancel that one before joining another.', undefined, editCurrent);
    await sendMyPool(ctx, config, store);
    return;
  }

  if (result.kind === 'workflow_channel_mismatch') {
    await sendStepMessage(ctx, miniAppWorkflowMessage(), miniAppKeyboard(config), editCurrent);
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
      editCurrent
    );
    return;
  }

  await sendPaymentPrompt(ctx, result.pool, editCurrent);
}

async function continuePendingPassengerAction(
  ctx: Context,
  config: AppConfig,
  store: PostgresRidePoolStore,
  service: RidePoolService,
  action: PendingPassengerAction,
  telegramId: string
): Promise<void> {
  if (action.actionType === 'create_pool' && action.routeId) {
    const result = await service.createPool(action.routeId, telegramId);
    await handleCreatePoolResult(ctx, config, store, result, false);
    return;
  }

  if (action.actionType === 'join_pool' && action.poolId) {
    const result = await service.joinPool(action.poolId, telegramId);
    await handleJoinPoolResult(ctx, config, store, result, false);
    return;
  }

  await ctx.reply('Your saved action expired. Please choose a route again.', backToRoutesKeyboard());
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
  editCurrent = false
): Promise<void> {
  const message = passengerConfirmedMessage(pool, passengerCount, config.poolSize);
  const canRequestEarlyDispatch = await canShowEarlyDispatchButton(store, pool, passenger, config.poolSize);
  const extra = canRequestEarlyDispatch
    ? Markup.inlineKeyboard([[Markup.button.callback("Let's Go Now", `early:${pool.id}`)]])
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

async function sendMyPool(ctx: Context, config: AppConfig, store: PostgresRidePoolStore): Promise<void> {
  const telegramId = requireTelegramUserId(ctx);
  if (!telegramId) {
    return;
  }

  const active = await store.getActivePoolForPassenger(telegramId);
  if (!active) {
    await ctx.reply('You do not have an active pool right now.', backToRoutesKeyboard());
    return;
  }

  if (active.pool.workflowChannel === 'mini_app') {
    await ctx.reply(miniAppWorkflowMessage(), miniAppKeyboard(config));
    return;
  }

  const buttons = [];
  if (await canShowEarlyDispatchButton(store, active.pool, active.passenger, config.poolSize)) {
    buttons.push([Markup.button.callback("Let's Go Now", `early:${active.pool.id}`)]);
  }
  if (
    ['open', 'ready'].includes(active.pool.status) &&
    !active.pool.driverTelegramId &&
    ['pending', 'confirmed'].includes(active.passenger.paymentStatus)
  ) {
    buttons.push([Markup.button.callback('Cancel', `cancel:${active.pool.id}`)]);
  }
  if (
    active.pool.status === 'arrival_requested' &&
    active.passenger.paymentStatus === 'confirmed'
  ) {
    buttons.push([Markup.button.callback('Confirm Arrival', `confirm_arrival:${active.pool.id}`)]);
    buttons.push([Markup.button.callback('Driver Not Here', `reject_arrival:${active.pool.id}`)]);
  }

  await ctx.reply(
    myPoolMessage(active.pool, active.passenger.isCaptain, config.poolSize),
    buttons.length ? Markup.inlineKeyboard(buttons) : undefined
  );
}

async function sendProfilePrompt(ctx: Context, store: PostgresRidePoolStore): Promise<void> {
  const telegramId = requireTelegramUserId(ctx);
  const profile = telegramId ? await store.getUserProfile(telegramId) : null;
  await ctx.reply([profileStatusMessage(profile), '', profilePromptMessage()].join('\n'), profileKeyboard());
}

function profileKeyboard() {
  return Markup.keyboard([
    [Markup.button.contactRequest('Share Phone')],
    ['Skip for now']
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
  await store.enqueueNotifications([
    {
      targetBot: driverBot === passengerBot ? 'passenger' : 'driver',
      chatId: config.driverGroupChatId,
      messageType: 'driver_pool_ready',
      payload: driverAlertPayload(pool, driverGroupAlertMessage(pool))
    },
    ...passengerIds.map((telegramId) => ({
      targetBot: 'passenger' as const,
      chatId: telegramId,
      messageType: 'pool_ready',
      payload: { text: poolReadyPassengerMessage(pool) }
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

  await upsertUserFromContext(ctx, store);
  const result = await service.voteEarlyDispatch(poolId, telegramId, vote);
  if (result.kind === 'workflow_channel_mismatch') {
    await editOrReply(ctx, miniAppWorkflowMessage(), miniAppKeyboard(config));
    return;
  }

  if (result.kind === 'not_allowed') {
    await editOrReply(ctx, 'This early dispatch vote is no longer active.');
    return;
  }

  if (result.kind === 'early_dispatch_cancelled') {
    await editOrReply(ctx, 'You rejected early dispatch.');
    const passengerIds = await store.getConfirmedPassengerTelegramIds(result.pool.id);
    await store.enqueueNotifications(
      passengerIds.map((passengerId) => ({
        targetBot: 'passenger' as const,
        chatId: passengerId,
        messageType: 'early_dispatch_cancelled',
        payload: { text: earlyDispatchCancelledMessage(result.pool) }
      }))
    );
    return;
  }

  if (result.kind === 'early_dispatch_ready') {
    await editOrReply(ctx, poolReadyPassengerMessage(result.pool));
    await notifyPoolReady(passengerBot, driverBot, config, store, service, result.pool, {
      excludePassengerTelegramIds: [telegramId]
    });
    return;
  }

  await editOrReply(ctx, 'Your early dispatch vote was saved.');
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
  await store.enqueueNotifications(
    passengerIds
      .filter((telegramId) => telegramId !== captainTelegramId)
      .map((telegramId) => ({
        targetBot: 'passenger' as const,
        chatId: telegramId,
        messageType: 'arrival_confirmed_passenger',
        payload: { text: driverArrivalConfirmedPassengerMessage(pool) }
      }))
  );
}

async function notifyDriverArrivalConfirmed(store: PostgresRidePoolStore, pool: RidePool): Promise<void> {
  if (!pool.driverTelegramId) {
    return;
  }

  await store.enqueueNotification({
    targetBot: 'driver',
    chatId: pool.driverTelegramId,
    messageType: 'arrival_confirmed_driver',
    payload: { text: driverArrivalConfirmedDriverMessage(pool) }
  });
}

async function notifyDriverArrivalRejected(store: PostgresRidePoolStore, pool: RidePool): Promise<void> {
  if (!pool.driverTelegramId) {
    return;
  }

  await store.enqueueNotification({
    targetBot: 'driver',
    chatId: pool.driverTelegramId,
    messageType: 'arrival_rejected_driver',
    payload: {
      text: driverArrivalRejectedDriverMessage(pool),
      replyMarkup: Markup.inlineKeyboard([
        [Markup.button.callback('I Arrived', `arrived:${pool.id}`)]
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

function driverAlertPayload(pool: RidePool, text: string): Record<string, unknown> {
  return {
    poolId: pool.id,
    text,
    replyMarkup: Markup.inlineKeyboard([
      [Markup.button.callback('Accept Job', `accept:${pool.id}`)]
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
