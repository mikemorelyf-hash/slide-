import { describe, expect, it } from 'vitest';

import { loadEnv } from '../src/config/env.js';

const baseEnv = {
  DATABASE_URL: 'postgresql://postgres:1234@localhost:5432/ride_pool',
  BOT_TOKEN: '123456:test-token',
  BOT_MODE: 'polling',
  DRIVER_GROUP_CHAT_ID: '-1001234567890'
};

describe('loadEnv', () => {
  it('rejects positive private chat IDs for the driver group', () => {
    expect(() =>
      loadEnv({
        ...baseEnv,
        DRIVER_GROUP_CHAT_ID: '5263542902'
      })
    ).toThrow('DRIVER_GROUP_CHAT_ID must be a Telegram group or supergroup chat ID');
  });

  it('accepts negative Telegram group chat IDs', () => {
    const config = loadEnv(baseEnv);

    expect(config.driverGroupChatId).toBe('-1001234567890');
  });

  it('loads an optional separate driver bot token', () => {
    const config = loadEnv({
      ...baseEnv,
      DRIVER_BOT_TOKEN: '123456:driver-token'
    });

    expect(config.driverBotToken).toBe('123456:driver-token');
    expect(config.driverWebhookPath).toBe('/telegram/driver-webhook');
  });

  it('loads the optional passenger Mini App URL', () => {
    const config = loadEnv({
      ...baseEnv,
      MINI_APP_URL: 'https://ride-pool.vercel.app'
    });

    expect(config.miniAppUrl).toBe('https://ride-pool.vercel.app');
  });

  it('loads configurable PostgreSQL pool limits for Railway', () => {
    const config = loadEnv({
      ...baseEnv,
      PG_POOL_MAX: '6',
      PG_IDLE_TIMEOUT_MS: '15000',
      PG_CONNECTION_TIMEOUT_MS: '3000'
    });

    expect(config.pgPoolMax).toBe(6);
    expect(config.pgIdleTimeoutMs).toBe(15000);
    expect(config.pgConnectionTimeoutMs).toBe(3000);
  });
});
