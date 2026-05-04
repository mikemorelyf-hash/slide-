import { createUniquePin } from './pin.js';
import type {
  EarlyDispatchVote,
  NotificationOutboxInput,
  PassengerManifest,
  PoolPassenger,
  PoolEventInput,
  RidePool,
  Route,
  TelegramUserProfile,
  WorkflowChannel
} from './types.js';

export interface CreatePoolInput {
  routeId: string;
  captainTelegramId: string;
  pinCode: string;
  workflowChannel: WorkflowChannel;
}

export interface RidePoolStore {
  withTransaction<T>(work: (store: RidePoolStore) => Promise<T>): Promise<T>;
  getRoute(routeId: string): Promise<Route | null>;
  getUserProfile(telegramId: string): Promise<TelegramUserProfile | null>;
  isPinInUse(pinCode: string): Promise<boolean>;
  createPool(input: CreatePoolInput): Promise<RidePool>;
  findOpenPoolByRoute(
    routeId: string,
    passengerLimit: number,
    workflowChannel?: WorkflowChannel
  ): Promise<RidePool | null>;
  getPoolForUpdate(poolId: string): Promise<RidePool | null>;
  getPassenger(poolId: string, telegramId: string): Promise<PoolPassenger | null>;
  addPassenger(poolId: string, telegramId: string, isCaptain: boolean): Promise<PoolPassenger>;
  confirmPassenger(poolId: string, telegramId: string): Promise<PoolPassenger | null>;
  removePendingPassenger(poolId: string, telegramId: string): Promise<boolean>;
  cancelPassengerBeforeDispatch(
    poolId: string,
    telegramId: string,
    passengerLimit: number
  ): Promise<RidePool | null>;
  markPoolReady(poolId: string, isEarlyDispatch?: boolean): Promise<RidePool>;
  markDriverAlertSent(poolId: string, chatId: string, messageId: number): Promise<void>;
  assignDriver(poolId: string, driverTelegramId: string): Promise<RidePool | null>;
  requestDriverArrival(poolId: string): Promise<RidePool | null>;
  confirmDriverArrival(poolId: string): Promise<RidePool | null>;
  rejectDriverArrival(poolId: string): Promise<RidePool | null>;
  getPassengerManifests(poolId: string): Promise<PassengerManifest[]>;
  getConfirmedPassengerTelegramIds(poolId: string): Promise<string[]>;
  requestEarlyDispatch(poolId: string, captainTelegramId: string): Promise<void>;
  setEarlyDispatchVote(
    poolId: string,
    telegramId: string,
    vote: Exclude<EarlyDispatchVote, 'pending'>
  ): Promise<PoolPassenger | null>;
  getEarlyDispatchSummary(poolId: string): Promise<{
    accepted: number;
    rejected: number;
    pending: number;
    total: number;
  }>;
  clearEarlyDispatch(poolId: string): Promise<void>;
  completeAssignedPoolByPin(pinCode: string, driverTelegramId: string): Promise<RidePool | null>;
  getActivePoolForPassenger(
    telegramId: string
  ): Promise<{ pool: RidePool; passenger: PoolPassenger } | null>;
  insertPoolEvent(input: PoolEventInput): Promise<void>;
  getCompletedIdempotency(key: string, requestHash: string): Promise<unknown | null>;
  createIdempotencyProcessing(input: {
    key: string;
    source: string;
    actorTelegramId: string | null;
    requestHash: string;
    expiresAt: Date;
  }): Promise<'created' | 'exists'>;
  completeIdempotency(key: string, response: unknown): Promise<void>;
  failIdempotency(key: string, error: string): Promise<void>;
  enqueueNotification(input: NotificationOutboxInput): Promise<string>;
  enqueueNotifications(inputs: NotificationOutboxInput[]): Promise<string[]>;
}

export type PaymentRequiredResult = {
  kind: 'payment_required';
  pool: RidePool;
  passenger: PoolPassenger;
};

export type WorkflowChannelMismatchResult = {
  kind: 'workflow_channel_mismatch';
  pool: RidePool;
};

