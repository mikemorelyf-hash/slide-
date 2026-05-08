import { Markup } from 'telegraf';

import type { AppConfig } from '../config/env.js';
import type { NotificationOutboxInput, PoolEventInput, RidePool } from '../domain/types.js';
import { botLabel, driverGroupAlertMessage } from '../bot/messages.js';

interface RepostStore {
  getPool(poolId: string): Promise<RidePool | null>;
  enqueueNotification(input: NotificationOutboxInput): Promise<string>;
  insertPoolEvent(input: PoolEventInput): Promise<void>;
}

interface CancelStore {
  cancelPoolBeforeAssignment(poolId: string): Promise<RidePool | null>;
  insertPoolEvent(input: PoolEventInput): Promise<void>;
}

interface RetryStore {
  retryFailedNotifications(): Promise<number>;
}

export type RepostDriverAlertResult =
  | { kind: 'queued'; pool: RidePool }
  | { kind: 'not_allowed' };

export type CancelPoolResult =
  | { kind: 'cancelled'; pool: RidePool }
  | { kind: 'not_allowed' };

export async function repostReadyPoolDriverAlert({
  store,
  config,
  poolId,
  actorTelegramId
}: {
  store: RepostStore;
  config: Pick<AppConfig, 'driverGroupChatId'>;
  poolId: string;
  actorTelegramId: string;
}): Promise<RepostDriverAlertResult> {
  const pool = await store.getPool(poolId);
  if (!pool || pool.status !== 'ready' || pool.driverTelegramId) {
    return { kind: 'not_allowed' };
  }

  await store.enqueueNotification({
    targetBot: 'driver',
    chatId: config.driverGroupChatId,
    messageType: 'driver_pool_reposted',
    payload: {
      poolId: pool.id,
      text: driverGroupAlertMessage(pool),
      replyMarkup: Markup.inlineKeyboard([
        [Markup.button.callback(botLabel('acceptJob'), `accept:${pool.id}`)]
      ]).reply_markup
    }
  });
  await store.insertPoolEvent({
    poolId: pool.id,
    actorTelegramId,
    actorRole: 'admin',
    eventType: 'driver_alert_queued',
    fromStatus: pool.status,
    toStatus: pool.status,
    metadata: { reason: 'admin_repost' }
  });

  return { kind: 'queued', pool };
}

export async function cancelPoolBeforeAssignment({
  store,
  poolId,
  actorTelegramId
}: {
  store: CancelStore;
  poolId: string;
  actorTelegramId: string;
}): Promise<CancelPoolResult> {
  const pool = await store.cancelPoolBeforeAssignment(poolId);
  if (!pool) {
    return { kind: 'not_allowed' };
  }

  await store.insertPoolEvent({
    poolId: pool.id,
    actorTelegramId,
    actorRole: 'admin',
    eventType: 'pool_cancelled',
    fromStatus: null,
    toStatus: 'cancelled',
    metadata: { reason: 'admin_cancel_before_assignment' }
  });

  return { kind: 'cancelled', pool };
}

export async function retryFailedNotifications({
  store
}: {
  store: RetryStore;
}): Promise<{ kind: 'retried'; count: number }> {
  return {
    kind: 'retried',
    count: await store.retryFailedNotifications()
  };
}
