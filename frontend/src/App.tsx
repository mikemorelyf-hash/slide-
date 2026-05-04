import {
  ArrowLeft,
  CarFront,
  Check,
  CheckCircle2,
  CircleAlert,
  Copy,
  CreditCard,
  Home,
  MapPin,
  MessageCircle,
  MoreHorizontal,
  Phone,
  Plus,
  RefreshCw,
  Route as RouteIcon,
  ShieldCheck,
  UserRound,
  UsersRound,
  WalletCards,
  Zap
} from 'lucide-react';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

import AdminApp from './AdminApp';
import {
  cancelPool,
  confirmArrival,
  confirmPayment,
  getPassengerState,
  getRoutePools,
  joinSelectedPool,
  rejectArrival,
  requestEarlyDispatch,
  savePhone,
  startNewPool
} from './api';
import { copyTextToClipboard } from './clipboard';
import {
  formatPassengerName,
  formatPoolSeatLabel,
  formatPrice,
  isRouteBookable,
  isLockedToTelegramWorkflow,
  passengerHasPhone,
  poolOccupancyLabel,
  resolveMiniAppError,
  shouldClearRoutePoolsAfterStateRefresh,
  shouldShowCompletedTrip
} from './appState';
import { getTelegramInitData, notifyError, notifySuccess, prepareTelegramShell } from './telegram';
import type {
  PassengerAvailablePool,
  PassengerPoolView,
  PassengerState,
  PoolPassengerContact,
  Route,
  RoutePoolsResponse
} from './types';

type BusyAction =
  | 'refresh'
  | 'phone'
  | 'pools'
  | 'join'
  | 'start'
  | 'pay'
  | 'cancel'
  | 'early'
  | 'confirm_arrival'
  | 'reject_arrival'
  | null;

const SIDE_LOGO_SRC = '/side-logo.png';
const DISMISSED_COMPLETED_POOL_STORAGE_KEY = 'side.dismissedCompletedPoolId';

export default function App() {
  const isAdminPath = typeof window !== 'undefined' && window.location.pathname.startsWith('/admin');
  return isAdminPath ? <AdminApp /> : <PassengerApp />;
}