export type CreatePoolResult =
  | PaymentRequiredResult
  | WorkflowChannelMismatchResult
  | { kind: 'route_price_not_set' }
  | { kind: 'active_pool_exists'; pool: RidePool; passenger: PoolPassenger }
  | { kind: 'route_not_found' };

export type JoinPoolResult =
  | PaymentRequiredResult
  | WorkflowChannelMismatchResult
  | { kind: 'pool_not_joinable' }
  | { kind: 'active_pool_exists'; pool: RidePool; passenger: PoolPassenger }
  | { kind: 'already_joined'; pool: RidePool; passenger: PoolPassenger };

export type PaymentConfirmationResult =
  | { kind: 'confirmed'; pool: RidePool; passenger: PoolPassenger; passengerCount: number }
  | { kind: 'pool_ready'; pool: RidePool; passenger: PoolPassenger; passengerCount: number }
  | WorkflowChannelMismatchResult
  | { kind: 'not_found' }
  | { kind: 'pool_not_joinable' }
  | { kind: 'already_confirmed'; pool: RidePool; passenger: PoolPassenger; passengerCount: number };

export type PassengerCancelResult =
  | { kind: 'cancelled'; pool: RidePool }
  | WorkflowChannelMismatchResult
  | { kind: 'not_allowed' };

export type DriverAcceptResult =
  | { kind: 'assigned'; pool: RidePool; manifest: PassengerManifest[] }
  | { kind: 'already_taken' };

export type EarlyDispatchRequestResult =
  | { kind: 'requested'; pool: RidePool; passengerIdsToNotify: string[] }
  | { kind: 'early_dispatch_ready'; pool: RidePool }
  | WorkflowChannelMismatchResult
  | { kind: 'not_allowed' };

export type EarlyDispatchVoteResult =
  | { kind: 'vote_recorded'; pool: RidePool }
  | { kind: 'early_dispatch_ready'; pool: RidePool }
  | { kind: 'early_dispatch_cancelled'; pool: RidePool }
  | WorkflowChannelMismatchResult
  | { kind: 'not_allowed' };

export type TripCompletionResult =
  | { kind: 'completed'; pool: RidePool }
  | { kind: 'invalid_pin' };

export type DriverArrivalRequestResult =
  | { kind: 'requested'; pool: RidePool; captainTelegramId: string; passengerIdsToNotify: string[] }
  | { kind: 'not_allowed' };

export type DriverArrivalDecisionResult =
  | { kind: 'confirmed'; pool: RidePool }
  | { kind: 'rejected'; pool: RidePool }
  | WorkflowChannelMismatchResult
  | { kind: 'not_allowed' };

export interface RidePoolServiceOptions {
  poolSize?: number;
  generatePin?: () => string | Promise<string>;
}

export class RidePoolService {
  readonly poolSize: number;

  constructor(
    private readonly store: RidePoolStore,
    private readonly options: RidePoolServiceOptions = {}
  ) {
    this.poolSize = options.poolSize ?? 4;
  }

  async findOpenPoolForRoute(
    routeId: string,
    workflowChannel: WorkflowChannel = 'telegram'
  ): Promise<RidePool | null> {
    return this.store.findOpenPoolByRoute(routeId, this.poolSize, workflowChannel);
  }

