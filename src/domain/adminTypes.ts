import type {
  EarlyDispatchVote,
  PassengerManifest,
  PaymentStatus,
  RidePool,
  Route,
  TelegramUserProfile
} from './types.js';

export interface AdminPoolSummary extends RidePool {
  pendingPassengerCount: number;
  cancelledPassengerCount: number;
  captain: TelegramUserProfile | null;
  driver: TelegramUserProfile | null;
  sentToDriversAt: Date | null;
  acceptedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface AdminPassengerManifest extends PassengerManifest {
  isCaptain: boolean;
  paymentStatus: PaymentStatus;
  earlyDispatchVote: EarlyDispatchVote;
  joinedAt: Date;
  paidAt: Date | null;
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
      status: RidePool['status'];
      reason: string;
    }>;
  };
  routes: Route[];
  pools: AdminPoolSummary[];
}
