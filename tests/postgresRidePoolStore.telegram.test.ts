import { describe, expect, it, vi } from 'vitest';

import { PostgresRidePoolStore } from '../src/db/postgresRidePoolStore.js';
import { runMigrations } from '../src/db/migrate.js';

describe('Postgres Telegram reliability storage', () => {
  it('stores and checks whether a driver started the driver bot', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ exists: true }], rowCount: 1 });
    const store = new PostgresRidePoolStore({ query });

    await store.markDriverBotStarted('driver-1');
    await expect(store.hasDriverBotStarted('driver-1')).resolves.toBe(true);

    expect(query).toHaveBeenNthCalledWith(1, expect.stringContaining('driver_bot_started_at = NOW()'), [
      'driver-1'
    ]);
    expect(query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('driver_bot_started_at IS NOT NULL'),
      ['driver-1']
    );
  });

  it('only reclaims sending notifications after they are stale', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const store = new PostgresRidePoolStore({ query });

    await store.claimPendingNotifications(10);

    const sql = String(query.mock.calls[0][0]);
    expect(sql).toContain("status = 'pending'");
    expect(sql).toContain("status = 'sending'");
    expect(sql).toContain("updated_at <= NOW() - INTERVAL '2 minutes'");
  });

  it('adds persistence columns needed by Telegram reliability guards', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });

    await runMigrations({ query } as never);

    const migrationSql = query.mock.calls.map(([sql]) => String(sql)).join('\n');
    expect(migrationSql).toContain('driver_bot_started_at TIMESTAMPTZ');
    expect(migrationSql).toContain('ADD COLUMN IF NOT EXISTS driver_bot_started_at TIMESTAMPTZ');
    expect(migrationSql).toContain('ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()');
    expect(migrationSql).toContain('CREATE TABLE IF NOT EXISTS pending_passenger_actions');
    expect(migrationSql).toContain('pending_passenger_actions_expires_idx');
    expect(migrationSql).toContain('workflow_channel TEXT NOT NULL DEFAULT');
    expect(migrationSql).toContain("CHECK (workflow_channel IN ('telegram', 'mini_app'))");
    expect(migrationSql).toContain('pools_route_status_workflow_idx');
    expect(migrationSql.indexOf('ADD COLUMN IF NOT EXISTS workflow_channel')).toBeLessThan(
      migrationSql.indexOf('pools_route_status_workflow_idx')
    );
  });

  it('filters open pool discovery by workflow channel', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });
    const store = new PostgresRidePoolStore({ query });

    await store.findOpenPoolByRoute('1', 4, 'mini_app');

    expect(String(query.mock.calls[0][0])).toContain('p.workflow_channel = $3');
    expect(query.mock.calls[0][1]).toEqual(['1', 4, 'mini_app']);
  });

  it('lets failed or expired idempotency keys be retried', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [], rowCount: 1 });
    const store = new PostgresRidePoolStore({ query });

    await store.createIdempotencyProcessing({
      key: 'mini-app:111:passenger-pools:abc',
      source: 'mini_app',
      actorTelegramId: '111',
      requestHash: 'hash-1',
      expiresAt: new Date('2026-05-02T05:00:00.000Z')
    });

    const sql = String(query.mock.calls[0][0]);
    expect(sql).toContain('ON CONFLICT (key)');
    expect(sql).toContain("idempotency_keys.status = 'failed'");
    expect(sql).toContain('idempotency_keys.expires_at <= NOW()');
  });

  it('persists and clears pending passenger create/join actions', async () => {
    const expiresAt = new Date('2026-05-02T04:30:00.000Z');
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({
        rows: [
          {
            telegram_id: '111',
            action_type: 'create_pool',
            route_id: 'route-1',
            pool_id: null,
            created_at: '2026-05-02T04:00:00.000Z',
            expires_at: expiresAt.toISOString()
          }
        ],
        rowCount: 1
      })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });
    const store = new PostgresRidePoolStore({ query });

    await store.savePendingPassengerAction({
      telegramId: '111',
      actionType: 'create_pool',
      routeId: 'route-1',
      poolId: null,
      expiresAt
    });
    const pending = await store.getPendingPassengerAction('111');
    await store.clearPendingPassengerAction('111');

    expect(pending).toMatchObject({
      telegramId: '111',
      actionType: 'create_pool',
      routeId: 'route-1',
      poolId: null
    });
    expect(String(query.mock.calls[0][0])).toContain('INSERT INTO pending_passenger_actions');
    expect(String(query.mock.calls[1][0])).toContain('expires_at <= NOW()');
    expect(String(query.mock.calls[3][0])).toContain('DELETE FROM pending_passenger_actions');
  });
});