  async createPool(
    routeId: string,
    captainTelegramId: string,
    workflowChannel: WorkflowChannel = 'telegram'
  ): Promise<CreatePoolResult> {
    return this.store.withTransaction(async (store) => {
      const activePool = await store.getActivePoolForPassenger(captainTelegramId);
      if (activePool) {
        if (activePool.pool.workflowChannel !== workflowChannel) {
          return {
            kind: 'workflow_channel_mismatch',
            pool: activePool.pool
          };
        }

        return {
          kind: 'active_pool_exists',
          pool: activePool.pool,
          passenger: activePool.passenger
        };
      }

      const route = await store.getRoute(routeId);
      if (!route?.isActive) {
        return { kind: 'route_not_found' };
      }

      if (route.priceAmount === null) {
        return { kind: 'route_price_not_set' };
      }

      const pinCode = await createUniquePin({
        generateCandidate: this.options.generatePin
          ? async () => String(await this.options.generatePin?.())
          : undefined,
        isPinInUse: (candidate) => store.isPinInUse(candidate)
      });
      const pool = await store.createPool({
        routeId,
        captainTelegramId,
        pinCode,
        workflowChannel
      });
      const passenger = await store.addPassenger(pool.id, captainTelegramId, true);
      await store.insertPoolEvent({
        poolId: pool.id,
        actorTelegramId: captainTelegramId,
        actorRole: 'passenger',
        eventType: 'pool_created',
        fromStatus: null,
        toStatus: 'open',
        metadata: { routeId }
      });
      await store.insertPoolEvent({
        poolId: pool.id,
        actorTelegramId: captainTelegramId,
        actorRole: 'passenger',
        eventType: 'passenger_joined',
        fromStatus: 'open',
        toStatus: 'open',
        metadata: { isCaptain: true }
      });

      return {
        kind: 'payment_required',
        pool,
        passenger
      };
    });
  }

  async joinPool(
    poolId: string,
    telegramId: string,
    workflowChannel: WorkflowChannel = 'telegram'
  ): Promise<JoinPoolResult> {
    return this.store.withTransaction(async (store) => {
      const activePool = await store.getActivePoolForPassenger(telegramId);
      if (activePool && activePool.pool.workflowChannel !== workflowChannel) {
        return {
          kind: 'workflow_channel_mismatch',
          pool: activePool.pool
        };
      }

      if (activePool && activePool.pool.id !== poolId) {
        return {
          kind: 'active_pool_exists',
          pool: activePool.pool,
          passenger: activePool.passenger
        };
      }

      const pool = await store.getPoolForUpdate(poolId);
      if (!pool) {
        return { kind: 'pool_not_joinable' };
      }

      if (pool.workflowChannel !== workflowChannel) {
        return {
          kind: 'workflow_channel_mismatch',
          pool
        };
      }

      const existingPassenger = await store.getPassenger(pool.id, telegramId);
      if (existingPassenger && existingPassenger.paymentStatus !== 'cancelled') {
        return {
          kind: 'already_joined',
          pool,
          passenger: existingPassenger
        };
      }

      if (
        pool.status !== 'open' ||
        pool.passengerCount <= 0 ||
        pool.passengerCount >= this.poolSize ||
        pool.priceAmount === null
      ) {
        return { kind: 'pool_not_joinable' };
      }

      const passenger = await store.addPassenger(pool.id, telegramId, false);
      await store.insertPoolEvent({
        poolId: pool.id,
        actorTelegramId: telegramId,
        actorRole: 'passenger',
        eventType: 'passenger_joined',
        fromStatus: pool.status,
        toStatus: pool.status,
        metadata: { isCaptain: false }
      });
      return {
        kind: 'payment_required',
        pool,
        passenger
      };
    });
  }

  async cancelPendingPayment(poolId: string, telegramId: string): Promise<boolean> {
    return this.store.withTransaction((store) => store.removePendingPassenger(poolId, telegramId));
  }

  async cancelBeforeDispatch(
    poolId: string,
    telegramId: string,
    workflowChannel: WorkflowChannel = 'telegram'
  ): Promise<PassengerCancelResult> {
    return this.store.withTransaction(async (store) => {
      const currentPool = await store.getPoolForUpdate(poolId);
      if (currentPool && isWrongWorkflow(currentPool, workflowChannel)) {
        return { kind: 'workflow_channel_mismatch', pool: currentPool };
      }
      const passenger = await store.getPassenger(poolId, telegramId);
      if (
        !currentPool ||
        !passenger ||
        !['pending', 'confirmed'].includes(passenger.paymentStatus) ||
        !['open', 'ready'].includes(currentPool.status) ||
        currentPool.driverTelegramId
      ) {
        return { kind: 'not_allowed' };
      }
      const previousPaymentStatus = passenger.paymentStatus;

      const pool = await store.cancelPassengerBeforeDispatch(poolId, telegramId, this.poolSize);
      if (!pool) {
        return { kind: 'not_allowed' };
      }

      await store.insertPoolEvent({
        poolId,
        actorTelegramId: telegramId,
        actorRole: 'passenger',
        eventType: 'passenger_cancelled',
        fromStatus: currentPool.status,
        toStatus: pool.status,
        metadata: {
          previousPaymentStatus,
          passengerCount: pool.passengerCount
        }
      });

      if (pool.status === 'cancelled') {
        await store.insertPoolEvent({
          poolId,
          actorTelegramId: telegramId,
          actorRole: 'passenger',
          eventType: 'pool_cancelled',
          fromStatus: currentPool.status,
          toStatus: 'cancelled',
          metadata: { reason: 'last_passenger_cancelled' }
        });
      }

      return { kind: 'cancelled', pool };
    });
  }

