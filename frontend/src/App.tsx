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
import { createContext, FormEvent, useContext, useEffect, useMemo, useState } from 'react';
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
  saveLanguage,
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
import {
  createTranslator,
  LANGUAGE_STORAGE_KEY,
  normalizeLanguageCode,
  type LanguageCode,
  type Translator
} from './i18n';
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

interface LanguageContextValue {
  language: LanguageCode;
  t: Translator;
  setLanguage: (language: LanguageCode) => void;
}

const LanguageContext = createContext<LanguageContextValue>({
  language: 'en',
  t: createTranslator('en'),
  setLanguage: () => undefined
});

function useLanguageCopy(): LanguageContextValue {
  return useContext(LanguageContext);
}

export default function App() {
  const isAdminPath = typeof window !== 'undefined' && window.location.pathname.startsWith('/admin');
  return isAdminPath ? <AdminApp /> : <PassengerApp />;
}

function PassengerApp() {
  const [initData] = useState(() => getTelegramInitData());
  const [language, setLanguageState] = useState<LanguageCode>(() =>
    typeof window === 'undefined'
      ? 'en'
      : normalizeLanguageCode(window.localStorage.getItem(LANGUAGE_STORAGE_KEY))
  );
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
  const t = useMemo(() => createTranslator(language), [language]);
  const languageContext = useMemo(
    () => ({
      language,
      t,
      setLanguage: changeLanguage
    }),
    [language, t, initData]
  );

  useEffect(() => {
    prepareTelegramShell();
  }, []);

  useEffect(() => {
    const profileLanguage = state?.user?.languageCode;
    if (!profileLanguage) {
      return;
    }

    const normalized = normalizeLanguageCode(profileLanguage);
    if (normalized !== language) {
      persistLanguage(normalized);
    }
  }, [state?.user?.languageCode]);

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
      setError(resolveMiniAppError(caught, 'passenger', language));
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
      setError(language === 'am' ? 'ስልክ ቁጥር ያስፈልጋል።' : 'Phone number is required.');
      return;
    }

    await runStateAction('phone', () => savePhone(initData, trimmedPhone));
  }

  function dismissCompletedTrip(poolId: string) {
    setDismissedCompletedPoolId(poolId);
    window.localStorage.setItem(DISMISSED_COMPLETED_POOL_STORAGE_KEY, poolId);
  }

  function persistLanguage(nextLanguage: LanguageCode) {
    setLanguageState(nextLanguage);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(LANGUAGE_STORAGE_KEY, nextLanguage);
    }
  }

  function changeLanguage(nextLanguage: LanguageCode) {
    persistLanguage(nextLanguage);

    if (!initData) {
      return;
    }

    void runAction(null, async () => {
      setState(await saveLanguage(initData, nextLanguage));
    });
  }

  return (
    <LanguageContext.Provider value={languageContext}>
      {!initData ? (
        <AuthRequired />
      ) : showIntro ? (
        <IntroScreen onStart={() => setShowIntro(false)} />
      ) : (
    <main className="app-shell side-app-shell">
      <div className="side-language-row">
        <LanguageToggle />
      </div>
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
              userName={formatPassengerName(state.user, language)}
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
      )}
    </LanguageContext.Provider>
  );
}

function IntroScreen({ onStart }: { onStart: () => void }) {
  const { t } = useLanguageCopy();

  return (
    <main className="side-intro">
      <div className="side-intro-language">
        <LanguageToggle />
      </div>
      <div className="side-intro-logo-wrap">
        <img className="side-intro-logo" src={SIDE_LOGO_SRC} alt="Side" />
      </div>
      <p>{t('introTagline')}</p>
      <div className="side-intro-dots" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      <button className="side-main-button" type="button" onClick={onStart}>
        {t('getStarted')}
      </button>
    </main>
  );
}

