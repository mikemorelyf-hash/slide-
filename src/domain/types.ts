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

export type EarlyDispatchVote = 'pending' | 'accepted' | 'rejected';

export type WorkflowChannel = 'telegram' | 'mini_app';

export type ActorRole = 'passenger' | 'driver' | 'admin' | 'system';

export type PoolEventType =
  | 'pool_created'
  | 'passenger_joined'
  | 'passenger_cancelled'
  | 'payment_confirmed'
  | 'pool_ready'
  | 'driver_alert_queued'
  | 'driver_alert_sent'
  | 'driver_assigned'
  | 'arrival_requested'
  | 'arrival_confirmed'
  | 'arrival_rejected'
  | 'trip_completed'
  | 'pool_cancelled'
  | 'pool_expired'
  | 'recovery_driver_reposted'
  | 'notification_failed';

export type IdempotencyStatus = 'processing' | 'completed' | 'failed';

export type NotificationTargetBot = 'passenger' | 'driver';

export type NotificationStatus = 'pending' | 'sending' | 'sent' | 'failed' | 'cancelled';

export interface PoolEventInput {
  poolId: string;
  actorTelegramId: string | null;
  actorRole: ActorRole;
  eventType: PoolEventType;
  fromStatus: PoolStatus | null;
  toStatus: PoolStatus | null;
  metadata: Record<string, unknown>;
}

export interface PoolEvent extends PoolEventInput {
  id: string;
  createdAt: Date;
}

export interface NotificationOutboxInput {
  targetBot: NotificationTargetBot;
  chatId: string;
  messageType: string;
  payload: Record<string, unknown>;
  nextAttemptAt?: Date;
}

export interface QueuedNotification {
  id: string;
  targetBot: NotificationTargetBot;
  chatId: string;
  messageType: string;
  payload: Record<string, unknown>;
  attemptCount: number;
}

export type PendingPassengerActionType = 'create_pool' | 'join_pool';

export interface PendingPassengerAction {
  telegramId: string;
  actionType: PendingPassengerActionType;
  routeId: string | null;
  poolId: string | null;
  createdAt?: Date;
  expiresAt?: Date;
}

export interface PendingPassengerActionInput {
  telegramId: string;
  actionType: PendingPassengerActionType;
  routeId: string | null;
  poolId: string | null;
  expiresAt: Date;
}

export interface Route {
  id: string;
  name: string;
  isActive: boolean;
  priceAmount: number | null;
  priceCurrency: string;
}

export interface RidePool {
  id: string;
  routeId: string;
  routeName: string;
  workflowChannel: WorkflowChannel;
  pinCode: string;
  captainTelegramId: string;
  status: PoolStatus;
  passengerCount: number;
  driverTelegramId: string | null;
  driverAlertMessageId: number | null;
  driverGroupChatId: string | null;
  isEarlyDispatch: boolean;
  earlyDispatchRequestedAt: Date | null;
  arrivalRequestedAt: Date | null;
  arrivedAt: Date | null;
  priceAmount: number | null;
  priceCurrency: string;
}

export interface PoolPassenger {
  poolId: string;
  telegramId: string;
  isCaptain: boolean;
  paymentStatus: PaymentStatus;
  earlyDispatchVote: EarlyDispatchVote;
}

export interface PassengerManifest {
  telegramId: string;
  displayName: string;
  username: string | null;
  phoneNumber: string | null;
  pickupLocation: string | null;
}

export interface TelegramUserProfile {
  telegramId: string;
  firstName: string | null;
  lastName: string | null;
  username: string | null;
  phoneNumber?: string | null;
  locationLat?: number | null;
  locationLng?: number | null;
  locationLabel?: string | null;
  role?: 'passenger' | 'driver' | 'admin';
  driverBotStartedAt?: Date | null;
}
