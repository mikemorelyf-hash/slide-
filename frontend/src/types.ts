export interface Route {
  id: string;
  name: string;
  isActive: boolean;
  priceAmount: number | null;
  priceCurrency: string;
}

export type PoolStatus =
  | 'open'
  | 'ready'
  | 'assigned'
  | 'arrival_requested'
  | 'in_progress'
  | 'cancelled'
  | 'expired'
  | 'completed';
export type PaymentStatus = 'pending' | 'confirmed' | 'cancelled';
export type WorkflowChannel = 'telegram' | 'mini_app';
export type PrimaryAction =
  | 'choose_route'
  | 'confirm_payment'
  | 'wait_for_pool'
  | 'request_early_dispatch'
  | 'wait_for_driver'
  | 'confirm_arrival'
  | 'in_trip'
  | 'completed';

export interface TelegramUserProfile {
  telegramId: string;
  firstName: string | null;
  lastName: string | null;
  username: string | null;
  phoneNumber?: string | null;
  role?: 'passenger' | 'driver' | 'admin';
}

export interface PoolPassenger {
  poolId: string;
  telegramId: string;
  isCaptain: boolean;
  paymentStatus: PaymentStatus;
  earlyDispatchVote: 'pending' | 'accepted' | 'rejected';
}

export interface PoolPassengerContact {
  telegramId: string;
  displayName: string;
  username: string | null;
  phoneNumber: string | null;
  pickupLocation: string | null;
}

export interface PassengerPool {
  id: string;
  routeId: string;
  routeName: string;
  workflowChannel: WorkflowChannel;
  pinCode: string | null;
  captainTelegramId: string;
  status: PoolStatus;
  passengerCount: number;
  driverTelegramId: string | null;
  priceAmount: number | null;
  priceCurrency: string;
  isEarlyDispatch: boolean;
  arrivalRequestedAt: string | null;
  arrivedAt: string | null;
}

export interface PassengerPoolView {
  pool: PassengerPool;
  passenger: PoolPassenger;
  driver: TelegramUserProfile | null;
  actions: {
    primary: PrimaryAction;
    canConfirmPayment: boolean;
    canCancel: boolean;
    canRequestEarlyDispatch: boolean;
    canConfirmArrival: boolean;
    canRejectArrival: boolean;
  };
  passengers: PoolPassengerContact[];
}

export interface PassengerAvailablePool {
  id: string;
  routeId: string;
  routeName: string;
  workflowChannel: WorkflowChannel;
  status: PoolStatus;
  passengerCount: number;
  seatsLeft: number;
  priceAmount: number | null;
  priceCurrency: string;
  isEarlyDispatch: boolean;
  captain: TelegramUserProfile | null;
}

export interface RoutePoolsResponse {
  route: Route;
  pools: PassengerAvailablePool[];
}

export interface PassengerState {
  user: TelegramUserProfile | null;
  poolSize: number;
  routes: Route[];
  activePool: PassengerPoolView | null;
  lastCompletedPool: PassengerPoolView | null;
}

export interface AdminPoolSummary {
  id: string;
  routeId: string;
  routeName: string;
  workflowChannel: WorkflowChannel;
  pinCode: string;
  captainTelegramId: string;
  status: PoolStatus;
  passengerCount: number;
  pendingPassengerCount: number;
  cancelledPassengerCount: number;
  driverTelegramId: string | null;
  driverAlertMessageId: number | null;
  driverGroupChatId: string | null;
  isEarlyDispatch: boolean;
  earlyDispatchRequestedAt: string | null;
  sentToDriversAt: string | null;
  acceptedAt: string | null;
  arrivalRequestedAt: string | null;
  arrivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  priceAmount: number | null;
  priceCurrency: string;
  captain: TelegramUserProfile | null;
  driver: TelegramUserProfile | null;
}

export interface AdminPassengerManifest {
  telegramId: string;
  displayName: string;
  username: string | null;
  phoneNumber: string | null;
  pickupLocation: string | null;
  isCaptain: boolean;
  paymentStatus: PaymentStatus;
  earlyDispatchVote: 'pending' | 'accepted' | 'rejected';
  joinedAt: string;
  paidAt: string | null;
}

export interface AdminPoolDetail {
  pool: AdminPoolSummary;
  passengers: AdminPassengerManifest[];
}

export interface AdminOverviewMetrics {
  activePools: number;
  openPools: number;
  waitingDriverPools: number;
  arrivalPendingPools: number;
  inProgressTrips: number;
  completedToday: number;
}

export interface AdminOverview {
  metrics: AdminOverviewMetrics;
  stability: {
    pendingNotifications: number;
    failedNotifications: number;
    stuckPools: Array<{
      poolId: string;
      routeName: string;
      status: PoolStatus;
      reason: string;
    }>;
  };
  routes: Route[];
  pools: AdminPoolSummary[];
}

export interface ReadinessReport {
  ok: boolean;
  status: 'ready' | 'degraded' | 'unready';
  service: string;
  checks: {
    database: ReadinessCheck;
    notifications: ReadinessCheck & {
      pending: number;
      sending: number;
      failed: number;
    };
    workflows: ReadinessCheck & {
      stuckPools: AdminOverview['stability']['stuckPools'];
    };
    telegram: ReadinessCheck & {
      botMode: 'polling' | 'webhook';
      driverBotConfigured: boolean;
    };
    miniApp: ReadinessCheck & {
      url: string | null;
    };
  };
}

export interface ReadinessCheck {
  status: 'ok' | 'warning' | 'error';
  message: string;
}