  async confirmPayment(
    poolId: string,
    telegramId: string,
    workflowChannel: WorkflowChannel = 'telegram'
  ): Promise<PaymentConfirmationResult> {
    return this.store.withTransaction(async (store) => {
      const pool = await store.getPoolForUpdate(poolId);
      if (!pool) {
        return { kind: 'not_found' };
      }

      if (pool.workflowChannel !== workflowChannel) {
        return {
          kind: 'workflow_channel_mismatch',
          pool
        };
      }

      const existingPassenger = await store.getPassenger(poolId, telegramId);
      if (!existingPassenger || existingPassenger.paymentStatus === 'cancelled') {
        return { kind: 'not_found' };
      }

      if (existingPassenger.paymentStatus === 'confirmed') {
        return {
          kind: 'already_confirmed',
          pool,
          passenger: existingPassenger,
          passengerCount: pool.passengerCount
        };
      }

      if (pool.status !== 'open' || pool.priceAmount === null) {
        await store.removePendingPassenger(poolId, telegramId);
        return { kind: 'pool_not_joinable' };
      }

      const passenger = await store.confirmPassenger(poolId, telegramId);
      if (!passenger) {
        return { kind: 'not_found' };
      }
      await store.insertPoolEvent({
        poolId,
        actorTelegramId: telegramId,
        actorRole: 'passenger',
        eventType: 'payment_confirmed',
        fromStatus: pool.status,
        toStatus: pool.status,
        metadata: {}
      });

      const refreshedPool = await store.getPoolForUpdate(poolId);
      if (!refreshedPool) {
        return { kind: 'not_found' };
      }

      if (refreshedPool.status === 'open' && refreshedPool.passengerCount >= this.poolSize) {
        const readyPool = await store.markPoolReady(poolId);
        readyPool.passengerCount = refreshedPool.passengerCount;
        await store.insertPoolEvent({
          poolId,
          actorTelegramId: telegramId,
          actorRole: 'passenger',
          eventType: 'pool_ready',
          fromStatus: 'open',
          toStatus: 'ready',
          metadata: { passengerCount: refreshedPool.passengerCount }
        });
        return {
          kind: 'pool_ready',
          pool: readyPool,
          passenger,
          passengerCount: refreshedPool.passengerCount
        };
      }

      return {
        kind: 'confirmed',
        pool: refreshedPool,
        passenger,
        passengerCount: refreshedPool.passengerCount
      };
    });
  }

  async markDriverAlertSent(poolId: string, chatId: string, messageId: number): Promise<void> {
    await this.store.markDriverAlertSent(poolId, chatId, messageId);
    await this.store.insertPoolEvent({
      poolId,
      actorTelegramId: null,
      actorRole: 'system',
      eventType: 'driver_alert_sent',
      fromStatus: null,
      toStatus: null,
      metadata: { chatId, messageId }
    });
  }

  async acceptJob(poolId: string, driverTelegramId: string): Promise<DriverAcceptResult> {
    return this.store.withTransaction(async (store) => {
      const pool = await store.assignDriver(poolId, driverTelegramId);
      if (!pool) {
        return { kind: 'already_taken' };
      }

      const manifest = await store.getPassengerManifests(poolId);
      await store.insertPoolEvent({
        poolId,
        actorTelegramId: driverTelegramId,
        actorRole: 'driver',
        eventType: 'driver_assigned',
        fromStatus: 'ready',
        toStatus: 'assigned',
        metadata: {}
      });
      return {
        kind: 'assigned',
        pool,
        manifest
      };
    });
  }

