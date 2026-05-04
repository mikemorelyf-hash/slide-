import type { Context, Telegraf } from 'telegraf';

import type { PostgresRidePoolStore } from '../db/postgresRidePoolStore.js';
import type { QueuedNotification } from '../domain/types.js';
import type { BotRegistry } from './botRegistry.js';

interface NotificationOutboxStore {
  claimPendingNotifications(limit: number): Promise<QueuedNotification[]>;
  markDriverAlertSent?(poolId: string, chatId: string, messageId: number): Promise<void>;
  markNotificationSent(id: string, telegramMessageId: number): Promise<void>;
  markNotificationRetry(id: string, error: string, nextAttemptAt: Date): Promise<void>;
  markNotificationFailed(id: string, error: string): Promise<void>;
}

interface SendPendingNotificationsInput {
  store: NotificationOutboxStore;
  bots: BotRegistry;
  batchSize: number;
}

const retryDelaysMs = [0, 10_000, 30_000, 120_000, 600_000];

export async function sendPendingNotifications({
  store,
  bots,
  batchSize
}: SendPendingNotificationsInput): Promise<void> {
  const notifications = await store.claimPendingNotifications(batchSize);

  for (const notification of notifications) {
    try {
      const bot = selectBot(bots, notification.targetBot);
      if (!bot) {
        throw new Error(`Missing ${notification.targetBot} bot`);
      }
      const options = buildMessageOptions(notification.payload) as Parameters<
        typeof bot.telegram.sendMessage
      >[2];

      const message = await bot.telegram.sendMessage(
        notification.chatId,
        String(notification.payload.text ?? ''),
        options
      );

      await markSideEffectsAfterSend(store, notification, message.message_id);
      await store.markNotificationSent(notification.id, message.message_id);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown_error';
      if (notification.attemptCount >= retryDelaysMs.length) {
        await store.markNotificationFailed(notification.id, message);
        continue;
      }

      await store.markNotificationRetry(
        notification.id,
        message,
        new Date(Date.now() + retryDelaysMs[notification.attemptCount])
      );
    }
  }
}

async function markSideEffectsAfterSend(
  store: NotificationOutboxStore,
  notification: QueuedNotification,
  telegramMessageId: number
): Promise<void> {
  if (
    !store.markDriverAlertSent ||
    (notification.messageType !== 'driver_pool_ready' &&
      notification.messageType !== 'driver_pool_reposted')
  ) {
    return;
  }

  const poolId = notification.payload.poolId;
  if (typeof poolId !== 'string') {
    return;
  }

  await store.markDriverAlertSent(poolId, notification.chatId, telegramMessageId);
}

export function startNotificationOutboxLoop(input: {
  store: PostgresRidePoolStore;
  bots: BotRegistry;
  batchSize: number;
}): NodeJS.Timeout {
  const interval = setInterval(() => {
    void sendPendingNotifications(input).catch((error) => {
      console.error('Notification outbox sweep failed', error);
    });
  }, 5_000);

  interval.unref();
  return interval;
}

function selectBot(bots: BotRegistry, targetBot: string): Telegraf<Context> | null {
  return targetBot === 'driver' ? bots.driverBot ?? null : bots.passengerBot ?? null;
}

function buildMessageOptions(payload: Record<string, unknown>) {
  if (!payload.replyMarkup) {
    return undefined;
  }

  return {
    reply_markup: payload.replyMarkup
  };
}