function LanguageToggle() {
  const { language, setLanguage, t } = useLanguageCopy();

  return (
    <div className="side-language-toggle" aria-label={t('language')}>
      <button
        className={language === 'en' ? 'active' : undefined}
        type="button"
        onClick={() => setLanguage('en')}
        aria-pressed={language === 'en'}
      >
        {t('englishShort')}
      </button>
      <button
        className={language === 'am' ? 'active' : undefined}
        type="button"
        onClick={() => setLanguage('am')}
        aria-pressed={language === 'am'}
      >
        {t('amharicShort')}
      </button>
    </div>
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
  const { language, t } = useLanguageCopy();

  return (
    <>
      <SideHeader title="Side Ride Pool" subtitle={t('telegramMiniApp')} onRefresh={onRefresh} />
      <section className="side-hero-card">
        <div>
          <h2>{t('hiName', { name: userName.replace(/^@/, '') })}</h2>
          <p>{t('chooseRoutePrompt')}</p>
        </div>
        <MapPin size={29} />
      </section>

      <section className="side-section">
        <div className="side-section-title">
          <h2>{t('popularRoutes')}</h2>
          <span>{t('seeAll')}</span>
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
                  <UsersRound size={13} /> {isRouteBookable(route) ? t('chooseActivePool') : t('priceNotSet')}
                </small>
              </span>
              <span className="side-price-stack">
                <strong>{formatPrice(route, language)}</strong>
                <small>{t('eta')}</small>
              </span>
            </button>
          ))}
        </div>
      </section>

      <section className="side-how">
        <h2>{t('howItWorks')}</h2>
        <div className="side-how-grid">
          <HowItem icon={<RouteIcon size={17} />} label={t('chooseRoute')} />
          <HowItem icon={<UsersRound size={17} />} label={t('joinPool')} />
          <HowItem icon={<CreditCard size={17} />} label={t('payAndPin')} />
          <HowItem icon={<CarFront size={17} />} label={t('trackTravel')} />
          <HowItem icon={<CheckCircle2 size={17} />} label={t('confirmArrival')} />
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
  const { language, t } = useLanguageCopy();

  return (
    <>
      <ScreenHeader
        title={`${response.route.name} ${language === 'am' ? 'ፑሎች' : 'Pools'}`}
        subtitle={t('chooseActivePool')}
        onBack={onBack}
        onRefresh={onRefresh}
      />
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
              <strong>{t('noPaidPools')}</strong>
              <span>{t('startOne')}</span>
            </div>
          )}
        </div>
        <button className="side-outline-button side-start-pool" type="button" onClick={onStartNew} disabled={busy === 'start'}>
          <Plus size={18} /> {t('startNewPool')}
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
  const { t } = useLanguageCopy();

  return (
    <>
      <ScreenHeader title={routeName} subtitle={t('phoneRequiredBeforePayment')} onBack={onBack} />
      <StatusCard
        icon={<Phone size={21} />}
        title={t('phoneRequiredTitle')}
        body={t('phoneRequiredBody')}
      />
      <ContactCard
        phoneNumber={phoneNumber}
        onPhoneChange={onPhoneChange}
        onSubmitPhone={onSubmitPhone}
        busy={busy}
      />
      <button className="side-outline-button" type="button" onClick={onBack}>
        {t('backToRoutes')}
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
  const { language, t } = useLanguageCopy();

  return (
    <>
      <ScreenHeader title="Telegram" subtitle={activePool.pool.routeName} onRefresh={onRefresh} />
      <StatusCard
        icon={<MessageCircle size={21} />}
        title={t('miniAppLockedTitle')}
        body={t('miniAppLockedBody')}
      />
      <section className="side-pool-summary">
        <div>
          <span>{activePool.pool.routeName}</span>
          <strong>{activePool.passenger.paymentStatus === 'confirmed' ? t('seatConfirmed') : t('payment')}</strong>
        </div>
        <strong>{formatPrice(activePool.pool, language)}</strong>
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
  const { language, t } = useLanguageCopy();

  return (
    <article className="side-active-pool-card">
      <div className="side-active-pool-head">
        <div>
          <h2>{t('poolLabel', { label: String.fromCharCode(65 + index) })}</h2>
          <span>{formatPoolSeatLabel(pool, language)}</span>
        </div>
        <strong>{formatPrice(pool, language)}</strong>
      </div>
      <div className="side-captain-row">
        <Avatar label={formatPassengerName(pool.captain)} />
        <span>
          {t('captainName', { name: formatPassengerName(pool.captain) })}
          <small>@{pool.captain?.username ?? 'telegram'}</small>
        </span>
      </div>
      <PoolProgress passengerCount={pool.passengerCount} poolSize={poolSize} />
      <div className="side-card-meta">
        <span>{poolOccupancyLabel(pool, poolSize, language)}</span>
        <span>ETA {t('eta')}</span>
      </div>
      <button className="side-main-button" type="button" onClick={onJoin} disabled={busy === 'join'}>
        {t('joinThisPool')}
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
  const { language, t } = useLanguageCopy();

  return (
    <>
      <ScreenHeader
        title={isPendingPayment ? t('poolPreview') : isAssigned ? t('driverAssigned') : t('waitingInPool')}
        subtitle={`${pool.routeName} - Est. ${t('eta')}`}
        onRefresh={onRefresh}
      />

      <section className="side-pool-summary">
        <div>
          <span>{pool.routeName}</span>
          <strong>{pool.isEarlyDispatch ? t('earlyPool') : t('poolTitle', { id: pool.id })}</strong>
        </div>
        <strong>{formatPrice(pool, language)}</strong>
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
  const { language, t } = useLanguageCopy();

  return (
    <>
      <ScreenHeader title={t('tripComplete')} subtitle={t('tripCompleteThanks')} onRefresh={onRefresh} />
      <section className="side-complete-card">
        <span className="side-complete-check">
          <Check size={48} />
        </span>
        <h1>{t('tripDoneTitle')}</h1>
        <p>{t('tripDoneBody')}</p>
      </section>
      <section className="side-section side-complete-summary">
        <div>
          <span>{t('route')}</span>
          <strong>{pool.routeName}</strong>
        </div>
        <div>
          <span>{t('totalPaid')}</span>
          <strong>{formatPrice(pool, language)}</strong>
        </div>
        <div>
          <span>{t('passengers')}</span>
          <strong>{pool.passengerCount}</strong>
        </div>
        <div>
          <span>{t('status')}</span>
          <strong>{t('completed')}</strong>
        </div>
      </section>
      {driver ? <DriverCard driver={driver} /> : null}
      <section className="side-status-card side-complete-note">
        <CheckCircle2 size={21} />
        <div>
          <h2>{t('savedByPooling')}</h2>
          <p>{t('shareRides')}</p>
        </div>
      </section>
      <button className="side-main-button" type="button" onClick={onBackToRoutes}>
        {t('backToRoutes')}
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
  const { language, t } = useLanguageCopy();
  return (
    <>
      <section className="side-section">
        <div className="side-section-title">
          <h2>{t('poolProgress')}</h2>
          <span>{poolOccupancyLabel(pool, poolSize, language)}</span>
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
        <h2>{t('payment')}</h2>
        <p>{t('payToReserve', { price: formatPrice(pool, language) })}</p>
        <p>
          {language === 'am'
            ? 'PIN ከክፍያ በኋላ ይታያል። ይህን ፑል እርስዎ ከጀመሩት፣ ክፍያው ለሌሎች እንዲታይ ያደርገዋል።'
            : 'You will see the PIN after payment. If you started this pool, payment publishes it for others.'}
        </p>
      </section>

      <div className="side-action-stack">
        <button
          className="side-main-button"
          type="button"
          onClick={onConfirmPayment}
          disabled={busy === 'pay' || !hasSavedPhone}
        >
          {hasSavedPhone ? t('havePaid') : t('savePhoneFirst')} <Check size={18} />
        </button>
        <button className="side-outline-button" type="button" onClick={onCancel} disabled={busy === 'cancel'}>
          {t('cancel')}
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
  const { language, t } = useLanguageCopy();
  return (
    <>
      <StatusCard icon={<CheckCircle2 size={21} />} title={t('paymentConfirmed')} body={t('yourSeatReserved')} />
      <section className="side-section">
        <div className="side-section-title">
          <h2>{t('poolProgress')}</h2>
          <span>{poolOccupancyLabel(pool, poolSize, language)}</span>
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
          <h2>{t('passengersInPool')}</h2>
          <span>{t('confirmedCount', { count: pool.passengerCount })}</span>
        </div>
        <PassengerChips count={pool.passengerCount} poolSize={poolSize} passengers={activePool.passengers} />
      </section>
      {actions.canRequestEarlyDispatch ? (
        <div className="side-action-stack">
          <button className="side-main-button" type="button" onClick={onEarlyDispatch} disabled={busy === 'early'}>
            <Zap size={18} /> {language === 'am' ? 'አሁን እንሂድ' : "Let's Go Now"}
          </button>
        </div>
      ) : null}
      {actions.canCancel ? (
        <div className="side-action-stack">
          <button className="side-outline-button" type="button" onClick={onCancel} disabled={busy === 'cancel'}>
            {t('cancelPool')}
          </button>
        </div>
      ) : null}
      <Timeline
        items={[
          t('timelinePaymentConfirmed'),
          poolOccupancyLabel(pool, poolSize, language),
          t('timelineDriverWillBeAssigned')
        ]}
      />
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
  const { language, t } = useLanguageCopy();
  return (
    <>
      <StatusCard
        icon={<ShieldCheck size={21} />}
        title={pool.arrivalRequestedAt ? t('driverArrivedTitle') : t('driverAssigned')}
        body={
          pool.arrivalRequestedAt
            ? language === 'am'
              ? 'ጉዞውን ለመጀመር እባክዎ ያረጋግጡ።'
              : 'Please confirm to start the trip.'
            : t('driverOnWay')
        }
      />
      {driver ? <DriverCard driver={driver} /> : null}
      <PinCard pin={pool.pinCode} />
      <section className="side-section">
        <div className="side-section-title">
          <h2>{t('poolProgress')}</h2>
          <span>{poolOccupancyLabel(pool, poolSize, language)}</span>
        </div>
        <PoolProgress
          passengerCount={pool.passengerCount}
          poolSize={poolSize}
          passengers={activePool.passengers}
          currentTelegramId={activePool.passenger.telegramId}
          captainTelegramId={pool.captainTelegramId}
        />
      </section>
      <Timeline
        items={[
          t('timelinePaymentConfirmed'),
          poolOccupancyLabel(pool, poolSize, language),
          t('timelineDriverAssigned'),
          pool.arrivalRequestedAt ? t('timelineDriverArrived') : t('driverOnWayStep')
        ]}
      />
      {actions.canConfirmArrival ? (
        <div className="side-action-stack">
          <button
            className="side-main-button"
            type="button"
            onClick={onConfirmArrival}
            disabled={busy === 'confirm_arrival'}
          >
            {t('confirmArrival')} <Check size={18} />
          </button>
          <button
            className="side-outline-button"
            type="button"
            onClick={onRejectArrival}
            disabled={busy === 'reject_arrival'}
          >
            {t('driverNotHere')}
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
  const { t } = useLanguageCopy();

  return (
    <section className="side-section side-contact-card">
      <UsersRound size={22} />
      <div>
        <h2>{t('contactTitle')}</h2>
        <p>{t('contactBody')}</p>
      </div>
      <form onSubmit={onSubmitPhone}>
        <input
          type="tel"
          value={phoneNumber}
          onChange={(event) => onPhoneChange(event.target.value)}
          placeholder="+251..."
          autoComplete="tel"
          aria-label={t('phone')}
        />
        <button className="side-icon-button" type="submit" aria-label={t('savePhone')} disabled={busy === 'phone'}>
          <Phone size={16} />
        </button>
      </form>
    </section>
  );
}

function DriverCard({ driver }: { driver: NonNullable<PassengerPoolView['driver']> }) {
  const { t } = useLanguageCopy();

  return (
    <section className="side-section side-driver-card">
      <Avatar label={formatPassengerName(driver)} />
      <div>
        <h2>{formatPassengerName(driver)}</h2>
        <p>{driver.username ? `@${driver.username}` : t('driverTelegramFallback')}</p>
        {driver.phoneNumber ? <p>{driver.phoneNumber}</p> : null}
      </div>
      <button className="side-icon-button" type="button" aria-label={t('callDriver')}>
        <Phone size={16} />
      </button>
      <button className="side-icon-button" type="button" aria-label={t('messageDriver')}>
        <MessageCircle size={16} />
      </button>
    </section>
  );
}

function PinCard({ pin }: { pin: string | null }) {
  const [copied, setCopied] = useState(false);
  const { t } = useLanguageCopy();

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
      <span>{t('poolPin')}</span>
      <strong>{pin ?? t('afterPayment')}</strong>
      <p>{copied ? t('pinCopied') : t('sharePin')}</p>
      {pin ? (
        <button className="side-copy-button" type="button" onClick={copyPin} aria-label={t('copyPoolPin')}>
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
  const { language, t } = useLanguageCopy();

  useEffect(() => {
    if (selectedSeatIndex !== null && !passengers[selectedSeatIndex]) {
      setSelectedSeatIndex(null);
    }
  }, [passengers, selectedSeatIndex]);

  return (
    <>
      <div className="side-progress-dots" aria-label={poolOccupancyLabel({ passengerCount }, poolSize, language)}>
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
              aria-label={t('viewPassengerContact', {
                name: passenger.displayName || t('passengerFallback')
              })}
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
        <p className="side-seat-hint">{t('seatHint')}</p>
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
  const { t } = useLanguageCopy();

  return (
    <article className="side-seat-detail">
      <Avatar label={passenger.displayName || passenger.username || passenger.telegramId} />
      <div>
        <h3>
          {passenger.displayName || `Telegram ${passenger.telegramId}`}
          {isCurrentPassenger ? <span>{t('you')}</span> : null}
          {isCaptain ? <span>{t('captain')}</span> : null}
        </h3>
        {passenger.username ? <p>@{passenger.username}</p> : null}
        <p>{passenger.phoneNumber ?? t('phoneNotShared')}</p>
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
  const { t } = useLanguageCopy();

  return (
    <div className="side-passenger-chips">
      {Array.from({ length: poolSize }, (_, index) => {
        const passenger = passengers[index];
        return (
          <span className={index < count ? 'filled' : undefined} key={index}>
            {passenger ? passengerInitials(passenger) : index < count ? `P${index + 1}` : t('open')}
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
  const { t } = useLanguageCopy();

  return (
    <header className="side-header">
      <div>
        <img src={SIDE_LOGO_SRC} alt="Side" />
        <span>
          <strong>{title}</strong>
          <small>{subtitle}</small>
        </span>
      </div>
      <button className="side-icon-button" type="button" aria-label={t('refresh')} onClick={onRefresh}>
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
  const { t } = useLanguageCopy();

  return (
    <header className="side-screen-header">
      {onBack ? (
        <button className="side-icon-button subtle" type="button" aria-label={t('back')} onClick={onBack}>
          <ArrowLeft size={18} />
        </button>
      ) : (
        <span className="side-header-spacer" aria-hidden="true" />
      )}
      <div>
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </div>
      <button className="side-icon-button subtle" type="button" aria-label={t('refresh')} onClick={onRefresh}>
        {onRefresh ? <RefreshCw size={17} /> : <MoreHorizontal size={17} />}
      </button>
    </header>
  );
}

function BottomNav({ active }: { active: 'routes' | 'pool' }) {
  const { t } = useLanguageCopy();

  return (
    <nav className="side-bottom-nav">
      <span className={active === 'routes' ? 'active' : undefined}>
        <Home size={17} /> {t('routes')}
      </span>
      <span className={active === 'pool' ? 'active' : undefined}>
        <UsersRound size={17} /> {t('myPool')}
      </span>
      <span>
        <WalletCards size={17} /> {t('payments')}
      </span>
      <span>
        <UserRound size={17} /> {t('profile')}
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
  const { t } = useLanguageCopy();

  return (
    <section className="panel loading-panel side-loading-panel">
      <RefreshCw size={20} />
      <span>{t('loadingRideStatus')}</span>
    </section>
  );
}

function AuthRequired() {
  const { t } = useLanguageCopy();

  return (
    <main className="app-shell side-auth-shell">
      <div className="side-language-row">
        <LanguageToggle />
      </div>
      <section className="side-section">
        <div className="section-header">
          <div>
            <p className="section-label">{t('telegramRequired')}</p>
            <h1>{t('authRequiredTitle')}</h1>
          </div>
          <ShieldCheck size={24} />
        </div>
      </section>
    </main>
  );
}
