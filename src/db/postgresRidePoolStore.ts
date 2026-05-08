import type { Pool as PgPool, PoolClient } from 'pg';

import type {
  AdminPassengerManifest,
  AdminPoolDetail,
  AdminPoolSummary
} from '../domain/adminTypes.js';
import { normalizeLanguageCode } from '../domain/language.js';
import type { CreatePoolInput, RidePoolStore } from '../domain/ridePoolService.js';
import type {
  NotificationOutboxInput,
  NotificationStatus,
  PassengerManifest,
  PendingPassengerAction,
  PendingPassengerActionInput,
  PoolPassenger,
  PoolEventInput,
  PoolStatus,
  QueuedNotification,
  RidePool,
  Route,
  TelegramUserProfile,
  WorkflowChannel
} from '../domain/types.js';

type Queryable = Pick<PgPool | PoolClient, 'query'>;

export class PostgresRidePoolStore implements RidePoolStore {
  constructor(
    private readonly queryable: Queryable,
    private readonly pool?: PgPool
  ) {}

  async withTransaction<T>(work: (store: RidePoolStore) => Promise<T>): Promise<T> {
    if (!this.pool) {
      return work(this);
    }

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await work(new PostgresRidePoolStore(client));
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async ping(): Promise<void> {
    await this.queryable.query('SELECT 1');
  }

  async listActiveRoutes(): Promise<Route[]> {
    const result = await this.queryable.query(`
      SELECT id::text, name, is_active, price_amount, price_currency
      FROM routes
      WHERE is_active = TRUE
      ORDER BY id ASC
    `);

    return result.rows.map(mapRoute);
  }

  async listRoutes(): Promise<Route[]> {
    const result = await this.queryable.query(`
      SELECT id::text, name, is_active, price_amount, price_currency
      FROM routes
      ORDER BY id ASC
    `);

    return result.rows.map(mapRoute);
  }

  async getRoute(routeId: string): Promise<Route | null> {
    const result = await this.queryable.query(
      `
        SELECT id::text, name, is_active, price_amount, price_currency
        FROM routes
        WHERE id = $1
      `,
      [routeId]
    );

    return result.rows[0] ? mapRoute(result.rows[0]) : null;
  }

  async updateRoutePrice(routeId: string, amount: number, currency: string): Promise<Route | null> {
    const result = await this.queryable.query(
      `
        UPDATE routes
        SET price_amount = $2,
            price_currency = $3,
            updated_at = NOW()
        WHERE id = $1
        RETURNING id::text, name, is_active, price_amount, price_currency
      `,
      [routeId, amount, currency]
    );

    return result.rows[0] ? mapRoute(result.rows[0]) : null;
  }

  async listAdminPoolSummaries(limit = 50): Promise<AdminPoolSummary[]> {
    return this.queryAdminPoolSummaries('', [limit], 'ORDER BY p.created_at DESC LIMIT $1');
  }

  async getAdminPoolDetail(poolId: string): Promise<AdminPoolDetail | null> {
    const [pool] = await this.queryAdminPoolSummaries('WHERE p.id = $1', [poolId]);
    if (!pool) {
      return null;
    }

    return {
      pool,
      passengers: await this.getAdminPassengerManifests(poolId)
    };
  }

  async countCompletedPoolsSince(since: Date): Promise<number> {
    const result = await this.queryable.query(
      `
        SELECT COUNT(*)::int AS count
        FROM pools
        WHERE status = 'completed'
          AND updated_at >= $1
      `,
      [since]
    );

    return Number(result.rows[0]?.count ?? 0);
  }

  async countNotificationsByStatus(status: NotificationStatus): Promise<number> {
    const result = await this.queryable.query(
      `
        SELECT COUNT(*)::int AS count
        FROM notification_outbox
        WHERE status = $1
      `,
      [status]
    );

    return Number(result.rows[0]?.count ?? 0);
  }

  async insertPoolEvent(input: PoolEventInput): Promise<void> {
    await this.queryable.query(
      `
        INSERT INTO pool_events (
          pool_id,
          actor_telegram_id,
          actor_role,
          event_type,
          from_status,
          to_status,
          metadata_json
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
      `,
      [
        input.poolId,
        input.actorTelegramId,
        input.actorRole,
        input.eventType,
        input.fromStatus,
        input.toStatus,
        JSON.stringify(input.metadata)
      ]
    );
  }

  async getCompletedIdempotency(key: string, requestHash: string): Promise<unknown | null> {
    const result = await this.queryable.query(
      `
        SELECT response_json
        FROM idempotency_keys
        WHERE key = $1
          AND request_hash = $2
          AND status = 'completed'
          AND expires_at > NOW()
      `,
      [key, requestHash]
    );

    return result.rows[0]?.response_json ?? null;
  }

  async createIdempotencyProcessing(input: {
    key: string;
    source: string;
    actorTelegramId: string | null;
    requestHash: string;
    expiresAt: Date;
  }): Promise<'created' | 'exists'> {
    const result = await this.queryable.query(
      `
        INSERT INTO idempotency_keys (
          key,
          source,
          actor_telegram_id,
          request_hash,
          status,
          expires_at
        )
        VALUES ($1, $2, $3, $4, 'processing', $5)
        ON CONFLICT (key)
        DO UPDATE SET
          source = EXCLUDED.source,
          actor_telegram_id = EXCLUDED.actor_telegram_id,
          request_hash = EXCLUDED.request_hash,
          status = 'processing',
          response_json = NULL,
          created_at = NOW(),
          expires_at = EXCLUDED.expires_at
        WHERE idempotency_keys.status = 'failed'
           OR idempotency_keys.expires_at <= NOW()
      `,
      [input.key, input.source, input.actorTelegramId, input.requestHash, input.expiresAt]
    );

    return (result.rowCount ?? 0) === 1 ? 'created' : 'exists';
  }

  async completeIdempotency(key: string, response: unknown): Promise<void> {
    await this.queryable.query(
      `
        UPDATE idempotency_keys
        SET status = 'completed',
            response_json = $2::jsonb
        WHERE key = $1
      `,
      [key, JSON.stringify(response)]
    );
  }

  async failIdempotency(key: string, error: string): Promise<void> {
    await this.queryable.query(
      `
        UPDATE idempotency_keys
        SET status = 'failed',
            response_json = $2::jsonb
        WHERE key = $1
      `,
      [key, JSON.stringify({ error })]
    );
  }

  async savePendingPassengerAction(input: PendingPassengerActionInput): Promise<void> {
    await this.queryable.query(
      `
        INSERT INTO pending_passenger_actions (
          telegram_id,
          action_type,
          route_id,
          pool_id,
          expires_at
        )
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (telegram_id)
        DO UPDATE SET
          action_type = EXCLUDED.action_type,
          route_id = EXCLUDED.route_id,
          pool_id = EXCLUDED.pool_id,
          created_at = NOW(),
          expires_at = EXCLUDED.expires_at
      `,
      [input.telegramId, input.actionType, input.routeId, input.poolId, input.expiresAt]
    );
  }

  async getPendingPassengerAction(telegramId: string): Promise<PendingPassengerAction | null> {
    await this.queryable.query(
      `
        DELETE FROM pending_passenger_actions
        WHERE expires_at <= NOW()
      `
    );

    const result = await this.queryable.query(
      `
        SELECT telegram_id, action_type, route_id, pool_id, created_at, expires_at
        FROM pending_passenger_actions
        WHERE telegram_id = $1
          AND expires_at > NOW()
      `,
      [telegramId]
    );

    if (!result.rows[0]) {
      return null;
    }

    return mapPendingPassengerAction(result.rows[0]);
  }

  async clearPendingPassengerAction(telegramId: string): Promise<void> {
    await this.queryable.query(
      `
        DELETE FROM pending_passenger_actions
        WHERE telegram_id = $1
      `,
      [telegramId]
    );
  }

  async enqueueNotification(input: NotificationOutboxInput): Promise<string> {
    const [id] = await this.enqueueNotifications([input]);
    return id;
  }

  async enqueueNotifications(inputs: NotificationOutboxInput[]): Promise<string[]> {
    const ids: string[] = [];
    for (const input of inputs) {
      const result = await this.queryable.query(
        `
          INSERT INTO notification_outbox (
            target_bot,
            chat_id,
            message_type,
            payload_json,
            next_attempt_at
          )
          VALUES ($1, $2, $3, $4::jsonb, COALESCE($5, NOW()))
          RETURNING id::text
        `,
        [
          input.targetBot,
          input.chatId,
          input.messageType,
          JSON.stringify(input.payload),
          input.nextAttemptAt ?? null
        ]
      );
      ids.push(String(result.rows[0].id));
    }
    return ids;
  }

  async claimPendingNotifications(limit: number): Promise<QueuedNotification[]> {
    const result = await this.queryable.query(
      `
        UPDATE notification_outbox n
        SET status = 'sending',
            attempt_count = attempt_count + 1,
            updated_at = NOW()
        WHERE n.id IN (
          SELECT id
          FROM notification_outbox
          WHERE (
              status = 'pending'
              OR (
                status = 'sending'
                AND updated_at <= NOW() - INTERVAL '2 minutes'
              )
            )
            AND next_attempt_at <= NOW()
            AND attempt_count < 5
          ORDER BY next_attempt_at ASC, id ASC
          FOR UPDATE SKIP LOCKED
          LIMIT $1
        )
        RETURNING id::text, target_bot, chat_id, message_type, payload_json, attempt_count
      `,
      [limit]
    );

    return result.rows.map(mapQueuedNotification);
  }

  async markNotificationSent(id: string, telegramMessageId: number): Promise<void> {
    await this.queryable.query(
      `
        UPDATE notification_outbox
        SET status = 'sent',
            telegram_message_id = $2,
            sent_at = NOW(),
            updated_at = NOW()
        WHERE id = $1
      `,
      [id, telegramMessageId]
    );
  }

  async markNotificationRetry(id: string, error: string, nextAttemptAt: Date): Promise<void> {
    await this.queryable.query(
      `
        UPDATE notification_outbox
        SET status = 'pending',
            last_error = $2,
            next_attempt_at = $3,
            updated_at = NOW()
        WHERE id = $1
      `,
      [id, error, nextAttemptAt]
    );
  }

  async markNotificationFailed(id: string, error: string): Promise<void> {
    await this.queryable.query(
      `
        UPDATE notification_outbox
        SET status = 'failed',
            last_error = $2,
            updated_at = NOW()
        WHERE id = $1
      `,
      [id, error]
    );
  }

  async retryFailedNotifications(): Promise<number> {
    const result = await this.queryable.query(
      `
        UPDATE notification_outbox
        SET status = 'pending',
            next_attempt_at = NOW(),
            last_error = NULL,
            updated_at = NOW()
        WHERE status = 'failed'
      `
    );

    return result.rowCount ?? 0;
  }

  private async queryAdminPoolSummaries(
    whereClause: string,
    values: unknown[],
    suffix = ''
  ): Promise<AdminPoolSummary[]> {
    const result = await this.queryable.query(
      `
        SELECT
          p.id::text,
          p.route_id::text,
          r.name AS route_name,
          p.pin_code,
          p.workflow_channel,
          p.captain_telegram_id,
          p.status,
          p.driver_telegram_id,
          p.driver_alert_message_id,
          p.driver_group_chat_id,
          p.price_amount,
          p.price_currency,
          p.is_early_dispatch,
          p.early_dispatch_requested_at,
          p.sent_to_drivers_at,
          p.accepted_at,
          p.arrival_requested_at,
          p.arrived_at,
          p.created_at,
          p.updated_at,
          passenger_counts.passenger_count::int,
          passenger_counts.pending_passenger_count::int,
          passenger_counts.cancelled_passenger_count::int,
          captain.telegram_id AS captain_user_telegram_id,
          captain.first_name AS captain_user_first_name,
          captain.last_name AS captain_user_last_name,
          captain.username AS captain_user_username,
          captain.phone_number AS captain_user_phone_number,
          captain.language_code AS captain_user_language_code,
          captain.role AS captain_user_role,
          driver.telegram_id AS driver_user_telegram_id,
          driver.first_name AS driver_user_first_name,
          driver.last_name AS driver_user_last_name,
          driver.username AS driver_user_username,
          driver.phone_number AS driver_user_phone_number,
          driver.language_code AS driver_user_language_code,
          driver.role AS driver_user_role
        FROM pools p
        JOIN routes r ON r.id = p.route_id
        LEFT JOIN LATERAL (
          SELECT
            COUNT(*) FILTER (WHERE pp.payment_status = 'confirmed') AS passenger_count,
            COUNT(*) FILTER (WHERE pp.payment_status = 'pending') AS pending_passenger_count,
            COUNT(*) FILTER (WHERE pp.payment_status = 'cancelled') AS cancelled_passenger_count
          FROM pool_passengers pp
          WHERE pp.pool_id = p.id
        ) passenger_counts ON TRUE
        LEFT JOIN telegram_users captain ON captain.telegram_id = p.captain_telegram_id
        LEFT JOIN telegram_users driver ON driver.telegram_id = p.driver_telegram_id
        ${whereClause}
        ${suffix}
      `,
      values
    );

    return result.rows.map(mapAdminPoolSummary);
  }

  private async getAdminPassengerManifests(poolId: string): Promise<AdminPassengerManifest[]> {
    const result = await this.queryable.query(
      `
        SELECT
          pp.pool_id::text,
          pp.telegram_id,
          pp.is_captain,
          pp.payment_status,
          pp.early_dispatch_vote,
          pp.joined_at,
          pp.paid_at,
          u.first_name,
          u.last_name,
          u.username,
          u.phone_number
        FROM pool_passengers pp
        JOIN telegram_users u ON u.telegram_id = pp.telegram_id
        WHERE pp.pool_id = $1
        ORDER BY pp.is_captain DESC, pp.joined_at ASC
      `,
      [poolId]
    );

    return result.rows.map(mapAdminPassengerManifest);
  }

  async isPinInUse(pinCode: string): Promise<boolean> {
    const result = await this.queryable.query('SELECT 1 FROM pools WHERE pin_code = $1 LIMIT 1', [
      pinCode
    ]);
    return (result.rowCount ?? 0) > 0;
  }

  async createPool(input: CreatePoolInput): Promise<RidePool> {
    const result = await this.queryable.query(
      `
        INSERT INTO pools (
          route_id,
          captain_telegram_id,
          pin_code,
          workflow_channel,
          price_amount,
          price_currency
        )
        SELECT id, $2, $3, $4, price_amount, price_currency
        FROM routes
        WHERE id = $1
        RETURNING id::text
      `,
      [input.routeId, input.captainTelegramId, input.pinCode, input.workflowChannel]
    );

    const pool = await this.getPool(String(result.rows[0].id));
    if (!pool) {
      throw new Error('Created pool could not be loaded');
    }
    return pool;
  }

  async findOpenPoolByRoute(
    routeId: string,
    passengerLimit: number,
    workflowChannel: WorkflowChannel = 'telegram'
  ): Promise<RidePool | null> {
    const result = await this.queryable.query(
      `
        SELECT
          p.id::text,
          p.route_id::text,
          r.name AS route_name,
          p.pin_code,
          p.workflow_channel,
          p.captain_telegram_id,
          p.status,
          p.driver_telegram_id,
          p.driver_alert_message_id,
          p.driver_group_chat_id,
          p.price_amount,
          p.price_currency,
          p.is_early_dispatch,
          p.early_dispatch_requested_at,
          p.arrival_requested_at,
          p.arrived_at,
          passenger_counts.passenger_count::int
        FROM pools p
        JOIN routes r ON r.id = p.route_id
        LEFT JOIN LATERAL (
          SELECT COUNT(*)::int AS passenger_count
          FROM pool_passengers pp
          WHERE pp.pool_id = p.id AND pp.payment_status = 'confirmed'
        ) passenger_counts ON TRUE
        WHERE p.route_id = $1
          AND p.workflow_channel = $3
          AND p.status = 'open'
          AND p.driver_alert_message_id IS NULL
          AND passenger_counts.passenger_count > 0
          AND passenger_counts.passenger_count < $2
        ORDER BY p.created_at ASC
        LIMIT 1
      `,
      [routeId, passengerLimit, workflowChannel]
    );

    return result.rows[0] ? mapPool(result.rows[0]) : null;
  }

  async listOpenPoolsForRoute(
    routeId: string,
    passengerLimit: number,
    workflowChannel: WorkflowChannel = 'telegram'
  ): Promise<Array<{ pool: RidePool; captain: TelegramUserProfile | null }>> {
    const result = await this.queryable.query(
      `
        SELECT
          p.id::text,
          p.route_id::text,
          r.name AS route_name,
          p.pin_code,
          p.workflow_channel,
          p.captain_telegram_id,
          p.status,
          p.driver_telegram_id,
          p.driver_alert_message_id,
          p.driver_group_chat_id,
          p.price_amount,
          p.price_currency,
          p.is_early_dispatch,
          p.early_dispatch_requested_at,
          p.arrival_requested_at,
          p.arrived_at,
          passenger_counts.passenger_count::int,
          captain.telegram_id AS captain_user_telegram_id,
          captain.first_name AS captain_user_first_name,
          captain.last_name AS captain_user_last_name,
          captain.username AS captain_user_username,
          captain.phone_number AS captain_user_phone_number,
          captain.language_code AS captain_user_language_code,
          captain.role AS captain_user_role
        FROM pools p
        JOIN routes r ON r.id = p.route_id
        LEFT JOIN LATERAL (
          SELECT COUNT(*)::int AS passenger_count
          FROM pool_passengers pp
          WHERE pp.pool_id = p.id AND pp.payment_status = 'confirmed'
        ) passenger_counts ON TRUE
        LEFT JOIN telegram_users captain ON captain.telegram_id = p.captain_telegram_id
        WHERE p.route_id = $1
          AND p.workflow_channel = $3
          AND p.status = 'open'
          AND passenger_counts.passenger_count > 0
          AND passenger_counts.passenger_count < $2
        ORDER BY passenger_counts.passenger_count DESC, p.created_at ASC
      `,
      [routeId, passengerLimit, workflowChannel]
    );

    return result.rows.map((row) => ({
      pool: mapPool(row),
      captain: mapPrefixedUser(row, 'captain_user')
    }));
  }

  async getPoolForUpdate(poolId: string): Promise<RidePool | null> {
    await this.queryable.query('SELECT id FROM pools WHERE id = $1 FOR UPDATE', [poolId]);
    return this.getPool(poolId);
  }

  async getPool(poolId: string): Promise<RidePool | null> {
    const result = await this.queryable.query(
      `
        SELECT
          p.id::text,
          p.route_id::text,
          r.name AS route_name,
          p.pin_code,
          p.workflow_channel,
          p.captain_telegram_id,
          p.status,
          p.driver_telegram_id,
          p.driver_alert_message_id,
          p.driver_group_chat_id,
          p.price_amount,
          p.price_currency,
          p.is_early_dispatch,
          p.early_dispatch_requested_at,
          p.arrival_requested_at,
          p.arrived_at,
          COALESCE(COUNT(pp.telegram_id) FILTER (WHERE pp.payment_status = 'confirmed'), 0)::int
            AS passenger_count
        FROM pools p
        JOIN routes r ON r.id = p.route_id
        LEFT JOIN pool_passengers pp ON pp.pool_id = p.id
        WHERE p.id = $1
        GROUP BY p.id, r.name
      `,
      [poolId]
    );

    return result.rows[0] ? mapPool(result.rows[0]) : null;
  }

  async getPassenger(poolId: string, telegramId: string): Promise<PoolPassenger | null> {
    const result = await this.queryable.query(
      `
        SELECT pool_id::text, telegram_id, is_captain, payment_status, early_dispatch_vote
        FROM pool_passengers
        WHERE pool_id = $1 AND telegram_id = $2
      `,
      [poolId, telegramId]
    );

    return result.rows[0] ? mapPassenger(result.rows[0]) : null;
  }

  async addPassenger(poolId: string, telegramId: string, isCaptain: boolean): Promise<PoolPassenger> {
    const result = await this.queryable.query(
      `
        INSERT INTO pool_passengers (pool_id, telegram_id, is_captain, payment_status, reservation_expires_at)
        VALUES ($1, $2, $3, 'pending', NOW() + INTERVAL '10 minutes')
        ON CONFLICT (pool_id, telegram_id)
        DO UPDATE SET
          payment_status = 'pending',
          joined_at = NOW(),
          paid_at = NULL,
          reservation_expires_at = NOW() + INTERVAL '10 minutes',
          is_captain = pool_passengers.is_captain OR EXCLUDED.is_captain
        WHERE pool_passengers.payment_status = 'cancelled'
        RETURNING pool_id::text, telegram_id, is_captain, payment_status, early_dispatch_vote
      `,
      [poolId, telegramId, isCaptain]
    );

    if (!result.rows[0]) {
      const existing = await this.getPassenger(poolId, telegramId);
      if (existing) {
        return existing;
      }
      throw new Error('Passenger could not be added to pool');
    }

    return mapPassenger(result.rows[0]);
  }

  async confirmPassenger(poolId: string, telegramId: string): Promise<PoolPassenger | null> {
    const result = await this.queryable.query(
      `
        UPDATE pool_passengers
        SET payment_status = 'confirmed',
            paid_at = NOW(),
            reservation_expires_at = NULL
        WHERE pool_id = $1
          AND telegram_id = $2
          AND payment_status = 'pending'
        RETURNING pool_id::text, telegram_id, is_captain, payment_status, early_dispatch_vote
      `,
      [poolId, telegramId]
    );

    return result.rows[0] ? mapPassenger(result.rows[0]) : null;
  }

  async removePendingPassenger(poolId: string, telegramId: string): Promise<boolean> {
    const result = await this.queryable.query(
      `
        UPDATE pool_passengers
        SET payment_status = 'cancelled'
        WHERE pool_id = $1
          AND telegram_id = $2
          AND payment_status = 'pending'
      `,
      [poolId, telegramId]
    );

    return (result.rowCount ?? 0) > 0;
  }

  async cancelPoolBeforeAssignment(poolId: string): Promise<RidePool | null> {
    const result = await this.queryable.query<{ id: string }>(
      `
        WITH cancelled_pool AS (
          UPDATE pools
          SET status = 'cancelled',
              updated_at = NOW()
          WHERE id = $1
            AND status IN ('open', 'ready')
            AND driver_telegram_id IS NULL
          RETURNING id::text
        ),
        cancelled_passengers AS (
          UPDATE pool_passengers
          SET payment_status = 'cancelled',
              is_captain = FALSE,
              reservation_expires_at = NULL
          WHERE pool_id IN (SELECT id::bigint FROM cancelled_pool)
          RETURNING pool_id
        )
        SELECT id FROM cancelled_pool
      `,
      [poolId]
    );

    if (!result.rows[0]) {
      return null;
    }

    return this.getPool(poolId);
  }

  async cancelPassengerBeforeDispatch(
    poolId: string,
    telegramId: string,
    passengerLimit: number
  ): Promise<RidePool | null> {
    const result = await this.queryable.query<{ id: string }>(
      `
        WITH cancelled AS (
          UPDATE pool_passengers pp
          SET payment_status = 'cancelled',
              is_captain = FALSE,
              reservation_expires_at = NULL
          FROM pools p
          WHERE pp.pool_id = p.id
            AND pp.pool_id = $1
            AND pp.telegram_id = $2
            AND pp.payment_status IN ('pending', 'confirmed')
            AND p.status IN ('open', 'ready')
            AND p.driver_telegram_id IS NULL
          RETURNING pp.pool_id
        ),
        remaining AS (
          SELECT
            p.id,
            COUNT(pp.telegram_id) FILTER (WHERE pp.payment_status = 'confirmed')::int AS confirmed_count,
            BOOL_OR(pp.is_captain) FILTER (WHERE pp.payment_status = 'confirmed') AS has_captain,
            (
              ARRAY_AGG(pp.telegram_id ORDER BY pp.joined_at)
              FILTER (WHERE pp.payment_status = 'confirmed')
            )[1] AS next_captain_id
          FROM pools p
          LEFT JOIN pool_passengers pp ON pp.pool_id = p.id
          WHERE p.id = $1
            AND EXISTS (SELECT 1 FROM cancelled)
          GROUP BY p.id
        ),
        promoted_captain AS (
          UPDATE pool_passengers pp
          SET is_captain = TRUE
          FROM remaining r
          WHERE pp.pool_id = r.id
            AND pp.telegram_id = r.next_captain_id
            AND r.next_captain_id IS NOT NULL
            AND NOT COALESCE(r.has_captain, FALSE)
          RETURNING pp.telegram_id
        ),
        updated_pool AS (
          UPDATE pools p
          SET status = CASE
                WHEN r.confirmed_count = 0 THEN 'cancelled'
                WHEN p.status = 'ready' AND r.confirmed_count < $3 THEN 'open'
                ELSE p.status
              END,
              captain_telegram_id = CASE
                WHEN r.confirmed_count > 0 AND NOT COALESCE(r.has_captain, FALSE) THEN r.next_captain_id
                ELSE p.captain_telegram_id
              END,
              sent_to_drivers_at = CASE
                WHEN p.status = 'ready' AND r.confirmed_count < $3 THEN NULL
                ELSE p.sent_to_drivers_at
              END,
              driver_group_chat_id = CASE
                WHEN p.status = 'ready' AND r.confirmed_count < $3 THEN NULL
                ELSE p.driver_group_chat_id
              END,
              driver_alert_message_id = CASE
                WHEN p.status = 'ready' AND r.confirmed_count < $3 THEN NULL
                ELSE p.driver_alert_message_id
              END,
              is_early_dispatch = CASE
                WHEN p.status = 'ready' AND r.confirmed_count < $3 THEN FALSE
                ELSE p.is_early_dispatch
              END,
              early_dispatch_requested_at = CASE
                WHEN p.status = 'ready' AND r.confirmed_count < $3 THEN NULL
                ELSE p.early_dispatch_requested_at
              END,
              updated_at = NOW()
          FROM remaining r
          WHERE p.id = r.id
          RETURNING p.id::text
        )
        SELECT id FROM updated_pool
      `,
      [poolId, telegramId, passengerLimit]
    );

    if (!result.rows[0]) {
      return null;
    }

    return this.getPool(poolId);
  }

  async markPoolReady(poolId: string, isEarlyDispatch = false): Promise<RidePool> {
    await this.queryable.query(
      `
        UPDATE pools
        SET status = 'ready',
            is_early_dispatch = is_early_dispatch OR $2,
            sent_to_drivers_at = COALESCE(sent_to_drivers_at, NOW()),
            updated_at = NOW()
        WHERE id = $1 AND status = 'open'
      `,
      [poolId, isEarlyDispatch]
    );

    const pool = await this.getPool(poolId);
    if (!pool) {
      throw new Error(`Pool ${poolId} could not be loaded after ready update`);
    }
    return pool;
  }

  async markDriverAlertSent(poolId: string, chatId: string, messageId: number): Promise<void> {
    await this.queryable.query(
      `
        UPDATE pools
        SET driver_group_chat_id = $2,
            driver_alert_message_id = $3,
            updated_at = NOW()
        WHERE id = $1
      `,
      [poolId, chatId, messageId]
    );
  }

  async assignDriver(poolId: string, driverTelegramId: string): Promise<RidePool | null> {
    const pool = await this.getPoolForUpdate(poolId);
    if (!pool || pool.status !== 'ready' || pool.driverTelegramId) {
      return null;
    }

    await this.queryable.query(
      `
        UPDATE pools
        SET status = 'assigned',
            driver_telegram_id = $2,
            accepted_at = NOW(),
            arrival_requested_at = NULL,
            arrived_at = NULL,
            updated_at = NOW()
        WHERE id = $1
          AND status = 'ready'
          AND driver_telegram_id IS NULL
      `,
      [poolId, driverTelegramId]
    );

    return this.getPool(poolId);
  }

  async requestDriverArrival(poolId: string): Promise<RidePool | null> {
    const result = await this.queryable.query(
      `
        UPDATE pools
        SET status = 'arrival_requested',
            arrival_requested_at = NOW(),
            updated_at = NOW()
        WHERE id = $1
          AND status = 'assigned'
          AND driver_telegram_id IS NOT NULL
        RETURNING id::text
      `,
      [poolId]
    );

    if (!result.rows[0]) {
      return null;
    }

    return this.getPool(String(result.rows[0].id));
  }

  async confirmDriverArrival(poolId: string): Promise<RidePool | null> {
    const result = await this.queryable.query(
      `
        UPDATE pools
        SET status = 'in_progress',
            arrived_at = NOW(),
            updated_at = NOW()
        WHERE id = $1
          AND status = 'arrival_requested'
          AND arrival_requested_at IS NOT NULL
        RETURNING id::text
      `,
      [poolId]
    );

    if (!result.rows[0]) {
      return null;
    }

    return this.getPool(String(result.rows[0].id));
  }

  async rejectDriverArrival(poolId: string): Promise<RidePool | null> {
    const result = await this.queryable.query(
      `
        UPDATE pools
        SET status = 'assigned',
            arrival_requested_at = NULL,
            updated_at = NOW()
        WHERE id = $1
          AND status = 'arrival_requested'
          AND arrival_requested_at IS NOT NULL
        RETURNING id::text
      `,
      [poolId]
    );

    if (!result.rows[0]) {
      return null;
    }

    return this.getPool(String(result.rows[0].id));
  }

  async getPassengerManifests(poolId: string): Promise<PassengerManifest[]> {
    const result = await this.queryable.query(
      `
        SELECT
          u.telegram_id,
          u.first_name,
          u.last_name,
          u.username,
          u.phone_number
        FROM pool_passengers pp
        JOIN telegram_users u ON u.telegram_id = pp.telegram_id
        WHERE pp.pool_id = $1 AND pp.payment_status = 'confirmed'
        ORDER BY pp.joined_at ASC
      `,
      [poolId]
    );

    return result.rows.map((row) => ({
      telegramId: row.telegram_id,
      displayName: displayName(row),
      username: row.username ?? null,
      phoneNumber: row.phone_number ?? null,
      pickupLocation: null
    }));
  }

  async getConfirmedPassengerTelegramIds(poolId: string): Promise<string[]> {
    const result = await this.queryable.query(
      `
        SELECT telegram_id
        FROM pool_passengers
        WHERE pool_id = $1 AND payment_status = 'confirmed'
        ORDER BY joined_at ASC
      `,
      [poolId]
    );

    return result.rows.map((row) => String(row.telegram_id));
  }

  async getActivePoolForPassenger(
    telegramId: string
  ): Promise<{ pool: RidePool; passenger: PoolPassenger } | null> {
    const result = await this.queryable.query(
      `
        SELECT pp.pool_id::text
        FROM pool_passengers pp
        JOIN pools p ON p.id = pp.pool_id
        WHERE pp.telegram_id = $1
          AND (
            (pp.payment_status = 'pending' AND p.status = 'open')
            OR (
              pp.payment_status = 'confirmed'
              AND p.status IN ('open', 'ready', 'assigned', 'arrival_requested', 'in_progress')
            )
          )
        ORDER BY pp.joined_at DESC
        LIMIT 1
      `,
      [telegramId]
    );

    if (!result.rows[0]) {
      return null;
    }

    const poolId = String(result.rows[0].pool_id);
    const [pool, passenger] = await Promise.all([
      this.getPool(poolId),
      this.getPassenger(poolId, telegramId)
    ]);

    if (!pool || !passenger) {
      return null;
    }

    return { pool, passenger };
  }

  async getLatestCompletedPoolForPassenger(
    telegramId: string
  ): Promise<{ pool: RidePool; passenger: PoolPassenger } | null> {
    const result = await this.queryable.query(
      `
        SELECT pp.pool_id::text
        FROM pool_passengers pp
        JOIN pools p ON p.id = pp.pool_id
        WHERE pp.telegram_id = $1
          AND pp.payment_status = 'confirmed'
          AND p.status = 'completed'
        ORDER BY p.updated_at DESC
        LIMIT 1
      `,
      [telegramId]
    );

    if (!result.rows[0]) {
      return null;
    }

    const poolId = String(result.rows[0].pool_id);
    const [pool, passenger] = await Promise.all([
      this.getPool(poolId),
      this.getPassenger(poolId, telegramId)
    ]);

    if (!pool || !passenger) {
      return null;
    }

    return { pool, passenger };
  }

  async cancelActivePassengerPool(telegramId: string): Promise<RidePool | null> {
    const result = await this.queryable.query(
      `
        UPDATE pool_passengers pp
        SET payment_status = 'cancelled'
        FROM pools p
        WHERE pp.pool_id = p.id
          AND pp.telegram_id = $1
          AND pp.payment_status IN ('pending', 'confirmed')
          AND p.status = 'open'
        RETURNING pp.pool_id::text
      `,
      [telegramId]
    );

    if (!result.rows[0]) {
      return null;
    }

    const poolId = String(result.rows[0].pool_id);
    const pool = await this.getPool(poolId);
    if (pool?.passengerCount === 0) {
      await this.queryable.query(
        `
          UPDATE pools
          SET status = 'cancelled', updated_at = NOW()
          WHERE id = $1 AND status = 'open'
        `,
        [poolId]
      );
      return this.getPool(poolId);
    }

    return pool;
  }

  async listPoolsByStatuses(statuses: PoolStatus[], limit = 10): Promise<RidePool[]> {
    const result = await this.queryable.query(
      `
        SELECT id::text
        FROM pools
        WHERE status = ANY($1::text[])
        ORDER BY created_at DESC
        LIMIT $2
      `,
      [statuses, limit]
    );

    const pools = await Promise.all(result.rows.map((row) => this.getPool(String(row.id))));
    return pools.filter((pool): pool is RidePool => Boolean(pool));
  }

  async listReadyPoolsMissingDriverAlert(limit = 20): Promise<RidePool[]> {
    const result = await this.queryable.query(
      `
        SELECT id::text
        FROM pools
        WHERE status = 'ready'
          AND driver_alert_message_id IS NULL
          AND driver_telegram_id IS NULL
          AND NOT EXISTS (
            SELECT 1
            FROM notification_outbox n
            WHERE n.message_type IN ('driver_pool_ready', 'driver_pool_reposted')
              AND n.status IN ('pending', 'sending')
              AND n.payload_json ->> 'poolId' = pools.id::text
          )
        ORDER BY sent_to_drivers_at ASC NULLS FIRST, updated_at ASC
        LIMIT $1
      `,
      [limit]
    );

    const pools = await Promise.all(result.rows.map((row) => this.getPool(String(row.id))));
    return pools.filter((pool): pool is RidePool => Boolean(pool));
  }

  async findLateAssignedPools(cutoff: Date): Promise<RidePool[]> {
    const result = await this.queryable.query(
      `
        SELECT id::text
        FROM pools
        WHERE status = 'assigned'
          AND accepted_at IS NOT NULL
          AND arrived_at IS NULL
          AND accepted_at < $1
        ORDER BY accepted_at ASC
      `,
      [cutoff]
    );

    const pools = await Promise.all(result.rows.map((row) => this.getPool(String(row.id))));
    return pools.filter((pool): pool is RidePool => Boolean(pool));
  }

  async expireDriverAssignment(poolId: string): Promise<RidePool | null> {
    const result = await this.queryable.query(
      `
        UPDATE pools
        SET status = 'ready',
            driver_telegram_id = NULL,
            accepted_at = NULL,
            driver_group_chat_id = NULL,
            driver_alert_message_id = NULL,
            arrival_requested_at = NULL,
            arrived_at = NULL,
            updated_at = NOW()
        WHERE id = $1 AND status = 'assigned'
        RETURNING id::text
      `,
      [poolId]
    );

    if (!result.rows[0]) {
      return null;
    }

    return this.getPool(String(result.rows[0].id));
  }

  async expireOpenReservations(cutoff: Date): Promise<number> {
    const result = await this.queryable.query(
      `
        UPDATE pool_passengers pp
        SET payment_status = 'cancelled'
        FROM pools p
        WHERE pp.pool_id = p.id
          AND p.status = 'open'
          AND pp.payment_status = 'pending'
          AND pp.reservation_expires_at IS NOT NULL
          AND pp.reservation_expires_at <= $1
      `,
      [cutoff]
    );

    return result.rowCount ?? 0;
  }

  async cancelEmptyStaleOpenPools(cutoff: Date): Promise<number> {
    const result = await this.queryable.query(
      `
        UPDATE pools p
        SET status = 'cancelled',
            updated_at = NOW()
        WHERE p.status = 'open'
          AND p.created_at <= $1
          AND NOT EXISTS (
            SELECT 1
            FROM pool_passengers pp
            WHERE pp.pool_id = p.id
              AND pp.payment_status IN ('pending', 'confirmed')
          )
      `,
      [cutoff]
    );

    return result.rowCount ?? 0;
  }

  async requestEarlyDispatch(poolId: string, captainTelegramId: string): Promise<void> {
    await this.queryable.query(
      `
        UPDATE pools
        SET early_dispatch_requested_at = NOW(), updated_at = NOW()
        WHERE id = $1 AND status = 'open'
      `,
      [poolId]
    );

    await this.queryable.query(
      `
        UPDATE pool_passengers
        SET early_dispatch_vote = CASE
          WHEN telegram_id = $2 THEN 'accepted'
          ELSE 'pending'
        END
        WHERE pool_id = $1 AND payment_status = 'confirmed'
      `,
      [poolId, captainTelegramId]
    );
  }

  async setEarlyDispatchVote(
    poolId: string,
    telegramId: string,
    vote: 'accepted' | 'rejected'
  ): Promise<PoolPassenger | null> {
    const result = await this.queryable.query(
      `
        UPDATE pool_passengers
        SET early_dispatch_vote = $3
        WHERE pool_id = $1
          AND telegram_id = $2
          AND payment_status = 'confirmed'
        RETURNING pool_id::text, telegram_id, is_captain, payment_status, early_dispatch_vote
      `,
      [poolId, telegramId, vote]
    );

    return result.rows[0] ? mapPassenger(result.rows[0]) : null;
  }

  async getEarlyDispatchSummary(poolId: string): Promise<{
    accepted: number;
    rejected: number;
    pending: number;
    total: number;
  }> {
    const result = await this.queryable.query(
      `
        SELECT
          COUNT(*) FILTER (WHERE early_dispatch_vote = 'accepted')::int AS accepted,
          COUNT(*) FILTER (WHERE early_dispatch_vote = 'rejected')::int AS rejected,
          COUNT(*) FILTER (WHERE early_dispatch_vote = 'pending')::int AS pending,
          COUNT(*)::int AS total
        FROM pool_passengers
        WHERE pool_id = $1 AND payment_status = 'confirmed'
      `,
      [poolId]
    );

    const row = result.rows[0];
    return {
      accepted: Number(row.accepted),
      rejected: Number(row.rejected),
      pending: Number(row.pending),
      total: Number(row.total)
    };
  }

  async clearEarlyDispatch(poolId: string): Promise<void> {
    await this.queryable.query(
      `
        UPDATE pools
        SET early_dispatch_requested_at = NULL,
            is_early_dispatch = FALSE,
            updated_at = NOW()
        WHERE id = $1 AND status = 'open'
      `,
      [poolId]
    );

    await this.queryable.query(
      `
        UPDATE pool_passengers
        SET early_dispatch_vote = 'pending'
        WHERE pool_id = $1
      `,
      [poolId]
    );
  }

  async completeAssignedPoolByPin(pinCode: string, driverTelegramId: string): Promise<RidePool | null> {
    const result = await this.queryable.query(
      `
        UPDATE pools
        SET status = 'completed', updated_at = NOW()
        WHERE pin_code = $1
          AND driver_telegram_id = $2
          AND status = 'in_progress'
        RETURNING id::text
      `,
      [pinCode, driverTelegramId]
    );

    if (!result.rows[0]) {
      return null;
    }

    return this.getPool(String(result.rows[0].id));
  }

  async upsertTelegramUser(profile: TelegramUserProfile): Promise<void> {
    await this.queryable.query(
      `
        INSERT INTO telegram_users (
          telegram_id,
          first_name,
          last_name,
          username,
          phone_number,
          location_lat,
          location_lng,
          location_label,
          role
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, COALESCE($9, 'passenger'))
        ON CONFLICT (telegram_id)
        DO UPDATE SET
          first_name = COALESCE(EXCLUDED.first_name, telegram_users.first_name),
          last_name = COALESCE(EXCLUDED.last_name, telegram_users.last_name),
          username = COALESCE(EXCLUDED.username, telegram_users.username),
          phone_number = COALESCE(EXCLUDED.phone_number, telegram_users.phone_number),
          location_lat = COALESCE(EXCLUDED.location_lat, telegram_users.location_lat),
          location_lng = COALESCE(EXCLUDED.location_lng, telegram_users.location_lng),
          location_label = COALESCE(EXCLUDED.location_label, telegram_users.location_label),
          role = CASE
            WHEN telegram_users.role = 'admin' THEN telegram_users.role
            WHEN EXCLUDED.role = 'driver' THEN 'driver'
            ELSE telegram_users.role
          END,
          updated_at = NOW()
      `,
      [
        profile.telegramId,
        profile.firstName,
        profile.lastName,
        profile.username,
        profile.phoneNumber ?? null,
        profile.locationLat ?? null,
        profile.locationLng ?? null,
        profile.locationLabel ?? null,
        profile.role ?? 'passenger'
      ]
    );
  }

  async updateUserLanguage(telegramId: string, languageCode: TelegramUserProfile['languageCode']): Promise<void> {
    await this.queryable.query(
      `
        UPDATE telegram_users
        SET language_code = $2, updated_at = NOW()
        WHERE telegram_id = $1
      `,
      [telegramId, normalizeLanguageCode(languageCode)]
    );
  }

  async markDriverBotStarted(telegramId: string): Promise<void> {
    await this.queryable.query(
      `
        INSERT INTO telegram_users (telegram_id, role, driver_bot_started_at)
        VALUES ($1, 'driver', NOW())
        ON CONFLICT (telegram_id)
        DO UPDATE SET
          driver_bot_started_at = NOW(),
          role = CASE
            WHEN telegram_users.role = 'admin' THEN telegram_users.role
            ELSE 'driver'
          END,
          updated_at = NOW()
      `,
      [telegramId]
    );
  }

  async hasDriverBotStarted(telegramId: string): Promise<boolean> {
    const result = await this.queryable.query(
      `
        SELECT EXISTS (
          SELECT 1
          FROM telegram_users
          WHERE telegram_id = $1
            AND driver_bot_started_at IS NOT NULL
        ) AS exists
      `,
      [telegramId]
    );

    return Boolean(result.rows[0]?.exists);
  }

  async updateUserContact(telegramId: string, phoneNumber: string): Promise<void> {
    await this.queryable.query(
      `
        UPDATE telegram_users
        SET phone_number = $2, updated_at = NOW()
        WHERE telegram_id = $1
      `,
      [telegramId, phoneNumber]
    );
  }

  async updateUserLocation(telegramId: string, lat: number, lng: number): Promise<void> {
    await this.queryable.query(
      `
        UPDATE telegram_users
        SET location_lat = $2,
            location_lng = $3,
            location_label = $4,
            updated_at = NOW()
        WHERE telegram_id = $1
      `,
      [telegramId, lat, lng, `${lat.toFixed(6)}, ${lng.toFixed(6)}`]
    );
  }

  async getUserProfile(telegramId: string): Promise<TelegramUserProfile | null> {
    const result = await this.queryable.query(
      `
        SELECT telegram_id, first_name, last_name, username, phone_number, language_code,
               location_lat, location_lng, location_label, role, driver_bot_started_at
        FROM telegram_users
        WHERE telegram_id = $1
      `,
      [telegramId]
    );

    if (!result.rows[0]) {
      return null;
    }

    const row = result.rows[0];
    return {
      telegramId: row.telegram_id,
      firstName: row.first_name,
      lastName: row.last_name,
      username: row.username,
      languageCode: normalizeLanguageCode(row.language_code),
      phoneNumber: row.phone_number,
      locationLat: row.location_lat,
      locationLng: row.location_lng,
      locationLabel: row.location_label,
      role: row.role,
      driverBotStartedAt: row.driver_bot_started_at ? new Date(String(row.driver_bot_started_at)) : null
    };
  }
}

function mapRoute(row: Record<string, unknown>): Route {
  return {
    id: String(row.id),
    name: String(row.name),
    isActive: Boolean(row.is_active),
    priceAmount: row.price_amount === null || row.price_amount === undefined ? null : Number(row.price_amount),
    priceCurrency: row.price_currency ? String(row.price_currency) : 'ETB'
  };
}

function mapPool(row: Record<string, unknown>): RidePool {
  return {
    id: String(row.id),
    routeId: String(row.route_id),
    routeName: String(row.route_name),
    workflowChannel: row.workflow_channel === 'mini_app' ? 'mini_app' : 'telegram',
    pinCode: String(row.pin_code),
    captainTelegramId: String(row.captain_telegram_id),
    status: row.status as RidePool['status'],
    passengerCount: Number(row.passenger_count ?? 0),
    driverTelegramId: row.driver_telegram_id ? String(row.driver_telegram_id) : null,
    driverAlertMessageId:
      row.driver_alert_message_id === null || row.driver_alert_message_id === undefined
        ? null
        : Number(row.driver_alert_message_id),
    driverGroupChatId: row.driver_group_chat_id ? String(row.driver_group_chat_id) : null,
    isEarlyDispatch: Boolean(row.is_early_dispatch),
    earlyDispatchRequestedAt: row.early_dispatch_requested_at
      ? new Date(String(row.early_dispatch_requested_at))
      : null,
    arrivalRequestedAt: row.arrival_requested_at ? new Date(String(row.arrival_requested_at)) : null,
    arrivedAt: row.arrived_at ? new Date(String(row.arrived_at)) : null,
    priceAmount: row.price_amount === null || row.price_amount === undefined ? null : Number(row.price_amount),
    priceCurrency: row.price_currency ? String(row.price_currency) : 'ETB'
  };
}

function mapAdminPoolSummary(row: Record<string, unknown>): AdminPoolSummary {
  return {
    ...mapPool(row),
    pendingPassengerCount: Number(row.pending_passenger_count ?? 0),
    cancelledPassengerCount: Number(row.cancelled_passenger_count ?? 0),
    captain: mapPrefixedUser(row, 'captain_user'),
    driver: mapPrefixedUser(row, 'driver_user'),
    sentToDriversAt: row.sent_to_drivers_at ? new Date(String(row.sent_to_drivers_at)) : null,
    acceptedAt: row.accepted_at ? new Date(String(row.accepted_at)) : null,
    createdAt: row.created_at ? new Date(String(row.created_at)) : new Date(0),
    updatedAt: row.updated_at ? new Date(String(row.updated_at)) : new Date(0)
  };
}

function mapPassenger(row: Record<string, unknown>): PoolPassenger {
  return {
    poolId: String(row.pool_id),
    telegramId: String(row.telegram_id),
    isCaptain: Boolean(row.is_captain),
    paymentStatus: row.payment_status as PoolPassenger['paymentStatus'],
    earlyDispatchVote: row.early_dispatch_vote as PoolPassenger['earlyDispatchVote']
  };
}

function mapQueuedNotification(row: Record<string, unknown>): QueuedNotification {
  return {
    id: String(row.id),
    targetBot: row.target_bot as QueuedNotification['targetBot'],
    chatId: String(row.chat_id),
    messageType: String(row.message_type),
    payload: (row.payload_json ?? {}) as Record<string, unknown>,
    attemptCount: Number(row.attempt_count ?? 0)
  };
}

function mapPendingPassengerAction(row: Record<string, unknown>): PendingPassengerAction {
  return {
    telegramId: String(row.telegram_id),
    actionType: row.action_type as PendingPassengerAction['actionType'],
    routeId: row.route_id ? String(row.route_id) : null,
    poolId: row.pool_id ? String(row.pool_id) : null,
    createdAt: row.created_at ? new Date(String(row.created_at)) : undefined,
    expiresAt: row.expires_at ? new Date(String(row.expires_at)) : undefined
  };
}

function mapAdminPassengerManifest(row: Record<string, unknown>): AdminPassengerManifest {
  return {
    telegramId: String(row.telegram_id),
    displayName: displayName(row),
    username: row.username ? String(row.username) : null,
    phoneNumber: row.phone_number ? String(row.phone_number) : null,
    pickupLocation: null,
    isCaptain: Boolean(row.is_captain),
    paymentStatus: row.payment_status as AdminPassengerManifest['paymentStatus'],
    earlyDispatchVote: row.early_dispatch_vote as AdminPassengerManifest['earlyDispatchVote'],
    joinedAt: row.joined_at ? new Date(String(row.joined_at)) : new Date(0),
    paidAt: row.paid_at ? new Date(String(row.paid_at)) : null
  };
}

function mapPrefixedUser(row: Record<string, unknown>, prefix: string): TelegramUserProfile | null {
  const telegramId = row[`${prefix}_telegram_id`];
  if (!telegramId) {
    return null;
  }

  return {
    telegramId: String(telegramId),
    firstName: row[`${prefix}_first_name`] ? String(row[`${prefix}_first_name`]) : null,
    lastName: row[`${prefix}_last_name`] ? String(row[`${prefix}_last_name`]) : null,
    username: row[`${prefix}_username`] ? String(row[`${prefix}_username`]) : null,
    languageCode: normalizeLanguageCode(row[`${prefix}_language_code`]),
    phoneNumber: row[`${prefix}_phone_number`] ? String(row[`${prefix}_phone_number`]) : null,
    role: row[`${prefix}_role`] as TelegramUserProfile['role']
  };
}

function displayName(row: Record<string, unknown>): string {
  const firstName = typeof row.first_name === 'string' ? row.first_name : '';
  const lastName = typeof row.last_name === 'string' ? row.last_name : '';
  const fullName = `${firstName} ${lastName}`.trim();

  if (fullName) {
    return fullName;
  }

  if (row.username) {
    return `@${String(row.username)}`;
  }

  return `Telegram ${String(row.telegram_id)}`;
}

function formatLocation(row: Record<string, unknown>): string | null {
  if (row.location_label) {
    return String(row.location_label);
  }

  if (row.location_lat !== null && row.location_lng !== null) {
    return `${Number(row.location_lat).toFixed(6)}, ${Number(row.location_lng).toFixed(6)}`;
  }

  return null;
}