function PassengerApp() {
  const [initData] = useState(() => getTelegramInitData());
  const [state, setState] = useState<PassengerState | null>(null);
  const [routePools, setRoutePools] = useState<RoutePoolsResponse | null>(null);
  const [showIntro, setShowIntro] = useState(true);
  const [dismissedCompletedPoolId, setDismissedCompletedPoolId] = useState(() =>
    typeof window === 'undefined' ? null : window.localStorage.getItem(DISMISSED_COMPLETED_POOL_STORAGE_KEY)
  );
  const [busy, setBusy] = useState<BusyAction>('refresh');
  const [error, setError] = useState<string | null>(null);
  const [phoneNumber, setPhoneNumber] = useState('');
  const activePool = state?.activePool ?? null;
  const completedPool = state?.lastCompletedPool ?? null;
  const showCompletedTrip = shouldShowCompletedTrip(completedPool, dismissedCompletedPoolId);
  const hasPhone = passengerHasPhone(state?.user ?? null);
  const lockedToTelegram = isLockedToTelegramWorkflow(activePool);

  useEffect(() => {
    prepareTelegramShell();
  }, []);

  useEffect(() => {
    if (!initData) {
      setBusy(null);
      return;
    }

    void refreshState();
    const interval = window.setInterval(() => {
      void refreshState(false);
    }, 10_000);

    return () => window.clearInterval(interval);
  }, [initData, dismissedCompletedPoolId]);

  useEffect(() => {
    if (state?.user?.phoneNumber) {
      setPhoneNumber(state.user.phoneNumber);
    }
  }, [state?.user?.phoneNumber]);

  useEffect(() => {
    if (!initData || !routePools || activePool || showCompletedTrip) {
      return;
    }

    const routeId = routePools.route.id;
    const interval = window.setInterval(() => {
      void refreshRoutePools(routeId, false);
    }, 5_000);

    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') {
        void refreshRoutePools(routeId, false);
      }
    };

    document.addEventListener('visibilitychange', refreshWhenVisible);

    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
    };
  }, [initData, routePools?.route.id, activePool, showCompletedTrip]);

  async function refreshState(showSpinner = true) {
    await runAction(showSpinner ? 'refresh' : null, async () => {
      const nextState = await getPassengerState(initData);
      setState(nextState);
      if (shouldClearRoutePoolsAfterStateRefresh(nextState, dismissedCompletedPoolId)) {
        setRoutePools(null);
      }
    });
  }

  async function loadRoutePools(routeId: string) {
    await refreshRoutePools(routeId, true);
  }

  async function refreshRoutePools(routeId: string, showSpinner = true) {
    await runAction(showSpinner ? 'pools' : null, async () => {
      setRoutePools(await getRoutePools(initData, routeId));
    });
  }

  async function joinPool(poolId: string) {
    await runAction('join', async () => {
      const nextState = await joinSelectedPool(initData, poolId);
      setState(nextState);
      setRoutePools(null);
    });
  }

  async function createPool(routeId: string) {
    await runAction('start', async () => {
      const nextState = await startNewPool(initData, routeId);
      setState(nextState);
      setRoutePools(null);
    });
  }

  async function runAction(action: BusyAction, work: () => Promise<void>) {
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
      setError(resolveMiniAppError(caught));
      notifyError();
    } finally {
      if (action) {
        setBusy(null);
      }
    }
  }

  async function runStateAction(action: BusyAction, work: () => Promise<PassengerState>) {
    await runAction(action, async () => {
      setState(await work());
    });
  }

  async function submitPhone(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedPhone = phoneNumber.trim();
    if (!trimmedPhone) {
      setError('Phone number is required.');
      return;
    }

    await runStateAction('phone', () => savePhone(initData, trimmedPhone));
  }

  function dismissCompletedTrip(poolId: string) {
    setDismissedCompletedPoolId(poolId);
    window.localStorage.setItem(DISMISSED_COMPLETED_POOL_STORAGE_KEY, poolId);
  }

  if (!initData) {
    return <AuthRequired />;
  }

  if (showIntro) {
    return <IntroScreen onStart={() => setShowIntro(false)} />;
  }

  return (
    <main className="app-shell side-app-shell">
      {error ? <InlineAlert message={error} /> : null}
      {busy === 'refresh' && !state ? <LoadingState /> : null}

      {state ? (
        <>
          {!activePool && showCompletedTrip && completedPool ? (
            <CompletedTripScreen
              completedPool={completedPool}
              onBackToRoutes={() => dismissCompletedTrip(completedPool.pool.id)}
              onRefresh={() => refreshState()}
            />
          ) : null}

          {!activePool && !showCompletedTrip && !routePools ? (
            <RouteList
              routes={state.routes}
              userName={formatPassengerName(state.user)}
              busy={busy}
              onRefresh={() => refreshState()}
              onSelect={loadRoutePools}
            />
          ) : null}

          {!activePool && !showCompletedTrip && routePools && !hasPhone ? (
            <PhoneRequiredScreen
              routeName={routePools.route.name}
              busy={busy}
              phoneNumber={phoneNumber}
              onPhoneChange={setPhoneNumber}
              onSubmitPhone={submitPhone}
              onBack={() => setRoutePools(null)}
            />
          ) : null}

          {!activePool && !showCompletedTrip && routePools && hasPhone ? (
            <ActivePoolsScreen
              response={routePools}
              poolSize={state.poolSize}
              busy={busy}
              onBack={() => setRoutePools(null)}
              onRefresh={() => loadRoutePools(routePools.route.id)}
              onJoin={joinPool}
              onStartNew={() => createPool(routePools.route.id)}
            />
          ) : null}

          {activePool && lockedToTelegram ? (
            <TelegramWorkflowLockedScreen activePool={activePool} onRefresh={() => refreshState()} />
          ) : null}

          {activePool && !lockedToTelegram ? (
            <PoolDashboard
              activePool={activePool}
              poolSize={state.poolSize}
              busy={busy}
              hasSavedPhone={hasPhone}
              phoneNumber={phoneNumber}
              onPhoneChange={setPhoneNumber}
              onSubmitPhone={submitPhone}
              onConfirmPayment={() => runStateAction('pay', () => confirmPayment(initData, activePool.pool.id))}
              onCancel={() => runStateAction('cancel', () => cancelPool(initData, activePool.pool.id))}
              onEarlyDispatch={() =>
                runStateAction('early', () => requestEarlyDispatch(initData, activePool.pool.id))
              }
              onConfirmArrival={() =>
                runStateAction('confirm_arrival', () => confirmArrival(initData, activePool.pool.id))
              }
              onRejectArrival={() =>
                runStateAction('reject_arrival', () => rejectArrival(initData, activePool.pool.id))
              }
              onRefresh={() => refreshState()}
            />
          ) : null}

          <BottomNav active={activePool || showCompletedTrip ? 'pool' : 'routes'} />
        </>
      ) : null}
    </main>
  );
}