  async requestDriverArrival(
    poolId: string,
    driverTelegramId: string
  ): Promise<DriverArrivalRequestResult> {
    return this.store.withTransaction(async (store) => {
      const pool = await store.getPoolForUpdate(poolId);
      if (!pool || pool.status !== 'assigned' || pool.driverTelegramId !== driverTelegramId) {
        return { kind: 'not_allowed' };
      }

      const requestedPool = await store.requestDriverArrival(poolId);
      if (!requestedPool) {
        return { kind: 'not_allowed' };
      }
      await store.insertPoolEvent({
        poolId,
        actorTelegramId: driverTelegramId,
        actorRole: 'driver',
        eventType: 'arrival_requested',
        fromStatus: 'assigned',
        toStatus: 'arrival_requested',
        metadata: {}
      });

      return {
        kind: 'requested',
        pool: requestedPool,
        captainTelegramId: requestedPool.captainTelegramId,
        passengerIdsToNotify: (await store.getConfirmedPassengerTelegramIds(poolId)).filter(
          (telegramId) => telegramId !== requestedPool.captainTelegramId
        )
      };
    });
  }

  async confirmDriverArrival(
    poolId: string,
    captainTelegramId: string,
    workflowChannel: WorkflowChannel = 'telegram'
  ): Promise<DriverArrivalDecisionResult> {
    return this.store.withTransaction(async (store) => {
      const pool = await store.getPoolForUpdate(poolId);
      if (pool && isWrongWorkflow(pool, workflowChannel)) {
        return { kind: 'workflow_channel_mismatch', pool };
      }
      const passenger = await store.getPassenger(poolId, captainTelegramId);
      if (
        !pool ||
        pool.status !== 'arrival_requested' ||
        passenger?.paymentStatus !== 'confirmed'
      ) {
        return { kind: 'not_allowed' };
      }

      const confirmedPool = await store.confirmDriverArrival(poolId);
      if (!confirmedPool) {
        return { kind: 'not_allowed' };
      }
      await store.insertPoolEvent({
        poolId,
        actorTelegramId: captainTelegramId,
        actorRole: 'passenger',
        eventType: 'arrival_confirmed',
        fromStatus: 'arrival_requested',
        toStatus: 'in_progress',
        metadata: {}
      });

      return {
        kind: 'confirmed',
        pool: confirmedPool
      };
    });
  }

  async rejectDriverArrival(
    poolId: string,
    captainTelegramId: string,
    workflowChannel: WorkflowChannel = 'telegram'
  ): Promise<DriverArrivalDecisionResult> {
    return this.store.withTransaction(async (store) => {
      const pool = await store.getPoolForUpdate(poolId);
      if (pool && isWrongWorkflow(pool, workflowChannel)) {
        return { kind: 'workflow_channel_mismatch', pool };
      }
      const passenger = await store.getPassenger(poolId, captainTelegramId);
      if (
        !pool ||
        pool.status !== 'arrival_requested' ||
        passenger?.paymentStatus !== 'confirmed'
      ) {
        return { kind: 'not_allowed' };
      }

      const rejectedPool = await store.rejectDriverArrival(poolId);
      if (!rejectedPool) {
        return { kind: 'not_allowed' };
      }
      await store.insertPoolEvent({
        poolId,
        actorTelegramId: captainTelegramId,
        actorRole: 'passenger',
        eventType: 'arrival_rejected',
        fromStatus: 'arrival_requested',
        toStatus: 'assigned',
        metadata: {}
      });

      return {
        kind: 'rejected',
        pool: rejectedPool
      };
    });
  }

