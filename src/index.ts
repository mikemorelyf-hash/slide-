import http from 'node:http';

import type { BotRegistry } from './bot/botRegistry.js';
import { createDriverBot } from './bot/createDriverBot.js';
import { createRidePoolBot } from './bot/createBot.js';
import { startPollingBots } from './bot/launchBots.js';
import { startNotificationOutboxLoop } from './bot/notificationOutbox.js';
import { loadEnv } from './config/env.js';
import { createPgPool } from './db/client.js';
import { runMigrations } from './db/migrate.js';
import { PostgresRidePoolStore } from './db/postgresRidePoolStore.js';
import { seedRoutes } from './db/seedRoutes.js';
import { RidePoolService } from './domain/ridePoolService.js';
import { createHttpApp } from './http/app.js';
import { startRecoveryLoop } from './workers/recoveryWorker.js';

async function main(): Promise<void> {
  const config = loadEnv();
  const db = createPgPool(config);

  await runMigrations(db);
  if (config.autoSeedRoutes) {
    const seededCount = await seedRoutes(db, config.routes);
    if (seededCount > 0) {
      console.log(`Seeded ${seededCount} route(s) from ROUTES env.`);
    }
  }

  const store = new PostgresRidePoolStore(db, db);
  const service = new RidePoolService(store, { poolSize: config.poolSize });
  const bots: BotRegistry = {};
  const bot = createRidePoolBot({ config, store, service, bots });
  bots.passengerBot = bot;
  const driverBot = config.driverBotToken
    ? createDriverBot({ config, store, service, bots })
    : null;
  if (driverBot) {
    bots.driverBot = driverBot;
  }

  const app = createHttpApp({ config, store, service, bot, driverBot });
  const server = await listen(app, config.port);
  const recoveryLoop = startRecoveryLoop(config, store);
  const notificationLoop = startNotificationOutboxLoop({ store, bots, batchSize: 25 });

  if (config.botMode === 'webhook') {
    const webhookUrl = new URL(config.webhookPath, config.baseUrl ?? undefined).toString();
    await bot.telegram.setWebhook(webhookUrl, {
      secret_token: config.webhookSecret ?? undefined
    });
    console.log(`Telegram webhook registered at ${webhookUrl}`);
    if (driverBot) {
      const driverWebhookUrl = new URL(config.driverWebhookPath, config.baseUrl ?? undefined).toString();
      await driverBot.telegram.setWebhook(driverWebhookUrl, {
        secret_token: config.webhookSecret ?? undefined
      });
      console.log(`Driver bot webhook registered at ${driverWebhookUrl}`);
    }
  } else {
    await bot.telegram.deleteWebhook();
    if (driverBot) {
      await driverBot.telegram.deleteWebhook();
    }
    const startedCount = startPollingBots({
      passengerBot: bot,
      driverBot,
      onError: (error) => {
        console.error('Telegram polling failed', error);
        process.exit(1);
      }
    });
    console.log(`Started ${startedCount} Telegram bot(s) in polling mode.`);
  }

  console.log(`HTTP server listening on port ${config.port}`);

  const shutdown = async (signal: string) => {
    console.log(`Received ${signal}, shutting down.`);
    clearInterval(recoveryLoop);
    clearInterval(notificationLoop);
    bot.stop(signal);
    driverBot?.stop(signal);
    await closeServer(server);
    await db.end();
    process.exit(0);
  };

  process.once('SIGINT', () => {
    void shutdown('SIGINT');
  });
  process.once('SIGTERM', () => {
    void shutdown('SIGTERM');
  });
}

function listen(app: ReturnType<typeof createHttpApp>, port: number): Promise<http.Server> {
  return new Promise((resolve) => {
    const server = app.listen(port, () => resolve(server));
  });
}

function closeServer(server: http.Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

main().catch((error) => {
  console.error('Failed to start backend', error);
  process.exit(1);
});
