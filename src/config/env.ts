import 'dotenv/config';

import { z } from 'zod';

export type BotMode = 'polling' | 'webhook';

export interface AppConfig {
  nodeEnv: string;
  port: number;
  databaseUrl: string;
  pgSslMode: 'disable' | 'require';
  pgPoolMax: number;
  pgIdleTimeoutMs: number;
  pgConnectionTimeoutMs: number;
  botToken: string;
  driverBotToken: string | null;
  botMode: BotMode;
  baseUrl: string | null;
  webhookPath: string;
  driverWebhookPath: string;
  webhookSecret: string | null;
  driverGroupChatId: string;
  adminChatId: string | null;
  adminTelegramIds: string[];
  frontendOrigin: string | string[] | true;
  poolSize: number;
  driverArrivalTimeoutMinutes: number;
  lateDriverSweepIntervalSeconds: number;
  autoSeedRoutes: boolean;
  routes: string[];
  miniAppUrl: string | null;
  miniAppInitDataMaxAgeSeconds: number;
}

const envSchema = z.object({
  NODE_ENV: z.string().default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  PGSSLMODE: z.enum(['disable', 'require']).default('disable'),
  PG_POOL_MAX: z.coerce.number().int().positive().default(6),
  PG_IDLE_TIMEOUT_MS: z.coerce.number().int().positive().default(15_000),
  PG_CONNECTION_TIMEOUT_MS: z.coerce.number().int().positive().default(5_000),
  BOT_TOKEN: z.string().min(1, 'BOT_TOKEN is required'),
  DRIVER_BOT_TOKEN: emptyToUndefined(z.string().min(1)).optional(),
  BOT_MODE: z.enum(['polling', 'webhook']).optional(),
  BASE_URL: emptyToUndefined(z.string().url()).optional(),
  WEBHOOK_PATH: z.string().default('/telegram/webhook'),
  DRIVER_WEBHOOK_PATH: z.string().default('/telegram/driver-webhook'),
  WEBHOOK_SECRET: emptyToUndefined(z.string().min(16)).optional(),
  DRIVER_GROUP_CHAT_ID: z
    .string()
    .regex(
      /^-\d+$/,
      'DRIVER_GROUP_CHAT_ID must be a Telegram group or supergroup chat ID, usually starting with -100'
    ),
  ADMIN_CHAT_ID: emptyToUndefined(z.string()).optional(),
  ADMIN_TELEGRAM_IDS: z.string().default(''),
  FRONTEND_ORIGIN: z.string().default('*'),
  POOL_SIZE: z.coerce.number().int().min(2).max(12).default(4),
  DRIVER_ARRIVAL_TIMEOUT_MINUTES: z.coerce.number().int().positive().default(10),
  LATE_DRIVER_SWEEP_INTERVAL_SECONDS: z.coerce.number().int().positive().default(60),
  AUTO_SEED_ROUTES: z.string().default('true'),
  ROUTES: z.string().default(''),
  MINI_APP_URL: emptyToUndefined(z.string().url()).optional(),
  MINI_APP_INIT_DATA_MAX_AGE_SECONDS: z.coerce.number().int().positive().default(86_400)
});

export function loadEnv(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.parse(env);
  const botMode = parsed.BOT_MODE ?? (parsed.NODE_ENV === 'production' ? 'webhook' : 'polling');

  if (botMode === 'webhook' && !parsed.BASE_URL) {
    throw new Error('BASE_URL is required when BOT_MODE=webhook');
  }

  if (botMode === 'webhook' && !parsed.WEBHOOK_SECRET) {
    throw new Error('WEBHOOK_SECRET with at least 16 characters is required when BOT_MODE=webhook');
  }

  return {
    nodeEnv: parsed.NODE_ENV,
    port: parsed.PORT,
    databaseUrl: parsed.DATABASE_URL,
    pgSslMode: parsed.PGSSLMODE,
    pgPoolMax: parsed.PG_POOL_MAX,
    pgIdleTimeoutMs: parsed.PG_IDLE_TIMEOUT_MS,
    pgConnectionTimeoutMs: parsed.PG_CONNECTION_TIMEOUT_MS,
    botToken: parsed.BOT_TOKEN,
    driverBotToken: parsed.DRIVER_BOT_TOKEN ?? null,
    botMode,
    baseUrl: parsed.BASE_URL ?? null,
    webhookPath: ensureLeadingSlash(parsed.WEBHOOK_PATH),
    driverWebhookPath: ensureLeadingSlash(parsed.DRIVER_WEBHOOK_PATH),
    webhookSecret: parsed.WEBHOOK_SECRET ?? null,
    driverGroupChatId: parsed.DRIVER_GROUP_CHAT_ID,
    adminChatId: parsed.ADMIN_CHAT_ID ?? null,
    adminTelegramIds: parseList(parsed.ADMIN_TELEGRAM_IDS, ','),
    frontendOrigin: parseFrontendOrigin(parsed.FRONTEND_ORIGIN),
    poolSize: parsed.POOL_SIZE,
    driverArrivalTimeoutMinutes: parsed.DRIVER_ARRIVAL_TIMEOUT_MINUTES,
    lateDriverSweepIntervalSeconds: parsed.LATE_DRIVER_SWEEP_INTERVAL_SECONDS,
    autoSeedRoutes: parseBoolean(parsed.AUTO_SEED_ROUTES),
    routes: parseRoutes(parsed.ROUTES),
    miniAppUrl: parsed.MINI_APP_URL ?? null,
    miniAppInitDataMaxAgeSeconds: parsed.MINI_APP_INIT_DATA_MAX_AGE_SECONDS
  };
}

function emptyToUndefined<T extends z.ZodTypeAny>(schema: T): z.ZodEffects<z.ZodString, z.infer<T> | undefined> {
  return z.string().transform((value, ctx) => {
    if (value.trim() === '') {
      return undefined;
    }

    const result = schema.safeParse(value);
    if (!result.success) {
      for (const issue of result.error.issues) {
        ctx.addIssue(issue);
      }
      return z.NEVER;
    }

    return result.data;
  });
}

function ensureLeadingSlash(path: string): string {
  return path.startsWith('/') ? path : `/${path}`;
}

function parseBoolean(value: string): boolean {
  return ['true', '1', 'yes', 'on'].includes(value.trim().toLowerCase());
}

function parseRoutes(value: string): string[] {
  return parseList(value, /\||\r?\n/);
}

function parseList(value: string, separator: string | RegExp): string[] {
  return value
    .split(separator)
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseFrontendOrigin(value: string): string | string[] | true {
  if (value.trim() === '*') {
    return true;
  }

  const origins = value
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  return origins.length === 1 ? origins[0] : origins;
}
