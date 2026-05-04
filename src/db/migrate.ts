import type { Pool as PgPool } from 'pg';

export async function runMigrations(db: PgPool): Promise<void> {
  await db.query(`
    CREATE TABLE IF NOT EXISTS routes (
      id BIGSERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      price_amount NUMERIC(10, 2),
      price_currency TEXT NOT NULL DEFAULT 'ETB',
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS telegram_users (
      telegram_id TEXT PRIMARY KEY,
      first_name TEXT,
      last_name TEXT,
      username TEXT,
      phone_number TEXT,
      location_lat DOUBLE PRECISION,
      location_lng DOUBLE PRECISION,
      location_label TEXT,
      driver_bot_started_at TIMESTAMPTZ,
      role TEXT NOT NULL DEFAULT 'passenger'
        CHECK (role IN ('passenger', 'driver', 'admin')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS pools (
      id BIGSERIAL PRIMARY KEY,
      route_id BIGINT NOT NULL REFERENCES routes(id),
      captain_telegram_id TEXT NOT NULL REFERENCES telegram_users(telegram_id),
      pin_code TEXT NOT NULL UNIQUE,
      workflow_channel TEXT NOT NULL DEFAULT 'telegram'
        CHECK (workflow_channel IN ('telegram', 'mini_app')),
      status TEXT NOT NULL DEFAULT 'open'
        CHECK (status IN ('open', 'ready', 'assigned', 'arrival_requested', 'in_progress', 'cancelled', 'expired', 'completed')),
      driver_telegram_id TEXT REFERENCES telegram_users(telegram_id),
      driver_group_chat_id TEXT,
      driver_alert_message_id INTEGER,
      price_amount NUMERIC(10, 2),
      price_currency TEXT NOT NULL DEFAULT 'ETB',
      is_early_dispatch BOOLEAN NOT NULL DEFAULT FALSE,
      early_dispatch_requested_at TIMESTAMPTZ,
      sent_to_drivers_at TIMESTAMPTZ,
      accepted_at TIMESTAMPTZ,
      arrival_requested_at TIMESTAMPTZ,
      arrived_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS pool_passengers (
      pool_id BIGINT NOT NULL REFERENCES pools(id) ON DELETE CASCADE,
      telegram_id TEXT NOT NULL REFERENCES telegram_users(telegram_id),
      is_captain BOOLEAN NOT NULL DEFAULT FALSE,
      payment_status TEXT NOT NULL DEFAULT 'pending'
        CHECK (payment_status IN ('pending', 'confirmed', 'cancelled')),
      early_dispatch_vote TEXT NOT NULL DEFAULT 'pending'
        CHECK (early_dispatch_vote IN ('pending', 'accepted', 'rejected')),
      joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      paid_at TIMESTAMPTZ,
      PRIMARY KEY (pool_id, telegram_id)
    );

    CREATE TABLE IF NOT EXISTS pool_events (
      id BIGSERIAL PRIMARY KEY,
      pool_id BIGINT NOT NULL REFERENCES pools(id) ON DELETE CASCADE,
      actor_telegram_id TEXT,
      actor_role TEXT NOT NULL CHECK (actor_role IN ('passenger', 'driver', 'admin', 'system')),
      event_type TEXT NOT NULL,
      from_status TEXT,
      to_status TEXT,
      metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS idempotency_keys (
      key TEXT PRIMARY KEY,
      source TEXT NOT NULL,
      actor_telegram_id TEXT,
      request_hash TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('processing', 'completed', 'failed')),
      response_json JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at TIMESTAMPTZ NOT NULL
    );

    CREATE TABLE IF NOT EXISTS notification_outbox (
      id BIGSERIAL PRIMARY KEY,
      target_bot TEXT NOT NULL CHECK (target_bot IN ('passenger', 'driver')),
      chat_id TEXT NOT NULL,
      message_type TEXT NOT NULL,
      payload_json JSONB NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'sending', 'sent', 'failed', 'cancelled')),
      telegram_message_id INTEGER,
      attempt_count INTEGER NOT NULL DEFAULT 0,
      next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_error TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      sent_at TIMESTAMPTZ
    );

    CREATE TABLE IF NOT EXISTS pending_passenger_actions (
      telegram_id TEXT PRIMARY KEY REFERENCES telegram_users(telegram_id) ON DELETE CASCADE,
      action_type TEXT NOT NULL CHECK (action_type IN ('create_pool', 'join_pool')),
      route_id TEXT,
      pool_id TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at TIMESTAMPTZ NOT NULL,
      CHECK (
        (action_type = 'create_pool' AND route_id IS NOT NULL AND pool_id IS NULL)
        OR
        (action_type = 'join_pool' AND pool_id IS NOT NULL AND route_id IS NULL)
      )
    );

    CREATE INDEX IF NOT EXISTS routes_active_idx ON routes (is_active);
    CREATE INDEX IF NOT EXISTS pools_route_status_idx ON pools (route_id, status, created_at);
    CREATE INDEX IF NOT EXISTS pools_driver_alert_idx ON pools (driver_group_chat_id, driver_alert_message_id);
    CREATE INDEX IF NOT EXISTS pool_passengers_status_idx ON pool_passengers (pool_id, payment_status);
    CREATE INDEX IF NOT EXISTS pool_passengers_telegram_idx ON pool_passengers (telegram_id);
    CREATE INDEX IF NOT EXISTS pool_events_pool_created_idx ON pool_events (pool_id, created_at);
    CREATE INDEX IF NOT EXISTS idempotency_keys_expires_idx ON idempotency_keys (expires_at);
    CREATE INDEX IF NOT EXISTS notification_outbox_pending_idx ON notification_outbox (status, next_attempt_at, id);
    CREATE INDEX IF NOT EXISTS pending_passenger_actions_expires_idx ON pending_passenger_actions (expires_at);
  `);

  await db.query(`
    ALTER TABLE routes
      ADD COLUMN IF NOT EXISTS price_amount NUMERIC(10, 2),
      ADD COLUMN IF NOT EXISTS price_currency TEXT NOT NULL DEFAULT 'ETB';

    ALTER TABLE pools
      ADD COLUMN IF NOT EXISTS price_amount NUMERIC(10, 2),
      ADD COLUMN IF NOT EXISTS price_currency TEXT NOT NULL DEFAULT 'ETB',
      ADD COLUMN IF NOT EXISTS workflow_channel TEXT NOT NULL DEFAULT 'telegram',
      ADD COLUMN IF NOT EXISTS is_early_dispatch BOOLEAN NOT NULL DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS early_dispatch_requested_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS arrival_requested_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS arrived_at TIMESTAMPTZ;

    ALTER TABLE pools
      DROP CONSTRAINT IF EXISTS pools_status_check,
      ADD CONSTRAINT pools_status_check
        CHECK (status IN ('open', 'ready', 'assigned', 'arrival_requested', 'in_progress', 'cancelled', 'expired', 'completed'));

    ALTER TABLE pools
      DROP CONSTRAINT IF EXISTS pools_workflow_channel_check,
      ADD CONSTRAINT pools_workflow_channel_check
        CHECK (workflow_channel IN ('telegram', 'mini_app'));

    ALTER TABLE pool_passengers
      ADD COLUMN IF NOT EXISTS early_dispatch_vote TEXT NOT NULL DEFAULT 'pending',
      ADD COLUMN IF NOT EXISTS reservation_expires_at TIMESTAMPTZ;

    ALTER TABLE telegram_users
      ADD COLUMN IF NOT EXISTS driver_bot_started_at TIMESTAMPTZ;

    ALTER TABLE notification_outbox
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

    CREATE INDEX IF NOT EXISTS pools_route_status_workflow_idx ON pools (route_id, status, workflow_channel, created_at);

    UPDATE pools
    SET status = 'arrival_requested',
        updated_at = NOW()
    WHERE status = 'assigned'
      AND arrival_requested_at IS NOT NULL
      AND arrived_at IS NULL;
  `);
}