  async requestEarlyDispatch(
    poolId: string,
    captainTelegramId: string,
    workflowChannel: WorkflowChannel = 'telegram'
  ): Promise<EarlyDispatchRequestResult> {
    return this.store.withTransaction(async (store) => {
      const pool = await store.getPoolForUpdate(poolId);
      if (pool && isWrongWorkflow(pool, workflowChannel)) {
        return { kind: 'workflow_channel_mismatch', pool };
      }
      const passenger = await store.getPassenger(poolId, captainTelegramId);
      if (
        !pool ||
        pool.status !== 'open' ||
        pool.passengerCount < 1 ||
        pool.passengerCount >= this.poolSize ||
        !passenger?.isCaptain ||
        passenger.paymentStatus !== 'confirmed'
      ) {
        return { kind: 'not_allowed' };
      }

      await store.requestEarlyDispatch(poolId, captainTelegramId);
      if (pool.passengerCount === 1) {
        const readyPool = await store.markPoolReady(poolId, true);
        await store.insertPoolEvent({
          poolId,
          actorTelegramId: captainTelegramId,
          actorRole: 'passenger',
          eventType: 'pool_ready',
          fromStatus: 'open',
          toStatus: 'ready',
          metadata: { earlyDispatch: true }
        });
        return {
          kind: 'early_dispatch_ready',
          pool: readyPool
        };
      }

      return {
        kind: 'requested',
        pool,
        passengerIdsToNotify: (await store.getConfirmedPassengerTelegramIds(poolId)).filter(
          (telegramId) => telegramId !== captainTelegramId
        )
      };
    });
  }

  async voteEarlyDispatch(
    poolId: string,
    telegramId: string,
    vote: Exclude<EarlyDispatchVote, 'pending'>,
    workflowChannel: WorkflowChannel = 'telegram'
  ): Promise<EarlyDispatchVoteResult> {
    return this.store.withTransaction(async (store) => {
      const pool = await store.getPoolForUpdate(poolId);
      if (pool && isWrongWorkflow(pool, workflowChannel)) {
        return { kind: 'workflow_channel_mismatch', pool };
      }
      if (!pool || pool.status !== 'open' || !pool.earlyDispatchRequestedAt) {
        return { kind: 'not_allowed' };
      }

      const passenger = await store.setEarlyDispatchVote(poolId, telegramId, vote);
      if (!passenger) {
        return { kind: 'not_allowed' };
      }

      if (vote === 'rejected') {
        await store.clearEarlyDispatch(poolId);
        const refreshedPool = await store.getPoolForUpdate(poolId);
        return {
          kind: 'early_dispatch_cancelled',
          pool: refreshedPool ?? pool
        };
      }

      const summary = await store.getEarlyDispatchSummary(poolId);
      if (summary.total > 0 && summary.rejected === 0 && summary.pending === 0) {
        const readyPool = await store.markPoolReady(poolId, true);
        await store.insertPoolEvent({
          poolId,
          actorTelegramId: telegramId,
          actorRole: 'passenger',
          eventType: 'pool_ready',
          fromStatus: 'open',
          toStatus: 'ready',
          metadata: { earlyDispatch: true }
        });
        return {
          kind: 'early_dispatch_ready',
          pool: readyPool
        };
      }

      return {
        kind: 'vote_recorded',
        pool
      };
    });
  }

  async completeTrip(pinCode: string, driverTelegramId: string): Promise<TripCompletionResult> {
    const normalizedPin = pinCode.trim();
    if (!/^\d{4}$/.test(normalizedPin)) {
      return { kind: 'invalid_pin' };
    }

    return this.store.withTransaction(async (store) => {
      const pool = await store.completeAssignedPoolByPin(normalizedPin, driverTelegramId);
      if (!pool) {
        return { kind: 'invalid_pin' };
      }

      await store.insertPoolEvent({
        poolId: pool.id,
        actorTelegramId: driverTelegramId,
        actorRole: 'driver',
        eventType: 'trip_completed',
        fromStatus: 'in_progress',
        toStatus: 'completed',
        metadata: {}
      });

      return {
        kind: 'completed',
        pool
      };
    });
  }
}

function isWrongWorkflow(pool: RidePool, workflowChannel: WorkflowChannel): boolean {
  return pool.workflowChannel !== workflowChannel;
}