function IntroScreen({ onStart }: { onStart: () => void }) {
  return (
    <main className="side-intro">
      <div className="side-intro-logo-wrap">
        <img className="side-intro-logo" src={SIDE_LOGO_SRC} alt="Side" />
      </div>
      <p>Ride Together. Save More.</p>
      <div className="side-intro-dots" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      <button className="side-main-button" type="button" onClick={onStart}>
        Get Started
      </button>
    </main>
  );
}

function RouteList({
  routes,
  userName,
  busy,
  onRefresh,
  onSelect
}: {
  routes: Route[];
  userName: string;
  busy: BusyAction;
  onRefresh: () => void;
  onSelect: (routeId: string) => void;
}) {
  return (
    <>
      <SideHeader title="Side Ride Pool" subtitle="Telegram Mini App" onRefresh={onRefresh} />
      <section className="side-hero-card">
        <div>
          <h2>Hi {userName.replace(/^@/, '')}</h2>
          <p>Where are we heading?</p>
        </div>
        <MapPin size={29} />
      </section>

      <section className="side-section">
        <div className="side-section-title">
          <h2>Popular Routes</h2>
          <span>See all</span>
        </div>
        <div className="side-route-list">
          {routes.map((route) => (
            <button
              className="side-route-card"
              type="button"
              key={route.id}
              onClick={() => onSelect(route.id)}
              disabled={busy === 'pools' || !isRouteBookable(route)}
            >
              <span>
                <strong>{route.name}</strong>
                <small>
                  <UsersRound size={13} /> {isRouteBookable(route) ? 'Choose active pool' : 'Price not set'}
                </small>
              </span>
              <span className="side-price-stack">
                <strong>{formatPrice(route)}</strong>
                <small>5-10 min</small>
              </span>
            </button>
          ))}
        </div>
      </section>

      <section className="side-how">
        <h2>How it works</h2>
        <div className="side-how-grid">
          <HowItem icon={<RouteIcon size={17} />} label="Choose Route" />
          <HowItem icon={<UsersRound size={17} />} label="Join Pool" />
          <HowItem icon={<CreditCard size={17} />} label="Pay & Get PIN" />
          <HowItem icon={<CarFront size={17} />} label="Track Travel" />
          <HowItem icon={<CheckCircle2 size={17} />} label="Confirm Arrival" />
        </div>
      </section>
    </>
  );
}

function ActivePoolsScreen({
  response,
  poolSize,
  busy,
  onBack,
  onRefresh,
  onJoin,
  onStartNew
}: {
  response: RoutePoolsResponse;
  poolSize: number;
  busy: BusyAction;
  onBack: () => void;
  onRefresh: () => void;
  onJoin: (poolId: string) => void;
  onStartNew: () => void;
}) {
  return (
    <>
      <ScreenHeader title={`${response.route.name} Pools`} subtitle="Choose an active pool to join" onBack={onBack} onRefresh={onRefresh} />
      <section className="side-section">
        <div className="side-pool-list">
          {response.pools.length ? (
            response.pools.map((pool, index) => (
              <AvailablePoolCard
                pool={pool}
                poolSize={poolSize}
                index={index}
                busy={busy}
                key={pool.id}
                onJoin={() => onJoin(pool.id)}
              />
            ))
          ) : (
            <div className="side-empty-card">
              <UsersRound size={24} />
              <strong>No paid pools yet</strong>
              <span>Start one and confirm payment so other passengers can join.</span>
            </div>
          )}
        </div>
        <button className="side-outline-button side-start-pool" type="button" onClick={onStartNew} disabled={busy === 'start'}>
          <Plus size={18} /> Start New Pool
        </button>
      </section>
    </>
  );
}

