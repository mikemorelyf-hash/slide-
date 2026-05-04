import { Markup } from 'telegraf';

import type { AppConfig } from '../config/env.js';
import type { PostgresRidePoolStore } from '../db/postgresRidePoolStore.js';
import type { NotificationOutboxInput, PoolEventInput, RidePool } from '../domain/types.js';
import { driverGroupAlertMessage, repostedDriverAlertMessage } from '../bot/messages.js';

interface RecoveryStore {
  listReadyPoolsMissingDriverAlert(limit?: number): Promise<RidePool[]>;
  findLateAssignedPools(cutoff: Date): Promise<RidePool[]>;
  expireDriverAssignment(poolId: string): Promise<RidePool | null>;
  expireOpenReservations(cutoff: Date): Promise<number>;
  cancelEmptyStaleOpenPools(cutoff: Date): Promise<number>;
  enqueueNotification(input: NotificationOutboxInput): Promise<string>;
  insertPoolEvent(input: PoolEventInput): Promise<void>;
}

interface RecoverySweepInput {
  store: RecoveryStore;
  driverGroupChatId: string;
  driverArrivalTimeoutMinutes: number;
}

export async function runRecoverySweep({
  store,
  driverGroupChatId,
  driverArrivalTimeoutMinutes
}: RecoverySweepInput): Promise<void> {
  const readyPools = await store.listReadyPoolsMissingDriverAlert();
  for (const pool of readyPools) {
    await store.enqueueNotification(driverAlertNotification(driverGroupChatId, pool));
    await store.insertPoolEvent({
      poolId: pool.id,
      actorTelegramId: null,
      actorRole: 'system',
      eventType: 'driver_alert_queued',
      fromStatus: pool.status,
      toStatus: pool.status,
      metadata: { reason: 'missing_driver_alert' }
    });
  }

  const cutoff = new Date(Date.now() - driverArrivalTimeoutMinutes * 60_000);
  const latePools = await store.findLateAssignedPools(cutoff);
  for (const pool of latePools) {
    const repostablePool = await store.expireDriverAssignment(pool.id);
    if (!repostablePool) {
      continue;
    }

    await store.enqueueNotification(repostedDriverNotification(driverGroupChatId, repostablePool));
    await store.insertPoolEvent({
      poolId: repostablePool.id,
      actorTelegramId: null,
      actorRole: 'system',
      eventType: 'recovery_driver_reposted',
      fromStatus: 'assigned',
      toStatus: 'ready',
      metadata: { previousDriverTelegramId: pool.driverTelegramId }
    });
  }

  await store.expireOpenReservations(new Date());
  await store.cancelEmptyStaleOpenPools(new Date(Date.now() - 60 * 60_000));
}

export function startRecoveryLoop(config: AppConfig, store: PostgresRidePoolStore): NodeJS.Timeout {
  const input = {
    store,
    driverGroupChatId: config.driverGroupChatId,
    driverArrivalTimeoutMinutes: config.driverArrivalTimeoutMinutes
  };

  void runRecoverySweep(input).catch((error) => {
    console.error('Startup recovery sweep failed', error);
  });

  const interval = setInterval(() => {
    void runRecoverySweep(input).catch((error) => {
      console.error('Recovery sweep failed', error);
    });
  }, config.lateDriverSweepIntervalSeconds * 1000);

  interval.unref();
  return interval;
}

function driverAlertNotification(chatId: string, pool: RidePool): NotificationOutboxInput {
  return {
    targetBot: 'driver',
    chatId,
    messageType: 'driver_pool_ready',
    payload: driverAlertPayload(pool, driverGroupAlertMessage(pool))
  };
}

function repostedDriverNotification(chatId: string, pool: RidePool): NotificationOutboxInput {
  return {
    targetBot: 'driver',
    chatId,
    messageType: 'driver_pool_reposted',
    payload: driverAlertPayload(pool, repostedDriverAlertMessage(pool))
  };
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
