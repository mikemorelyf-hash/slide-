import {
  Activity,
  CarFront,
  CircleAlert,
  Clock3,
  CreditCard,
  RefreshCw,
  Route as RouteIcon,
  Save,
  ShieldCheck,
  UsersRound
} from 'lucide-react';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

import {
  cancelAdminPool,
  getAdminOverview,
  getAdminPoolDetail,
  getReadiness,
  repostAdminDriverAlert,
  retryFailedNotifications,
  updateAdminRoutePrice
} from './api';
import { adminArrivalStateLabel, adminStatusLabel, formatAdminDate } from './adminState';
import { formatPassengerName, formatPrice, resolveMiniAppError } from './appState';
import { getTelegramInitData, notifyError, notifySuccess, prepareTelegramShell } from './telegram';
import type {
  AdminOverview,
  AdminPoolDetail,
  AdminPoolSummary,
  PoolStatus,
  ReadinessReport,
  Route
} from './types';

type AdminBusyAction = 'refresh' | 'pool' | 'price' | 'repost' | 'cancel' | 'retry' | null;
type AdminStatusFilter = 'active' | PoolStatus;
const SIDE_LOGO_SRC = '/side-logo.png';

const statusFilters: Array<{ value: AdminStatusFilter; label: string }> = [
  { value: 'active', label: 'Active' },
  { value: 'open', label: 'Open' },
  { value: 'ready', label: 'Waiting Driver' },
  { value: 'assigned', label: 'Assigned' },
  { value: 'arrival_requested', label: 'Arrival' },
  { value: 'in_progress', label: 'In Trip' },
  { value: 'completed', label: 'Completed' }
];

