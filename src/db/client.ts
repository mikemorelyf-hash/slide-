import { Pool as PgPool } from 'pg';

import type { AppConfig } from '../config/env.js';

export function createPgPool(config: AppConfig): PgPool {
  return new PgPool({
    connectionString: config.databaseUrl,
    ssl: config.pgSslMode === 'require' ? { rejectUnauthorized: false } : undefined,
    max: config.pgPoolMax,
    idleTimeoutMillis: config.pgIdleTimeoutMs,
    connectionTimeoutMillis: config.pgConnectionTimeoutMs
  });
}
