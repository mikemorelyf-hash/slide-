import type { BotMode } from '../config/env.js';
import type { AdminOverview } from '../domain/adminTypes.js';

type CheckStatus = 'ok' | 'warning' | 'error';
type ReadinessStatus = 'ready' | 'degraded' | 'unready';

export interface ReadinessInput {
  databaseOk: boolean;
  botMode: BotMode;
  baseUrl: string | null;
  miniAppUrl: string | null;
  driverBotConfigured: boolean;
  pendingNotifications: number;
  sendingNotifications: number;
  failedNotifications: number;
  stuckPools: AdminOverview['stability']['stuckPools'];
}

export interface ReadinessCheck {
  status: CheckStatus;
  message: string;
}

export interface ReadinessReport {
  ok: boolean;
  status: ReadinessStatus;
  service: 'telegram-ride-pool-backend';
  checks: {
    database: ReadinessCheck;
    notifications: ReadinessCheck & {
      pending: number;
      sending: number;
      failed: number;
    };
    workflows: ReadinessCheck & {
      stuckPools: ReadinessInput['stuckPools'];
    };
    telegram: ReadinessCheck & {
      botMode: BotMode;
      driverBotConfigured: boolean;
    };
    miniApp: ReadinessCheck & {
      url: string | null;
    };
  };
}

export function buildReadinessReport(input: ReadinessInput): ReadinessReport {
  const database = buildDatabaseCheck(input.databaseOk);
  const notifications = buildNotificationCheck(input);
  const workflows = buildWorkflowCheck(input.stuckPools);
  const telegram = buildTelegramCheck(input);
  const miniApp = buildMiniAppCheck(input.miniAppUrl);

  const checks = {
    database,
    notifications,
    workflows,
    telegram,
    miniApp
  };
  const statuses = Object.values(checks).map((check) => check.status);
  const status: ReadinessStatus = statuses.includes('error')
    ? 'unready'
    : statuses.includes('warning')
      ? 'degraded'
      : 'ready';

  return {
    ok: status !== 'unready',
    status,
    service: 'telegram-ride-pool-backend',
    checks
  };
}

function buildDatabaseCheck(databaseOk: boolean): ReadinessCheck {
  return databaseOk
    ? { status: 'ok', message: 'Database connection is healthy.' }
    : { status: 'error', message: 'Database connection failed.' };
}

function buildNotificationCheck(input: ReadinessInput): ReadinessReport['checks']['notifications'] {
  if (input.failedNotifications > 0) {
    return {
      status: 'warning',
      message: 'Some Telegram notifications failed and need retry.',
      pending: input.pendingNotifications,
      sending: input.sendingNotifications,
      failed: input.failedNotifications
    };
  }

  return {
    status: 'ok',
    message: 'Notification outbox is healthy.',
    pending: input.pendingNotifications,
    sending: input.sendingNotifications,
    failed: input.failedNotifications
  };
}

function buildWorkflowCheck(
  stuckPools: ReadinessInput['stuckPools']
): ReadinessReport['checks']['workflows'] {
  return stuckPools.length
    ? {
        status: 'warning',
        message: 'Some pool workflows need admin attention.',
        stuckPools
      }
    : {
        status: 'ok',
        message: 'No stuck workflows detected.',
        stuckPools
      };
}

function buildTelegramCheck(input: ReadinessInput): ReadinessReport['checks']['telegram'] {
  if (input.botMode === 'webhook' && !input.baseUrl) {
    return {
      status: 'error',
      message: 'Webhook mode requires BASE_URL.',
      botMode: input.botMode,
      driverBotConfigured: input.driverBotConfigured
    };
  }

  if (!input.driverBotConfigured) {
    return {
      status: 'warning',
      message: 'Driver bot is not configured.',
      botMode: input.botMode,
      driverBotConfigured: input.driverBotConfigured
    };
  }

  return {
    status: 'ok',
    message: 'Telegram bot configuration is healthy.',
    botMode: input.botMode,
    driverBotConfigured: input.driverBotConfigured
  };
}

function buildMiniAppCheck(miniAppUrl: string | null): ReadinessReport['checks']['miniApp'] {
  return miniAppUrl
    ? {
        status: 'ok',
        message: 'Mini App URL is configured.',
        url: miniAppUrl
      }
    : {
        status: 'warning',
        message: 'MINI_APP_URL is not set, so Telegram cannot open the Mini App button.',
        url: null
      };
}