export default function AdminApp() {
  const [initData] = useState(() => getTelegramInitData());
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [readiness, setReadiness] = useState<ReadinessReport | null>(null);
  const [selectedPoolId, setSelectedPoolId] = useState<string | null>(null);
  const [poolDetail, setPoolDetail] = useState<AdminPoolDetail | null>(null);
  const [priceDrafts, setPriceDrafts] = useState<Record<string, { amount: string; currency: string }>>({});
  const [statusFilter, setStatusFilter] = useState<AdminStatusFilter>('active');
  const [busy, setBusy] = useState<AdminBusyAction>('refresh');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    prepareTelegramShell();
  }, []);

  useEffect(() => {
    if (!initData) {
      setBusy(null);
      return;
    }

    void refreshOverview();
    const interval = window.setInterval(() => {
      void refreshOverview(false);
    }, 15_000);

    return () => window.clearInterval(interval);
  }, [initData]);

  useEffect(() => {
    if (!overview) {
      return;
    }

    setPriceDrafts((current) => {
      const next = { ...current };
      for (const route of overview.routes) {
        next[route.id] = {
          amount: route.priceAmount === null ? '' : String(route.priceAmount),
          currency: route.priceCurrency
        };
      }
      return next;
    });
  }, [overview]);

  const pools = useMemo(() => {
    if (!overview) {
      return [];
    }

    if (statusFilter === 'active') {
      return overview.pools.filter((pool) =>
        ['open', 'ready', 'assigned', 'arrival_requested', 'in_progress'].includes(pool.status)
      );
    }

    return overview.pools.filter((pool) => pool.status === statusFilter);
  }, [overview, statusFilter]);

  async function refreshOverview(showSpinner = true) {
    await runAction(showSpinner ? 'refresh' : null, async () => {
      const [nextOverview, nextReadiness] = await Promise.all([
        getAdminOverview(initData),
        getReadiness()
      ]);
      setOverview(nextOverview);
      setReadiness(nextReadiness);
      if (selectedPoolId) {
        setPoolDetail(await getAdminPoolDetail(initData, selectedPoolId));
      }
    });
  }

  async function selectPool(poolId: string) {
    setSelectedPoolId(poolId);
    await runAction('pool', async () => {
      setPoolDetail(await getAdminPoolDetail(initData, poolId));
    });
  }

  async function saveRoutePrice(event: FormEvent<HTMLFormElement>, route: Route) {
    event.preventDefault();
    const draft = priceDrafts[route.id] ?? { amount: '', currency: route.priceCurrency };
    const amount = Number(draft.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setError('Enter a valid route price.');
      notifyError();
      return;
    }

    await runAction('price', async () => {
      await updateAdminRoutePrice(initData, route.id, amount, draft.currency || 'ETB');
      const nextOverview = await getAdminOverview(initData);
      setOverview(nextOverview);
    });
  }

  async function repostDriverAlert(poolId: string) {
    await runAction('repost', async () => {
      await repostAdminDriverAlert(initData, poolId);
      await refreshOverview(false);
      setPoolDetail(await getAdminPoolDetail(initData, poolId));
    });
  }

  async function cancelPool(poolId: string) {
    await runAction('cancel', async () => {
      await cancelAdminPool(initData, poolId);
      await refreshOverview(false);
      setPoolDetail(await getAdminPoolDetail(initData, poolId));
    });
  }

  async function retryNotifications() {
    await runAction('retry', async () => {
      await retryFailedNotifications(initData);
      await refreshOverview(false);
    });
  }

  async function runAction(action: AdminBusyAction, work: () => Promise<void>) {
    if (action) {
      setBusy(action);
    }
    setError(null);

    try {
      await work();
      if (action) {
        notifySuccess();
      }
    } catch (caught) {
      setError(resolveAdminError(caught));
      notifyError();
    } finally {
      if (action) {
        setBusy(null);
      }
    }
  }

  function updatePriceDraft(routeId: string, value: Partial<{ amount: string; currency: string }>) {
    setPriceDrafts((current) => ({
      ...current,
      [routeId]: {
        amount: current[routeId]?.amount ?? '',
        currency: current[routeId]?.currency ?? 'ETB',
        ...value
      }
    }));
  }

  if (!initData) {
    return <AdminAuthRequired />;
  }

  return (
    <main className="admin-shell admin-brand-shell">
      <header className="admin-topbar admin-brand-topbar">
        <div className="admin-brand-title">
          <img src={SIDE_LOGO_SRC} alt="Side" />
          <span>
            <p className="eyebrow">Admin Dashboard</p>
            <h1>Operations</h1>
          </span>
        </div>
        <div className="admin-topbar-actions">
          <span className="admin-live-pill">
            <Activity size={14} />
            Live
          </span>
          <button
            className="icon-button admin-refresh-button"
            type="button"
            title="Refresh"
            aria-label="Refresh"
            onClick={() => refreshOverview()}
            disabled={busy === 'refresh'}
          >
            <RefreshCw size={19} />
          </button>
        </div>
      </header>

      {error ? <AdminAlert message={error} /> : null}
      {busy === 'refresh' && !overview ? <AdminLoading /> : null}

      {overview ? (
        <>
          <section className="admin-metrics" aria-label="Dashboard metrics">
            <AdminMetric icon={<UsersRound size={18} />} label="Active Pools" value={overview.metrics.activePools} />
            <AdminMetric icon={<RouteIcon size={18} />} label="Open Pools" value={overview.metrics.openPools} />
            <AdminMetric icon={<CarFront size={18} />} label="Waiting Driver" value={overview.metrics.waitingDriverPools} />
            <AdminMetric icon={<Clock3 size={18} />} label="Arrival Pending" value={overview.metrics.arrivalPendingPools} />
            <AdminMetric icon={<ShieldCheck size={18} />} label="In Trip" value={overview.metrics.inProgressTrips} />
            <AdminMetric icon={<CreditCard size={18} />} label="Completed Today" value={overview.metrics.completedToday} />
          </section>

          <section className="admin-section admin-stability">
            <div className="admin-section-header">
              <div>
                <p className="section-label">Stability</p>
                <h2>System Health</h2>
              </div>
              <CircleAlert size={21} />
            </div>
            <div className="admin-stability-grid">
              <AdminMetric icon={<Clock3 size={18} />} label="Pending Sends" value={overview.stability.pendingNotifications} />
              <AdminMetric icon={<CircleAlert size={18} />} label="Failed Sends" value={overview.stability.failedNotifications} />
              <AdminMetric icon={<ShieldCheck size={18} />} label="Stuck Pools" value={overview.stability.stuckPools.length} />
            </div>
            {readiness ? (
              <div className={`admin-readiness admin-readiness-${readiness.status}`}>
                <strong>Readiness: {readiness.status}</strong>
                <span>{readiness.checks.database.message}</span>
                <span>{readiness.checks.telegram.message}</span>
                <span>{readiness.checks.miniApp.message}</span>
              </div>
            ) : null}
            {overview.stability.failedNotifications > 0 ? (
              <button
                className="admin-action-button"
                type="button"
                onClick={() => retryNotifications()}
                disabled={busy === 'retry'}
              >
                Retry Failed Sends
              </button>
            ) : null}
            {overview.stability.stuckPools.length ? (
              <div className="admin-stuck-list">
                {overview.stability.stuckPools.map((item) => (
                  <button className="admin-stuck-row" key={`${item.poolId}-${item.reason}`} onClick={() => selectPool(item.poolId)}>
                    <strong>{item.routeName}</strong>
                    <span>{item.reason}</span>
                  </button>
                ))}
              </div>
            ) : (
              <p className="admin-empty compact">No stuck workflows detected.</p>
            )}
          </section>

          <div className="admin-layout">
            <section className="admin-section admin-routes">
              <div className="admin-section-header">
                <div>
                  <p className="section-label">Routes</p>
                  <h2>Route Prices</h2>
                </div>
                <RouteIcon size={21} />
              </div>
              <div className="admin-route-list">
                {overview.routes.map((route) => {
                  const draft = priceDrafts[route.id] ?? { amount: '', currency: route.priceCurrency };
                  return (
                    <form className="admin-route-row" key={route.id} onSubmit={(event) => saveRoutePrice(event, route)}>
                      <div>
                        <strong>{route.name}</strong>
                        <span>{formatPrice(route)}</span>
                      </div>
                      <input
                        aria-label={`${route.name} price`}
                        inputMode="decimal"
                        value={draft.amount}
                        onChange={(event) => updatePriceDraft(route.id, { amount: event.target.value })}
                        placeholder="Price"
                      />
                      <input
                        aria-label={`${route.name} currency`}
                        value={draft.currency}
                        onChange={(event) => updatePriceDraft(route.id, { currency: event.target.value.toUpperCase() })}
                        maxLength={8}
                      />
                      <button className="icon-button dark" type="submit" title="Save price" aria-label="Save price">
                        <Save size={17} />
                      </button>
                    </form>
                  );
                })}
              </div>
            </section>

            <section className="admin-section admin-pools">
              <div className="admin-section-header">
                <div>
                  <p className="section-label">Pools</p>
                  <h2>Live Workflow</h2>
                </div>
                <UsersRound size={21} />
              </div>
              <div className="admin-filter-row" role="tablist" aria-label="Pool status filters">
                {statusFilters.map((filter) => (
                  <button
                    className={filter.value === statusFilter ? 'admin-filter active' : 'admin-filter'}
                    type="button"
                    key={filter.value}
                    onClick={() => setStatusFilter(filter.value)}
                  >
                    {filter.label}
                  </button>
                ))}
              </div>

              <PoolTable pools={pools} selectedPoolId={selectedPoolId} onSelect={selectPool} />
            </section>
          </div>

          <PoolDetailPanel
            detail={poolDetail}
            busy={busy === 'pool'}
            actionBusy={busy}
            onRepostDriverAlert={repostDriverAlert}
            onCancelPool={cancelPool}
          />
        </>
      ) : null}
    </main>
  );
}

