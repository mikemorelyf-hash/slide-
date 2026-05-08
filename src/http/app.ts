import { randomUUID } from 'node:crypto';

import cors from 'cors';
import express, { type NextFunction, type Request, type Response } from 'express';
import helmet from 'helmet';
import { Markup, type Context, type Telegraf } from 'telegraf';

import type { AppConfig } from '../config/env.js';
import { PostgresRidePoolStore } from '../db/postgresRidePoolStore.js';
import { createRequestHash, runIdempotent } from '../domain/idempotency.js';
import { isSupportedLanguageCode } from '../domain/language.js';
import { RidePoolService } from '../domain/ridePoolService.js';
import type { RidePool, WorkflowChannel } from '../domain/types.js';
import { validateTelegramInitData } from '../security/telegramInitData.js';
import {
  botLabel,
  driverArrivalConfirmedDriverMessage,
  driverArrivalConfirmedPassengerMessage,
  driverArrivalRejectedDriverMessage,
  driverGroupAlertMessage,
  earlyDispatchCancelledMessage,
  earlyDispatchRequestMessage,
  poolReadyPassengerMessage
} from '../bot/messages.js';
import { getLanguageTargets, getUserLanguage } from '../bot/language.js';
import {
  buildAdminOverview,
  isAdminTelegramId,
  parseRoutePriceBody
} from './adminState.js';
import {
  cancelPoolBeforeAssignment as cancelAdminPoolBeforeAssignment,
  repostReadyPoolDriverAlert,
  retryFailedNotifications as retryFailedAdminNotifications
} from './adminOperations.js';
import { toPassengerAvailablePoolView, toPassengerPoolView } from './passengerState.js';
import { buildReadinessReport } from './readiness.js';

interface HttpAppDeps {
  config: AppConfig;
  store: PostgresRidePoolStore;
  service: RidePoolService;
  bot: Telegraf<Context>;
  driverBot?: Telegraf<Context> | null;
}

interface JsonResult {
  status?: number;
  body: unknown;
}

const MINI_APP_WORKFLOW_CHANNEL: WorkflowChannel = 'mini_app';

