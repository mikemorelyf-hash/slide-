import { describe, expect, it } from 'vitest';

import { buildReadinessReport } from '../src/http/readiness.js';

describe('readiness report', () => {
  it('marks the service ready when database, queue, and workflow checks are healthy', () => {
    const report = buildReadinessReport({
      databaseOk: true,
      botMode: 'webhook',
      baseUrl: 'https://ride-pool.up.railway.app',
      miniAppUrl: 'https://ride-pool.vercel.app',
      driverBotConfigured: true,
      pendingNotifications: 2,
      sendingNotifications: 0,
      failedNotifications: 0,
      stuckPools: []
    });

    expect(report.ok).toBe(true);
    expect(report.status).toBe('ready');
    expect(report.checks.database.status).toBe('ok');
    expect(report.checks.notifications.status).toBe('ok');
    expect(report.checks.telegram.status).toBe('ok');
    expect(report.checks.miniApp.status).toBe('ok');
  });

  it('marks the service degraded when failed notifications or stuck pools exist', () => {
    const report = buildReadinessReport({
      databaseOk: true,
      botMode: 'webhook',
      baseUrl: 'https://ride-pool.up.railway.app',
      miniAppUrl: null,
      driverBotConfigured: false,
      pendingNotifications: 0,
      sendingNotifications: 0,
      failedNotifications: 3,
      stuckPools: [
        {
          poolId: '9',
          routeName: 'Mexico -> CMC',
          status: 'ready',
          reason: 'Pool is ready but the driver alert has not been sent yet.'
        }
      ]
    });

    expect(report.ok).toBe(true);
    expect(report.status).toBe('degraded');
    expect(report.checks.notifications.status).toBe('warning');
    expect(report.checks.workflows.status).toBe('warning');
    expect(report.checks.miniApp.status).toBe('warning');
  });

  it('marks the service unready when the database check fails', () => {
    const report = buildReadinessReport({
      databaseOk: false,
      botMode: 'webhook',
      baseUrl: 'https://ride-pool.up.railway.app',
      miniAppUrl: 'https://ride-pool.vercel.app',
      driverBotConfigured: true,
      pendingNotifications: 0,
      sendingNotifications: 0,
      failedNotifications: 0,
      stuckPools: []
    });

    expect(report.ok).toBe(false);
    expect(report.status).toBe('unready');
    expect(report.checks.database.status).toBe('error');
  });
});