function PoolTable({
  pools,
  selectedPoolId,
  onSelect
}: {
  pools: AdminPoolSummary[];
  selectedPoolId: string | null;
  onSelect: (poolId: string) => void;
}) {
  if (!pools.length) {
    return <p className="admin-empty">No pools found.</p>;
  }

  return (
    <div className="admin-table-wrap">
      <table className="admin-table">
        <thead>
          <tr>
            <th>Route</th>
            <th>Status</th>
            <th>Passengers</th>
            <th>Driver</th>
            <th>PIN</th>
            <th>Arrival</th>
          </tr>
        </thead>
        <tbody>
          {pools.map((pool) => (
            <tr
              className={pool.id === selectedPoolId ? 'selected' : undefined}
              key={pool.id}
              onClick={() => onSelect(pool.id)}
            >
              <td>
                <strong>{pool.routeName}</strong>
                <span>{formatAdminDate(pool.createdAt)}</span>
              </td>
              <td>
                <StatusBadge status={pool.status} />
                <span className="admin-subtag">{workflowChannelLabel(pool.workflowChannel)}</span>
                {pool.isEarlyDispatch ? <span className="admin-subtag">Early</span> : null}
              </td>
              <td>
                <strong>{pool.passengerCount}</strong>
                <span>{pool.pendingPassengerCount} pending</span>
              </td>
              <td>{formatPassengerName(pool.driver)}</td>
              <td>{pool.pinCode}</td>
              <td>{adminArrivalStateLabel(pool.arrivalRequestedAt, pool.arrivedAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PoolDetailPanel({
  detail,
  busy,
  actionBusy,
  onRepostDriverAlert,
  onCancelPool
}: {
  detail: AdminPoolDetail | null;
  busy: boolean;
  actionBusy: AdminBusyAction;
  onRepostDriverAlert: (poolId: string) => void;
  onCancelPool: (poolId: string) => void;
}) {
  if (busy) {
    return (
      <section className="admin-section admin-detail">
        <p className="admin-empty">Loading pool details.</p>
      </section>
    );
  }

  if (!detail) {
    return (
      <section className="admin-section admin-detail">
        <p className="admin-empty">Select a pool to inspect passengers and driver state.</p>
      </section>
    );
  }

  const { pool, passengers } = detail;
  const canRepostDriverAlert = pool.status === 'ready' && !pool.driverTelegramId;
  const canCancelPool = ['open', 'ready'].includes(pool.status) && !pool.driverTelegramId;

  return (
    <section className="admin-section admin-detail">
      <div className="admin-section-header">
        <div>
          <p className="section-label">Pool Detail</p>
          <h2>{pool.routeName}</h2>
        </div>
        <StatusBadge status={pool.status} />
      </div>

      <div className="admin-detail-grid">
        <DetailItem label="PIN" value={pool.pinCode} />
        <DetailItem label="Mode" value={workflowChannelLabel(pool.workflowChannel)} />
        <DetailItem label="Captain" value={formatPassengerName(pool.captain)} />
        <DetailItem label="Driver" value={formatPassengerName(pool.driver)} />
        <DetailItem label="Sent to Drivers" value={formatAdminDate(pool.sentToDriversAt)} />
        <DetailItem label="Accepted" value={formatAdminDate(pool.acceptedAt)} />
        <DetailItem label="Arrival Requested" value={formatAdminDate(pool.arrivalRequestedAt)} />
        <DetailItem label="Arrived" value={formatAdminDate(pool.arrivedAt)} />
      </div>

      {(canRepostDriverAlert || canCancelPool) ? (
        <div className="admin-action-row">
          {canRepostDriverAlert ? (
            <button
              className="admin-action-button"
              type="button"
              onClick={() => onRepostDriverAlert(pool.id)}
              disabled={actionBusy === 'repost'}
            >
              Repost Driver Alert
            </button>
          ) : null}
          {canCancelPool ? (
            <button
              className="admin-action-button danger"
              type="button"
              onClick={() => onCancelPool(pool.id)}
              disabled={actionBusy === 'cancel'}
            >
              Cancel Pool
            </button>
          ) : null}
        </div>
      ) : null}

      <div className="admin-passenger-list">
        <div className="admin-passenger-list-title">
          <h3>Passengers</h3>
          <span>{passengers.length} total</span>
        </div>
        {passengers.map((passenger) => (
          <div className="admin-passenger-row" key={passenger.telegramId}>
            <div>
              <strong>
                {passenger.displayName}
                {passenger.isCaptain ? ' - Captain' : ''}
              </strong>
              <span>{passenger.username ? `@${passenger.username}` : `Telegram ${passenger.telegramId}`}</span>
            </div>
            <div>
              <strong>{passenger.phoneNumber ?? 'No phone'}</strong>
              <span className={`admin-payment-status admin-payment-status-${passenger.paymentStatus}`}>
                {passenger.paymentStatus}
              </span>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function AdminMetric({ icon, label, value }: { icon: ReactNode; label: string; value: number }) {
  return (
    <div className="admin-metric">
      <span className="admin-metric-icon">{icon}</span>
      <span className="admin-metric-label">{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function DetailItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="admin-detail-item">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function StatusBadge({ status }: { status: PoolStatus }) {
  return <span className={`admin-status admin-status-${status}`}>{adminStatusLabel(status)}</span>;
}

function workflowChannelLabel(channel: AdminPoolSummary['workflowChannel']): string {
  return channel === 'mini_app' ? 'Mini App' : 'Telegram';
}

function AdminAlert({ message }: { message: string }) {
  return (
    <div className="inline-alert admin-alert">
      <CircleAlert size={18} />
      <span>{message}</span>
    </div>
  );
}

function AdminLoading() {
  return (
    <section className="admin-section admin-loading">
      <RefreshCw size={20} />
      <span>Loading operations</span>
    </section>
  );
}

function AdminAuthRequired() {
  return (
    <main className="admin-shell admin-brand-shell admin-auth-shell">
      <section className="admin-section">
        <div className="admin-section-header">
          <div>
            <p className="section-label">Telegram Required</p>
            <h1>Open Admin from Telegram</h1>
          </div>
          <ShieldCheck size={24} />
        </div>
      </section>
    </main>
  );
}

function resolveAdminError(error: unknown): string {
  return resolveMiniAppError(error, 'admin');
}