function PhoneRequiredScreen({
  routeName,
  busy,
  phoneNumber,
  onPhoneChange,
  onSubmitPhone,
  onBack
}: {
  routeName: string;
  busy: BusyAction;
  phoneNumber: string;
  onPhoneChange: (value: string) => void;
  onSubmitPhone: (event: FormEvent<HTMLFormElement>) => void;
  onBack: () => void;
}) {
  return (
    <>
      <ScreenHeader title={routeName} subtitle="Phone required before payment" onBack={onBack} />
      <StatusCard
        icon={<Phone size={21} />}
        title="Share phone first"
        body="Your phone number is required before you create or join a pool."
      />
      <ContactCard
        phoneNumber={phoneNumber}
        onPhoneChange={onPhoneChange}
        onSubmitPhone={onSubmitPhone}
        busy={busy}
      />
      <button className="side-outline-button" type="button" onClick={onBack}>
        Back to Routes
      </button>
    </>
  );
}

function TelegramWorkflowLockedScreen({
  activePool,
  onRefresh
}: {
  activePool: PassengerPoolView;
  onRefresh: () => void;
}) {
  return (
    <>
      <ScreenHeader title="Continue in Telegram" subtitle={activePool.pool.routeName} onRefresh={onRefresh} />
      <StatusCard
        icon={<MessageCircle size={21} />}
        title="This ride is managed in Telegram"
        body="Use the Telegram bot buttons for payment, cancellation, early dispatch, and arrival until this ride is finished or cancelled."
      />
      <section className="side-pool-summary">
        <div>
          <span>{activePool.pool.routeName}</span>
          <strong>{activePool.passenger.paymentStatus === 'confirmed' ? 'Seat confirmed' : 'Payment pending'}</strong>
        </div>
        <strong>{formatPrice(activePool.pool)}</strong>
      </section>
    </>
  );
}

function AvailablePoolCard({
  pool,
  poolSize,
  index,
  busy,
  onJoin
}: {
  pool: PassengerAvailablePool;
  poolSize: number;
  index: number;
  busy: BusyAction;
  onJoin: () => void;
}) {
  return (
    <article className="side-active-pool-card">
      <div className="side-active-pool-head">
        <div>
          <h2>Pool {String.fromCharCode(65 + index)}</h2>
          <span>{formatPoolSeatLabel(pool)}</span>
        </div>
        <strong>{formatPrice(pool)}</strong>
      </div>
      <div className="side-captain-row">
        <Avatar label={formatPassengerName(pool.captain)} />
        <span>
          Captain {formatPassengerName(pool.captain)}
          <small>@{pool.captain?.username ?? 'telegram'}</small>
        </span>
      </div>
      <PoolProgress passengerCount={pool.passengerCount} poolSize={poolSize} />
      <div className="side-card-meta">
        <span>{poolOccupancyLabel(pool, poolSize)}</span>
        <span>ETA 5-10 min</span>
      </div>
      <button className="side-main-button" type="button" onClick={onJoin} disabled={busy === 'join'}>
        Join this pool
      </button>
    </article>
  );
}

function PoolDashboard({
  activePool,
  poolSize,
  busy,
  hasSavedPhone,
  phoneNumber,
  onPhoneChange,
  onSubmitPhone,
  onConfirmPayment,
  onCancel,
  onEarlyDispatch,
  onConfirmArrival,
  onRejectArrival,
  onRefresh
}: {
  activePool: PassengerPoolView;
  poolSize: number;
  busy: BusyAction;
  hasSavedPhone: boolean;
  phoneNumber: string;
  onPhoneChange: (value: string) => void;
  onSubmitPhone: (event: FormEvent<HTMLFormElement>) => void;
  onConfirmPayment: () => void;
  onCancel: () => void;
  onEarlyDispatch: () => void;
  onConfirmArrival: () => void;
  onRejectArrival: () => void;
  onRefresh: () => void;
}) {
  const { pool, passenger } = activePool;
  const isPendingPayment = passenger.paymentStatus === 'pending';
  const isAssigned =
    pool.status === 'assigned' || pool.status === 'arrival_requested' || pool.status === 'in_progress';

  return (
    <>
      <ScreenHeader
        title={isPendingPayment ? 'Pool Preview' : isAssigned ? 'Driver & Arrival' : 'Waiting in Pool'}
        subtitle={`${pool.routeName} - Est. 5-10 min`}
        onRefresh={onRefresh}
      />

      <section className="side-pool-summary">
        <div>
          <span>{pool.routeName}</span>
          <strong>{pool.isEarlyDispatch ? 'Early Pool' : `Pool ${pool.id}`}</strong>
        </div>
        <strong>{formatPrice(pool)}</strong>
      </section>

      {isPendingPayment ? (
        <PaymentPreview
          activePool={activePool}
          poolSize={poolSize}
          busy={busy}
          hasSavedPhone={hasSavedPhone}
          phoneNumber={phoneNumber}
          onPhoneChange={onPhoneChange}
          onSubmitPhone={onSubmitPhone}
          onConfirmPayment={onConfirmPayment}
          onCancel={onCancel}
        />
      ) : isAssigned ? (
        <DriverArrivalView
          activePool={activePool}
          poolSize={poolSize}
          busy={busy}
          onConfirmArrival={onConfirmArrival}
          onRejectArrival={onRejectArrival}
        />
      ) : (
        <WaitingPoolView
          activePool={activePool}
          poolSize={poolSize}
          busy={busy}
          onCancel={onCancel}
          onEarlyDispatch={onEarlyDispatch}
        />
      )}
    </>
  );
}

