import type { Telegraf, Context } from 'telegraf';

import type { AppConfig } from '../config/env.js';
import { PostgresRidePoolStore } from '../db/postgresRidePoolStore.js';
import { RidePoolService } from '../domain/ridePoolService.js';
import { runRecoverySweep } from '../workers/recoveryWorker.js';

interface LateDriverRepostDeps {
  config: AppConfig;
  store: PostgresRidePoolStore;
  service?: RidePoolService;
  bot?: Telegraf<Context>;
}

export function startLateDriverRepostLoop(deps: LateDriverRepostDeps): NodeJS.Timeout {
  const interval = setInterval(() => {
    void repostLateDrivers(deps).catch((error) => {
      console.error('Late driver repost sweep failed', error);
    });
  }, deps.config.lateDriverSweepIntervalSeconds * 1000);

  interval.unref();
  return interval;
}

export async function repostLateDrivers({
  config,
  store
}: LateDriverRepostDeps): Promise<void> {
  await runRecoverySweep({
    store,
    driverGroupChatId: config.driverGroupChatId,
    driverArrivalTimeoutMinutes: config.driverArrivalTimeoutMinutes
  });
}