export function createHttpApp({ config, store, service, bot, driverBot }: HttpAppDeps): express.Express {
  const app = express();

  app.disable('x-powered-by');
  app.use(helmet());
  app.use(
    cors({
      origin: config.frontendOrigin,
      credentials: config.frontendOrigin !== true
    })
  );
  app.use(express.json({ limit: '1mb' }));

  app.get('/health', async (_req, res, next) => {
    try {
      await store.ping();
      res.json({
        ok: true,
        service: 'telegram-ride-pool-backend'
      });
    } catch (error) {
      next(error);
    }
  });

  app.get('/ready', async (_req, res) => {
    try {
      await store.ping();
      const [pools, pendingNotifications, sendingNotifications, failedNotifications] = await Promise.all([
        store.listAdminPoolSummaries(100),
        store.countNotificationsByStatus('pending'),
        store.countNotificationsByStatus('sending'),
        store.countNotificationsByStatus('failed')
      ]);
      const overview = buildAdminOverview({
        routes: [],
        pools,
        completedToday: 0,
        pendingNotifications,
        failedNotifications
      });
      const report = buildReadinessReport({
        databaseOk: true,
        botMode: config.botMode,
        baseUrl: config.baseUrl,
        miniAppUrl: config.miniAppUrl,
        driverBotConfigured: Boolean(config.driverBotToken),
        pendingNotifications,
        sendingNotifications,
        failedNotifications,
        stuckPools: overview.stability.stuckPools
      });

      res.status(report.ok ? 200 : 503).json(report);
    } catch (error) {
      const report = buildReadinessReport({
        databaseOk: false,
        botMode: config.botMode,
        baseUrl: config.baseUrl,
        miniAppUrl: config.miniAppUrl,
        driverBotConfigured: Boolean(config.driverBotToken),
        pendingNotifications: 0,
        sendingNotifications: 0,
        failedNotifications: 0,
        stuckPools: []
      });

      res.status(503).json(report);
    }
  });

  app.get('/api/routes', async (_req, res, next) => {
    try {
      res.json({
        routes: await store.listActiveRoutes()
      });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/me', requireMiniAppAuth(config, store), async (req, res) => {
    res.json({
      user: req.telegramUser
    });
  });

  app.get('/api/admin/overview', requireAdminMiniAppAuth(config, store), async (_req, res, next) => {
    try {
      const [routes, pools, completedToday, pendingNotifications, failedNotifications] = await Promise.all([
        store.listRoutes(),
        store.listAdminPoolSummaries(100),
        store.countCompletedPoolsSince(startOfToday()),
        store.countNotificationsByStatus('pending'),
        store.countNotificationsByStatus('failed')
      ]);

      res.json(
        buildAdminOverview({
          routes,
          pools,
          completedToday,
          pendingNotifications,
          failedNotifications
        })
      );
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/admin/routes', requireAdminMiniAppAuth(config, store), async (_req, res, next) => {
    try {
      res.json({
        routes: await store.listRoutes()
      });
    } catch (error) {
      next(error);
    }
  });

  app.patch('/api/admin/routes/:routeId/price', requireAdminMiniAppAuth(config, store), async (req, res, next) => {
    try {
      const price = parseRoutePriceBody(req.body);
      if (!price.ok) {
        res.status(400).json({ error: price.error });
        return;
      }

      const route = await store.updateRoutePrice(req.params.routeId, price.amount, price.currency);
      if (!route) {
        res.status(404).json({ error: 'route_not_found' });
        return;
      }

      res.json({ route });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/admin/pools', requireAdminMiniAppAuth(config, store), async (_req, res, next) => {
    try {
      res.json({
        pools: await store.listAdminPoolSummaries(100)
      });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/admin/pools/:poolId', requireAdminMiniAppAuth(config, store), async (req, res, next) => {
    try {
      const detail = await store.getAdminPoolDetail(req.params.poolId);
      if (!detail) {
        res.status(404).json({ error: 'pool_not_found' });
        return;
      }

      res.json(detail);
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/admin/pools/:poolId/repost-driver-alert', requireAdminMiniAppAuth(config, store), async (req, res, next) => {
    try {
      const telegramId = getAuthenticatedTelegramId(req, res);
      if (!telegramId) {
        return;
      }

      const result = await repostReadyPoolDriverAlert({
        store,
        config,
        poolId: req.params.poolId,
        actorTelegramId: telegramId
      });
      if (result.kind === 'not_allowed') {
        res.status(409).json({ error: 'driver_alert_repost_not_allowed' });
        return;
      }

      res.json({
        result: result.kind,
        pool: await store.getAdminPoolDetail(req.params.poolId)
      });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/admin/pools/:poolId/cancel', requireAdminMiniAppAuth(config, store), async (req, res, next) => {
    try {
      const telegramId = getAuthenticatedTelegramId(req, res);
      if (!telegramId) {
        return;
      }

      const result = await cancelAdminPoolBeforeAssignment({
        store,
        poolId: req.params.poolId,
        actorTelegramId: telegramId
      });
      if (result.kind === 'not_allowed') {
        res.status(409).json({ error: 'pool_cancel_not_allowed' });
        return;
      }

      res.json({
        result: result.kind,
        pool: await store.getAdminPoolDetail(req.params.poolId)
      });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/admin/notifications/retry-failed', requireAdminMiniAppAuth(config, store), async (_req, res, next) => {
    try {
      res.json(await retryFailedAdminNotifications({ store }));
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/passenger/state', requireMiniAppAuth(config, store), async (req, res, next) => {
    try {
      await sendPassengerState(req, res, config, store);
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/passenger/routes/:routeId/pools', requireMiniAppAuth(config, store), async (req, res, next) => {
    try {
      const route = await store.getRoute(req.params.routeId);
      if (!route?.isActive) {
        res.status(404).json({ error: 'route_not_found' });
        return;
      }

      const pools = await store.listOpenPoolsForRoute(
        req.params.routeId,
        config.poolSize,
        MINI_APP_WORKFLOW_CHANNEL
      );
      res.json({
        route,
        pools: pools.map(({ pool, captain }) =>
          toPassengerAvailablePoolView({
            pool,
            captain,
            poolSize: config.poolSize
          })
        )
      });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/passenger/profile', requireMiniAppAuth(config, store), async (req, res, next) => {
    try {
      const telegramId = getAuthenticatedTelegramId(req, res);
      if (!telegramId) {
        return;
      }

      const phoneNumber = parsePhoneNumber(req.body);
      if (!phoneNumber) {
        res.status(400).json({ error: 'invalid_phone_number' });
        return;
      }

      await store.updateUserContact(telegramId, phoneNumber);
      await sendPassengerState(req, res, config, store);
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/passenger/language', requireMiniAppAuth(config, store), async (req, res, next) => {
    try {
      const telegramId = getAuthenticatedTelegramId(req, res);
      if (!telegramId) {
        return;
      }

      const languageCode = parseStringBody(req.body, 'languageCode');
      if (!isSupportedLanguageCode(languageCode)) {
        res.status(400).json({ error: 'invalid_language_code' });
        return;
      }

      await store.updateUserLanguage(telegramId, languageCode);
      await sendPassengerState(req, res, config, store);
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/passenger/pools', requireMiniAppAuth(config, store), async (req, res, next) => {
    try {
      const telegramId = getAuthenticatedTelegramId(req, res);
      if (!telegramId) {
        return;
      }

      await sendIdempotentJson(req, res, store, telegramId, 'passenger-pools', async () => {
        const poolId = parseStringBody(req.body, 'poolId');
        const routeId = parseStringBody(req.body, 'routeId');
        const createNew = parseBooleanBody(req.body, 'createNew');

        const activePool = await store.getActivePoolForPassenger(telegramId);
        if (activePool) {
          return {
            status: 409,
            body: {
              error: 'active_pool_exists',
              state: await buildPassengerState(config, store, telegramId)
            }
          };
        }

        if (!(await passengerHasPhone(store, telegramId))) {
          return {
            status: 409,
            body: {
              error: 'phone_required',
              state: await buildPassengerState(config, store, telegramId)
            }
          };
        }

        const result = poolId
          ? await service.joinPool(poolId, telegramId, MINI_APP_WORKFLOW_CHANNEL)
          : routeId
            ? createNew
              ? await service.createPool(routeId, telegramId, MINI_APP_WORKFLOW_CHANNEL)
              : await joinOrCreatePoolForRoute(service, routeId, telegramId, MINI_APP_WORKFLOW_CHANNEL)
            : null;

        if (!result) {
          return { status: 400, body: { error: 'route_or_pool_required' } };
        }

        if (result.kind === 'route_not_found') {
          return { status: 404, body: { error: 'route_not_found' } };
        }

        if (result.kind === 'route_price_not_set') {
          return {
            status: 409,
            body: {
              error: 'route_price_not_set',
              state: await buildPassengerState(config, store, telegramId)
            }
          };
        }

        if (result.kind === 'pool_not_joinable') {
          return { status: 409, body: { error: 'pool_not_joinable' } };
        }

        if (result.kind === 'active_pool_exists') {
          return {
            status: 409,
            body: {
              error: 'active_pool_exists',
              state: await buildPassengerState(config, store, telegramId)
            }
          };
        }

        if (result.kind === 'workflow_channel_mismatch') {
          return workflowChannelMismatchResponse(config, store, telegramId);
        }

        return {
          body: {
            result: result.kind,
            state: await buildPassengerState(config, store, telegramId)
          }
        };
      });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/passenger/pools/:poolId/confirm-payment', requireMiniAppAuth(config, store), async (req, res, next) => {
    try {
      const telegramId = getAuthenticatedTelegramId(req, res);
      if (!telegramId) {
        return;
      }

      await sendIdempotentJson(req, res, store, telegramId, 'confirm-payment', async () => {
        if (!(await passengerHasPhone(store, telegramId))) {
          return {
            status: 409,
            body: {
              error: 'phone_required',
              state: await buildPassengerState(config, store, telegramId)
            }
          };
        }

        const result = await service.confirmPayment(
          req.params.poolId,
          telegramId,
          MINI_APP_WORKFLOW_CHANNEL
        );
        if (result.kind === 'not_found') {
          return { status: 404, body: { error: 'pending_payment_not_found' } };
        }

        if (result.kind === 'pool_not_joinable') {
          return {
            status: 409,
            body: {
              error: 'pool_not_joinable',
              state: await buildPassengerState(config, store, telegramId)
            }
          };
        }

        if (result.kind === 'workflow_channel_mismatch') {
          return workflowChannelMismatchResponse(config, store, telegramId);
        }

        if (result.kind === 'pool_ready') {
          await notifyPoolReady(bot, driverBot ?? bot, config, store, service, result.pool);
        }

        return {
          body: {
            result: result.kind,
            state: await buildPassengerState(config, store, telegramId)
          }
        };
      });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/passenger/pools/:poolId/cancel', requireMiniAppAuth(config, store), async (req, res, next) => {
    try {
      const telegramId = getAuthenticatedTelegramId(req, res);
      if (!telegramId) {
        return;
      }

      await sendIdempotentJson(req, res, store, telegramId, 'cancel-payment', async () => {
        const result = await service.cancelBeforeDispatch(
          req.params.poolId,
          telegramId,
          MINI_APP_WORKFLOW_CHANNEL
        );
        if (result.kind === 'workflow_channel_mismatch') {
          return workflowChannelMismatchResponse(config, store, telegramId);
        }
        return {
          body: {
            result: result.kind,
            state: await buildPassengerState(config, store, telegramId)
          }
        };
      });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/passenger/pools/:poolId/early-dispatch', requireMiniAppAuth(config, store), async (req, res, next) => {
    try {
      const telegramId = getAuthenticatedTelegramId(req, res);
      if (!telegramId) {
        return;
      }

      await sendIdempotentJson(req, res, store, telegramId, 'early-dispatch', async () => {
        const result = await service.requestEarlyDispatch(
          req.params.poolId,
          telegramId,
          MINI_APP_WORKFLOW_CHANNEL
        );
        if (result.kind === 'workflow_channel_mismatch') {
          return workflowChannelMismatchResponse(config, store, telegramId);
        }
        if (result.kind === 'not_allowed') {
          return { status: 403, body: { error: 'early_dispatch_not_allowed' } };
        }

        if (result.kind === 'early_dispatch_ready') {
          await notifyPoolReady(bot, driverBot ?? bot, config, store, service, result.pool);
        } else {
          await notifyEarlyDispatchVoteRequest(store, result.pool, result.passengerIdsToNotify);
        }

        return {
          body: {
            result: result.kind,
            state: await buildPassengerState(config, store, telegramId)
          }
        };
      });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/passenger/pools/:poolId/early-dispatch/vote', requireMiniAppAuth(config, store), async (req, res, next) => {
    try {
      const telegramId = getAuthenticatedTelegramId(req, res);
      if (!telegramId) {
        return;
      }

      await sendIdempotentJson(req, res, store, telegramId, 'early-dispatch-vote', async () => {
        const vote = parseStringBody(req.body, 'vote');
        if (vote !== 'accepted' && vote !== 'rejected') {
          return { status: 400, body: { error: 'invalid_vote' } };
        }

        const result = await service.voteEarlyDispatch(
          req.params.poolId,
          telegramId,
          vote,
          MINI_APP_WORKFLOW_CHANNEL
        );
        if (result.kind === 'workflow_channel_mismatch') {
          return workflowChannelMismatchResponse(config, store, telegramId);
        }
        if (result.kind === 'not_allowed') {
          return { status: 403, body: { error: 'early_dispatch_vote_not_allowed' } };
        }

        if (result.kind === 'early_dispatch_ready') {
          await notifyPoolReady(bot, driverBot ?? bot, config, store, service, result.pool);
        }
        if (result.kind === 'early_dispatch_cancelled') {
          await notifyEarlyDispatchCancelled(bot, store, result.pool);
        }

        return {
          body: {
            result: result.kind,
            state: await buildPassengerState(config, store, telegramId)
          }
        };
      });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/passenger/pools/:poolId/arrival/confirm', requireMiniAppAuth(config, store), async (req, res, next) => {
    try {
      const telegramId = getAuthenticatedTelegramId(req, res);
      if (!telegramId) {
        return;
      }

      await sendIdempotentJson(req, res, store, telegramId, 'arrival-confirm', async () => {
        const result = await service.confirmDriverArrival(
          req.params.poolId,
          telegramId,
          MINI_APP_WORKFLOW_CHANNEL
        );
        if (result.kind === 'workflow_channel_mismatch') {
          return workflowChannelMismatchResponse(config, store, telegramId);
        }
        if (result.kind === 'not_allowed') {
          return { status: 403, body: { error: 'arrival_confirmation_not_allowed' } };
        }

        await notifyArrivalConfirmed(bot, driverBot ?? bot, store, result.pool, telegramId);
        return {
          body: {
            result: result.kind,
            state: await buildPassengerState(config, store, telegramId)
          }
        };
      });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/passenger/pools/:poolId/arrival/reject', requireMiniAppAuth(config, store), async (req, res, next) => {
    try {
      const telegramId = getAuthenticatedTelegramId(req, res);
      if (!telegramId) {
        return;
      }

      await sendIdempotentJson(req, res, store, telegramId, 'arrival-reject', async () => {
        const result = await service.rejectDriverArrival(
          req.params.poolId,
          telegramId,
          MINI_APP_WORKFLOW_CHANNEL
        );
        if (result.kind === 'workflow_channel_mismatch') {
          return workflowChannelMismatchResponse(config, store, telegramId);
        }
        if (result.kind === 'not_allowed') {
          return { status: 403, body: { error: 'arrival_rejection_not_allowed' } };
        }

        await notifyArrivalRejected(store, result.pool);
        return {
          body: {
            result: result.kind,
            state: await buildPassengerState(config, store, telegramId)
          }
        };
      });
    } catch (error) {
      next(error);
    }
  });

  app.post(config.webhookPath, verifyTelegramWebhookSecret(config), async (req, res, next) => {
    try {
      await bot.handleUpdate(req.body, res);
    } catch (error) {
      next(error);
    }
  });

  if (driverBot) {
    app.post(config.driverWebhookPath, verifyTelegramWebhookSecret(config), async (req, res, next) => {
      try {
        await driverBot.handleUpdate(req.body, res);
      } catch (error) {
        next(error);
      }
    });
  }

  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    console.error('HTTP error', error);
    res.status(500).json({
      error: 'internal_server_error'
    });
  });

  return app;
}

async function sendPassengerState(
  req: Request,
  res: Response,
  config: AppConfig,
  store: PostgresRidePoolStore
): Promise<void> {
  const telegramId = getAuthenticatedTelegramId(req, res);
  if (!telegramId) {
    return;
  }

  res.json(await buildPassengerState(config, store, telegramId));
}

async function buildPassengerState(
  config: AppConfig,
  store: PostgresRidePoolStore,
  telegramId: string
) {
  const [routes, activePool, latestCompletedPool] = await Promise.all([
    store.listActiveRoutes(),
    store.getActivePoolForPassenger(telegramId),
    store.getLatestCompletedPoolForPassenger(telegramId)
  ]);
  const [activeDriver, activePassengers] = await Promise.all([
    getPoolDriverProfile(store, activePool?.pool ?? null),
    activePool?.passenger.paymentStatus === 'confirmed' ? store.getPassengerManifests(activePool.pool.id) : []
  ]);
  const [completedDriver, completedPassengers] = activePool
    ? [null, []]
    : await Promise.all([
        getPoolDriverProfile(store, latestCompletedPool?.pool ?? null),
        latestCompletedPool?.passenger.paymentStatus === 'confirmed'
          ? store.getPassengerManifests(latestCompletedPool.pool.id)
          : []
      ]);

  return {
    user: await store.getUserProfile(telegramId),
    poolSize: config.poolSize,
    routes,
    activePool: activePool
      ? toPassengerPoolView({
          pool: activePool.pool,
          passenger: activePool.passenger,
          poolSize: config.poolSize,
          driver: activeDriver,
          passengers: activePassengers
        })
      : null,
    lastCompletedPool: !activePool && latestCompletedPool
      ? toPassengerPoolView({
          pool: latestCompletedPool.pool,
          passenger: latestCompletedPool.passenger,
          poolSize: config.poolSize,
          driver: completedDriver,
          passengers: completedPassengers
        })
      : null
  };
}

async function passengerHasPhone(store: PostgresRidePoolStore, telegramId: string): Promise<boolean> {
  const profile = await store.getUserProfile(telegramId);
  return Boolean(profile?.phoneNumber?.trim());
}

async function workflowChannelMismatchResponse(
  config: AppConfig,
  store: PostgresRidePoolStore,
  telegramId: string
): Promise<JsonResult> {
  return {
    status: 409,
    body: {
      error: 'workflow_channel_mismatch',
      state: await buildPassengerState(config, store, telegramId)
    }
  };
}

async function getPoolDriverProfile(
  store: PostgresRidePoolStore,
  pool: RidePool | null
) {
  return pool?.driverTelegramId ? store.getUserProfile(pool.driverTelegramId) : null;
}

function getAuthenticatedTelegramId(req: Request, res: Response): string | null {
  const telegramId = req.telegramUser?.telegramId;
  if (!telegramId) {
    res.status(401).json({ error: 'missing_authenticated_user' });
    return null;
  }

  return telegramId;
}

async function sendIdempotentJson(
  req: Request,
  res: Response,
  store: PostgresRidePoolStore,
  telegramId: string,
  action: string,
  work: () => Promise<JsonResult>
): Promise<void> {
  try {
    const result = await runIdempotent(store, {
      key: buildMiniAppIdempotencyKey(req, telegramId, action),
      source: 'mini_app',
      actorTelegramId: telegramId,
      requestHash: createRequestHash({
        action,
        params: req.params,
        body: req.body
      }),
      expiresInSeconds: 86_400,
      shouldCache: shouldCacheJsonResult,
      work
    });

    res.status(result.status ?? 200).json(result.body);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Action is already being processed')) {
      res.status(409).json({ error: 'action_processing' });
      return;
    }

    throw error;
  }
}

const NON_CACHEABLE_SUCCESS_RESULT_KINDS = new Set(['pool_not_joinable']);

export function shouldCacheJsonResult(result: JsonResult): boolean {
  if (result.status && result.status >= 400) {
    return false;
  }

  if (!result.body || typeof result.body !== 'object') {
    return true;
  }

  const body = result.body as { error?: unknown; result?: unknown };
  if (body.error) {
    return false;
  }

  return !(
    typeof body.result === 'string' &&
    NON_CACHEABLE_SUCCESS_RESULT_KINDS.has(body.result)
  );
}

export function buildMiniAppIdempotencyKey(req: Request, telegramId: string, action: string): string {
  const providedKey = req.get('x-idempotency-key');

  return ['mini-app', telegramId, action, providedKey ?? `server-${randomUUID()}`].join(':');
}

function parseStringBody(body: unknown, key: string): string | null {
  if (!body || typeof body !== 'object' || !(key in body)) {
    return null;
  }

  const value = (body as Record<string, unknown>)[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function parseBooleanBody(body: unknown, key: string): boolean {
  if (!body || typeof body !== 'object' || !(key in body)) {
    return false;
  }

  return (body as Record<string, unknown>)[key] === true;
}

function parsePhoneNumber(body: unknown): string | null {
  const phoneNumber = parseStringBody(body, 'phoneNumber');
  if (!phoneNumber || phoneNumber.length > 32 || !/^[+\d][+\d\s().-]{4,31}$/.test(phoneNumber)) {
    return null;
  }

  return phoneNumber;
}

async function joinOrCreatePoolForRoute(
  service: RidePoolService,
  routeId: string,
  telegramId: string,
  workflowChannel: WorkflowChannel
) {
  const openPool = await service.findOpenPoolForRoute(routeId, workflowChannel);
  return openPool
    ? service.joinPool(openPool.id, telegramId, workflowChannel)
    : service.createPool(routeId, telegramId, workflowChannel);
}

async function notifyPoolReady(
  passengerBot: Telegraf<Context>,
  driverBot: Telegraf<Context>,
  config: AppConfig,
  store: PostgresRidePoolStore,
  service: RidePoolService,
  pool: RidePool
): Promise<void> {
  const passengerIds = await store.getConfirmedPassengerTelegramIds(pool.id);
  const passengerTargets = await getLanguageTargets(store, passengerIds);
  await store.enqueueNotifications([
    {
      targetBot: driverBot === passengerBot ? 'passenger' : 'driver',
      chatId: config.driverGroupChatId,
      messageType: 'driver_pool_ready',
      payload: driverAlertPayload(pool, driverGroupAlertMessage(pool))
    },
    ...passengerTargets.map(({ telegramId: passengerId, language }) => ({
      targetBot: 'passenger' as const,
      chatId: passengerId,
      messageType: 'pool_ready',
      payload: { text: poolReadyPassengerMessage(pool, language) }
    }))
  ]);
}

async function notifyEarlyDispatchVoteRequest(
  store: PostgresRidePoolStore,
  pool: RidePool,
  passengerIds: string[]
): Promise<void> {
  const targets = await getLanguageTargets(store, passengerIds);
  await store.enqueueNotifications(
    targets.map(({ telegramId: passengerId, language }) => ({
      targetBot: 'passenger' as const,
      chatId: passengerId,
      messageType: 'early_dispatch_request',
      payload: {
        text: earlyDispatchRequestMessage(pool, language),
        replyMarkup: Markup.inlineKeyboard([
          [Markup.button.callback(botLabel('acceptEarlyDispatch', language), `early_accept:${pool.id}`)],
          [Markup.button.callback(botLabel('reject', language), `early_reject:${pool.id}`)]
        ]).reply_markup
      }
    }))
  );
}

async function notifyEarlyDispatchCancelled(
  bot: Telegraf<Context>,
  store: PostgresRidePoolStore,
  pool: RidePool
): Promise<void> {
  const passengerIds = await store.getConfirmedPassengerTelegramIds(pool.id);
  const targets = await getLanguageTargets(store, passengerIds);
  await store.enqueueNotifications(
    targets.map(({ telegramId: passengerId, language }) => ({
      targetBot: 'passenger' as const,
      chatId: passengerId,
      messageType: 'early_dispatch_cancelled',
      payload: { text: earlyDispatchCancelledMessage(pool, language) }
    }))
  );
}

async function notifyArrivalConfirmed(
  passengerBot: Telegraf<Context>,
  driverBot: Telegraf<Context>,
  store: PostgresRidePoolStore,
  pool: RidePool,
  confirmerTelegramId: string
): Promise<void> {
  const passengerIds = await store.getConfirmedPassengerTelegramIds(pool.id);
  const targets = await getLanguageTargets(
    store,
    passengerIds.filter((passengerId) => passengerId !== confirmerTelegramId)
  );
  await store.enqueueNotifications(
    targets
      .map(({ telegramId: passengerId, language }) => ({
        targetBot: 'passenger' as const,
        chatId: passengerId,
        messageType: 'arrival_confirmed_passenger',
        payload: { text: driverArrivalConfirmedPassengerMessage(pool, language) }
      }))
  );

  if (pool.driverTelegramId) {
    const language = await getUserLanguage(store, pool.driverTelegramId);
    await store.enqueueNotification({
      targetBot: driverBot === passengerBot ? 'passenger' : 'driver',
      chatId: pool.driverTelegramId,
      messageType: 'arrival_confirmed_driver',
      payload: { text: driverArrivalConfirmedDriverMessage(pool, language) }
    });
  }
}

async function notifyArrivalRejected(store: PostgresRidePoolStore, pool: RidePool): Promise<void> {
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

function driverAlertPayload(pool: RidePool, text: string): Record<string, unknown> {
  return {
    poolId: pool.id,
    text,
    replyMarkup: Markup.inlineKeyboard([
      [Markup.button.callback(botLabel('acceptJob'), `accept:${pool.id}`)]
    ]).reply_markup
  };
}

function verifyTelegramWebhookSecret(config: AppConfig) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!config.webhookSecret) {
      next();
      return;
    }

    if (req.header('x-telegram-bot-api-secret-token') !== config.webhookSecret) {
      res.status(401).json({ error: 'invalid_webhook_secret' });
      return;
    }

    next();
  };
}

function requireMiniAppAuth(config: AppConfig, store: PostgresRidePoolStore) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (await authenticateMiniAppRequest(config, store, req, res)) {
        next();
      }
    } catch (error) {
      next(error);
    }
  };
}

function requireAdminMiniAppAuth(config: AppConfig, store: PostgresRidePoolStore) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const authenticated = await authenticateMiniAppRequest(config, store, req, res);
      if (!authenticated) {
        return;
      }

      if (!isAdminTelegramId(req.telegramUser?.telegramId, config.adminTelegramIds)) {
        res.status(403).json({ error: 'admin_access_required' });
        return;
      }

      next();
    } catch (error) {
      next(error);
    }
  };
}

async function authenticateMiniAppRequest(
  config: AppConfig,
  store: PostgresRidePoolStore,
  req: Request,
  res: Response
): Promise<boolean> {
  const initData = readInitData(req);
  if (!initData) {
    res.status(401).json({ error: 'missing_telegram_init_data' });
    return false;
  }

  const validation = validateTelegramInitData(initData, {
    botToken: config.botToken,
    maxAgeSeconds: config.miniAppInitDataMaxAgeSeconds
  });

  if (!validation.valid || !validation.data.user) {
    res.status(401).json({
      error: 'invalid_telegram_init_data',
      reason: validation.valid ? 'missing_user' : validation.reason
    });
    return false;
  }

  const user = validation.data.user;
  await store.upsertTelegramUser({
    telegramId: String(user.id),
    firstName: user.first_name ?? null,
    lastName: user.last_name ?? null,
    username: user.username ?? null,
    role: 'passenger'
  });

  req.telegramUser = await store.getUserProfile(String(user.id));
  return true;
}

function readInitData(req: Request): string | null {
  const header = req.header('x-telegram-init-data');
  if (header) {
    return header;
  }

  const authorization = req.header('authorization');
  const match = authorization?.match(/^tma\s+(.+)$/i);
  return match?.[1] ?? null;
}

function startOfToday(): Date {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date;
}