function CompletedTripScreen({
  completedPool,
  onBackToRoutes,
  onRefresh
}: {
  completedPool: PassengerPoolView;
  onBackToRoutes: () => void;
  onRefresh: () => void;
}) {
  const { pool, driver } = completedPool;

  return (
    <>
      <ScreenHeader title="Trip Complete" subtitle="Thanks for riding with Side" onRefresh={onRefresh} />
      <section className="side-complete-card">
        <span className="side-complete-check">
          <Check size={48} />
        </span>
        <h1>Ride completed!</h1>
        <p>Congrats, your ride is complete.</p>
      </section>
      <section className="side-section side-complete-summary">
        <div>
          <span>Route</span>
          <strong>{pool.routeName}</strong>
        </div>
        <div>
          <span>Total Paid</span>
          <strong>{formatPrice(pool)}</strong>
        </div>
        <div>
          <span>Passengers</span>
          <strong>{pool.passengerCount}</strong>
        </div>
        <div>
          <span>Status</span>
          <strong>Completed</strong>
        </div>
      </section>
      {driver ? <DriverCard driver={driver} /> : null}
      <section className="side-status-card side-complete-note">
        <CheckCircle2 size={21} />
        <div>
          <h2>You saved by pooling.</h2>
          <p>Share rides, save money, ride together.</p>
        </div>
      </section>
      <button className="side-main-button" type="button" onClick={onBackToRoutes}>
        Back to Routes
      </button>
    </>
  );
}

function PaymentPreview({
  activePool,
  poolSize,
  busy,
  hasSavedPhone,
  phoneNumber,
  onPhoneChange,
  onSubmitPhone,
  onConfirmPayment,
  onCancel
}: {
  activePool: PassengerPoolView;
  poolSize: number;
  busy: BusyAction;
  hasSavedPhone: boolean;
  phoneNumber: string;
  onPhoneChange: (value: string) => void;
  onSubmitPhone: (event: FormEvent<HTMLFormElement>) => void;
  onConfirmPayment: () => void;
  onCancel: () => void;
}) {
  const { pool } = activePool;
  return (
    <>
      <section className="side-section">
        <div className="side-section-title">
          <h2>Pool Progress</h2>
          <span>{poolOccupancyLabel(pool, poolSize)}</span>
        </div>
        <PoolProgress passengerCount={pool.passengerCount} poolSize={poolSize} />
      </section>

      <ContactCard
        phoneNumber={phoneNumber}
        onPhoneChange={onPhoneChange}
        onSubmitPhone={onSubmitPhone}
        busy={busy}
      />

      <section className="side-section side-payment-copy">
        <h2>Payment</h2>
        <p>Pay {formatPrice(pool)} to reserve your seat.</p>
        <p>You will see the PIN after payment. If you started this pool, payment publishes it for others.</p>
      </section>

      <div className="side-action-stack">
        <button
          className="side-main-button"
          type="button"
          onClick={onConfirmPayment}
          disabled={busy === 'pay' || !hasSavedPhone}
        >
          {hasSavedPhone ? 'I Have Paid' : 'Save Phone First'} <Check size={18} />
        </button>
        <button className="side-outline-button" type="button" onClick={onCancel} disabled={busy === 'cancel'}>
          Cancel
        </button>
      </div>
    </>
  );
}

function WaitingPoolView({
  activePool,
  poolSize,
  busy,
  onCancel,
  onEarlyDispatch
}: {
  activePool: PassengerPoolView;
  poolSize: number;
  busy: BusyAction;
  onCancel: () => void;
  onEarlyDispatch: () => void;
}) {
  const { pool, actions } = activePool;
  return (
    <>
      <StatusCard icon={<CheckCircle2 size={21} />} title="Payment Confirmed" body="Your seat is reserved." />
      <section className="side-section">
        <div className="side-section-title">
          <h2>Pool Progress</h2>
          <span>{poolOccupancyLabel(pool, poolSize)}</span>
        </div>
        <PoolProgress
          passengerCount={pool.passengerCount}
          poolSize={poolSize}
          passengers={activePool.passengers}
          currentTelegramId={activePool.passenger.telegramId}
          captainTelegramId={pool.captainTelegramId}
        />
      </section>
      <PinCard pin={pool.pinCode} />
      <section className="side-section">
        <div className="side-section-title">
          <h2>Passengers in this pool</h2>
          <span>{pool.passengerCount} confirmed</span>
        </div>
        <PassengerChips count={pool.passengerCount} poolSize={poolSize} passengers={activePool.passengers} />
      </section>
      {actions.canRequestEarlyDispatch ? (
        <div className="side-action-stack">
          <button className="side-main-button" type="button" onClick={onEarlyDispatch} disabled={busy === 'early'}>
            <Zap size={18} /> Let's Go Now
          </button>
        </div>
      ) : null}
      {actions.canCancel ? (
        <div className="side-action-stack">
          <button className="side-outline-button" type="button" onClick={onCancel} disabled={busy === 'cancel'}>
            Cancel Pool
          </button>
        </div>
      ) : null}
      <Timeline items={['Payment confirmed', `${pool.passengerCount} of ${poolSize} seats filled`, 'Driver will be assigned']} />
    </>
  );
}

function DriverArrivalView({
  activePool,
  poolSize,
  busy,
  onConfirmArrival,
  onRejectArrival
}: {
  activePool: PassengerPoolView;
  poolSize: number;
  busy: BusyAction;
  onConfirmArrival: () => void;
  onRejectArrival: () => void;
}) {
  const { pool, driver, actions } = activePool;
  return (
    <>
      <StatusCard
        icon={<ShieldCheck size={21} />}
        title={pool.arrivalRequestedAt ? 'Driver says they have arrived.' : 'Driver Assigned'}
        body={pool.arrivalRequestedAt ? 'Please confirm to start the trip.' : 'Driver is on the way.'}
      />
      {driver ? <DriverCard driver={driver} /> : null}
      <PinCard pin={pool.pinCode} />
      <section className="side-section">
        <div className="side-section-title">
          <h2>Pool Progress</h2>
          <span>{poolOccupancyLabel(pool, poolSize)}</span>
        </div>
        <PoolProgress
          passengerCount={pool.passengerCount}
          poolSize={poolSize}
          passengers={activePool.passengers}
          currentTelegramId={activePool.passenger.telegramId}
          captainTelegramId={pool.captainTelegramId}
        />
      </section>
      <Timeline items={['Payment confirmed', `${pool.passengerCount} seats filled`, 'Driver assigned', pool.arrivalRequestedAt ? 'Driver arrived' : 'Driver on the way']} />
      {actions.canConfirmArrival ? (
        <div className="side-action-stack">
          <button
            className="side-main-button"
            type="button"
            onClick={onConfirmArrival}
            disabled={busy === 'confirm_arrival'}
          >
            Confirm Arrival <Check size={18} />
          </button>
          <button
            className="side-outline-button"
            type="button"
            onClick={onRejectArrival}
            disabled={busy === 'reject_arrival'}
          >
            Driver Not Here
          </button>
        </div>
      ) : null}
    </>
  );
}

function ContactCard({
  phoneNumber,
  onPhoneChange,
  onSubmitPhone,
  busy
}: {
  phoneNumber: string;
  onPhoneChange: (value: string) => void;
  onSubmitPhone: (event: FormEvent<HTMLFormElement>) => void;
  busy?: BusyAction;
}) {
  return (
    <section className="side-section side-contact-card">
      <UsersRound size={22} />
      <div>
        <h2>Your phone & Telegram profile</h2>
        <p>Required before payment and shared only with the pool and driver.</p>
      </div>
      <form onSubmit={onSubmitPhone}>
        <input
          type="tel"
          value={phoneNumber}
          onChange={(event) => onPhoneChange(event.target.value)}
          placeholder="+251..."
          autoComplete="tel"
          aria-label="Phone"
        />
        <button className="side-icon-button" type="submit" aria-label="Save phone" disabled={busy === 'phone'}>
          <Phone size={16} />
        </button>
      </form>
    </section>
  );
}

function DriverCard({ driver }: { driver: NonNullable<PassengerPoolView['driver']> }) {
  return (
    <section className="side-section side-driver-card">
      <Avatar label={formatPassengerName(driver)} />
      <div>
        <h2>{formatPassengerName(driver)}</h2>
        <p>{driver.username ? `@${driver.username}` : 'Telegram driver'}</p>
        {driver.phoneNumber ? <p>{driver.phoneNumber}</p> : null}
      </div>
      <button className="side-icon-button" type="button" aria-label="Call driver">
        <Phone size={16} />
      </button>
      <button className="side-icon-button" type="button" aria-label="Message driver">
        <MessageCircle size={16} />
      </button>
    </section>
  );
}

function PinCard({ pin }: { pin: string | null }) {
  const [copied, setCopied] = useState(false);

  async function copyPin() {
    if (!pin) {
      return;
    }

    const copiedPin = await copyTextToClipboard(pin);
    if (!copiedPin) {
      notifyError();
      return;
    }

    notifySuccess();
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  }

  return (
    <section className="side-section side-pin-card">
      <span>Pool PIN</span>
      <strong>{pin ?? 'After payment'}</strong>
      <p>{copied ? 'PIN copied.' : 'Share this PIN with your driver.'}</p>
      {pin ? (
        <button className="side-copy-button" type="button" onClick={copyPin} aria-label="Copy pool PIN">
          {copied ? <Check size={18} /> : <Copy size={18} />}
        </button>
      ) : null}
    </section>
  );
}

function StatusCard({ icon, title, body }: { icon: ReactNode; title: string; body: string }) {
  return (
    <section className="side-status-card">
      {icon}
      <div>
        <h2>{title}</h2>
        <p>{body}</p>
      </div>
    </section>
  );
}

function PoolProgress({
  passengerCount,
  poolSize,
  passengers = [],
  currentTelegramId,
  captainTelegramId
}: {
  passengerCount: number;
  poolSize: number;
  passengers?: PoolPassengerContact[];
  currentTelegramId?: string;
  captainTelegramId?: string;
}) {
  const [selectedSeatIndex, setSelectedSeatIndex] = useState<number | null>(null);
  const selectedPassenger =
    selectedSeatIndex === null ? null : passengers[selectedSeatIndex] ?? null;

  useEffect(() => {
    if (selectedSeatIndex !== null && !passengers[selectedSeatIndex]) {
      setSelectedSeatIndex(null);
    }
  }, [passengers, selectedSeatIndex]);

  return (
    <>
      <div className="side-progress-dots" aria-label={`${passengerCount} of ${poolSize} seats filled`}>
        {Array.from({ length: poolSize }, (_, index) => {
          const passenger = passengers[index] ?? null;
          const isFilled = index < passengerCount;
          const isSelected = selectedSeatIndex === index;
          const className = [isFilled ? 'filled' : '', isSelected ? 'selected' : ''].filter(Boolean).join(' ');

          return passenger ? (
            <button
              className={className}
              key={index}
              type="button"
              onClick={() => setSelectedSeatIndex(isSelected ? null : index)}
              aria-label={`View ${passenger.displayName || 'passenger'} contact`}
            >
              <UserRound size={16} />
            </button>
          ) : (
            <span className={className || undefined} key={index}>
              <UserRound size={16} />
            </span>
          );
        })}
      </div>
      {selectedPassenger ? (
        <PassengerSeatDetail
          passenger={selectedPassenger}
          isCaptain={selectedPassenger.telegramId === captainTelegramId}
          isCurrentPassenger={selectedPassenger.telegramId === currentTelegramId}
        />
      ) : passengers.length ? (
        <p className="side-seat-hint">Tap a filled seat to view passenger name and phone.</p>
      ) : null}
    </>
  );
}

function PassengerSeatDetail({
  passenger,
  isCaptain,
  isCurrentPassenger
}: {
  passenger: PoolPassengerContact;
  isCaptain: boolean;
  isCurrentPassenger: boolean;
}) {
  return (
    <article className="side-seat-detail">
      <Avatar label={passenger.displayName || passenger.username || passenger.telegramId} />
      <div>
        <h3>
          {passenger.displayName || `Telegram ${passenger.telegramId}`}
          {isCurrentPassenger ? <span>You</span> : null}
          {isCaptain ? <span>Captain</span> : null}
        </h3>
        {passenger.username ? <p>@{passenger.username}</p> : null}
        <p>{passenger.phoneNumber ?? 'Phone not shared'}</p>
      </div>
    </article>
  );
}

function PassengerChips({
  count,
  poolSize,
  passengers = []
}: {
  count: number;
  poolSize: number;
  passengers?: PoolPassengerContact[];
}) {
  return (
    <div className="side-passenger-chips">
      {Array.from({ length: poolSize }, (_, index) => {
        const passenger = passengers[index];
        return (
          <span className={index < count ? 'filled' : undefined} key={index}>
            {passenger ? passengerInitials(passenger) : index < count ? `P${index + 1}` : 'Open'}
          </span>
        );
      })}
    </div>
  );
}

function passengerInitials(passenger: PoolPassengerContact): string {
  const source = passenger.displayName || passenger.username || passenger.telegramId;
  const initials = source
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');

  return initials || 'P';
}

function Timeline({ items }: { items: string[] }) {
  return (
    <section className="side-section side-timeline">
      {items.map((item, index) => (
        <div key={`${item}-${index}`}>
          <CheckCircle2 size={15} />
          <strong>{item}</strong>
        </div>
      ))}
    </section>
  );
}

function SideHeader({
  title,
  subtitle,
  onRefresh
}: {
  title: string;
  subtitle: string;
  onRefresh: () => void;
}) {
  return (
    <header className="side-header">
      <div>
        <img src={SIDE_LOGO_SRC} alt="Side" />
        <span>
          <strong>{title}</strong>
          <small>{subtitle}</small>
        </span>
      </div>
      <button className="side-icon-button" type="button" aria-label="Refresh" onClick={onRefresh}>
        <RefreshCw size={17} />
      </button>
      <button className="side-icon-button" type="button" aria-label="Menu">
        <MoreHorizontal size={17} />
      </button>
    </header>
  );
}

function ScreenHeader({
  title,
  subtitle,
  onBack,
  onRefresh
}: {
  title: string;
  subtitle: string;
  onBack?: () => void;
  onRefresh?: () => void;
}) {
  return (
    <header className="side-screen-header">
      {onBack ? (
        <button className="side-icon-button subtle" type="button" aria-label="Back" onClick={onBack}>
          <ArrowLeft size={18} />
        </button>
      ) : (
        <span className="side-header-spacer" aria-hidden="true" />
      )}
      <div>
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </div>
      <button className="side-icon-button subtle" type="button" aria-label="Refresh" onClick={onRefresh}>
        {onRefresh ? <RefreshCw size={17} /> : <MoreHorizontal size={17} />}
      </button>
    </header>
  );
}

function BottomNav({ active }: { active: 'routes' | 'pool' }) {
  return (
    <nav className="side-bottom-nav">
      <span className={active === 'routes' ? 'active' : undefined}>
        <Home size={17} /> Routes
      </span>
      <span className={active === 'pool' ? 'active' : undefined}>
        <UsersRound size={17} /> My Pool
      </span>
      <span>
        <WalletCards size={17} /> Payments
      </span>
      <span>
        <UserRound size={17} /> Profile
      </span>
    </nav>
  );
}

function HowItem({ icon, label }: { icon: ReactNode; label: string }) {
  return (
    <span>
      {icon}
      {label}
    </span>
  );
}

function Avatar({ label }: { label: string }) {
  const clean = label.replace('@', '').trim();
  const initials = clean
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');

  return <span className="side-avatar">{initials || 'S'}</span>;
}

function InlineAlert({ message }: { message: string }) {
  return (
    <div className="inline-alert side-alert">
      <CircleAlert size={18} />
      <span>{message}</span>
    </div>
  );
}

function LoadingState() {
  return (
    <section className="panel loading-panel side-loading-panel">
      <RefreshCw size={20} />
      <span>Loading ride status</span>
    </section>
  );
}

function AuthRequired() {
  return (
    <main className="app-shell side-auth-shell">
      <section className="side-section">
        <div className="section-header">
          <div>
            <p className="section-label">Telegram Required</p>
            <h1>Open from Telegram</h1>
          </div>
          <ShieldCheck size={24} />
        </div>
      </section>
    </main>
  );
}
