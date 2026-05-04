import { performance } from 'node:perf_hooks';

import {
  RidePoolService,
  type CreatePoolInput,
  type RidePoolStore
} from '../src/domain/ridePoolService.js';
import type {
  EarlyDispatchVote,
  NotificationOutboxInput,
  PassengerManifest,
  PoolEventInput,
  PoolPassenger,
  RidePool,
  Route,
  TelegramUserProfile
} from '../src/domain/types.js';

class LoadTestStore implements RidePoolStore {
  readonly routes = new Map<string, Route>();
  readonly pools = new Map<string, RidePool>();
  readonly passengers = new Map<string, PoolPassenger>();
  readonly events: PoolEventInput[] = [];
  readonly notifications: NotificationOutboxInput[] = [];
  private nextPoolId = 1;
  private transactionTail = Promise.resolve();

  constructor(routes: Route[]) {
    for (const route of routes) {
      this.routes.set(route.id, route);
    }
  }

  async withTransaction<T>(work: (store: RidePoolStore) => Promise<T>): Promise<T> {
    const next = this.transactionTail.then(() => work(this));
    this.transactionTail = next.then(
      () => undefined,
      () => undefined
    );
    return next;
  }

  async getRoute(routeId: string): Promise<Route | null> {
    return this.routes.get(routeId) ?? null;
  }

  async getUserProfile(telegramId: string): Promise<TelegramUserProfile | null> {
    return {
      telegramId,
      firstName: telegramId.startsWith('driver') ? 'Driver' : 'Passenger',
      lastName: telegramId,
      username: telegramId.replace(/[^a-zA-Z0-9_]/g, '_').toLowerCase(),
      phoneNumber: `+251900${telegramId.replace(/\D/g, '').padStart(6, '0').slice(-6)}`,
      role: telegramId.startsWith('driver') ? 'driver' : 'passenger'
    };
  }

  async isPinInUse(pinCode: string): Promise<boolean> {
    return [...this.pools.values()].some((pool) => pool.pinCode === pinCode);
  }

  async createPool(input: CreatePoolInput): Promise<RidePool> {
    const route = this.routes.get(input.routeId);
    if (!route) {
      throw new Error(`Missing route ${input.routeId}`);
    }

    const pool: RidePool = {
      id: String(this.nextPoolId++),
      routeId: route.id,
      routeName: route.name,
      workflowChannel: input.workflowChannel,
      pinCode: input.pinCode,
      captainTelegramId: input.captainTelegramId,
      status: 'open',
      passengerCount: 0,
      driverTelegramId: null,
      driverAlertMessageId: null,
      driverGroupChatId: null,
      isEarlyDispatch: false,
      earlyDispatchRequestedAt: null,
      arrivalRequestedAt: null,
      arrivedAt: null,
      priceAmount: route.priceAmount,
      priceCurrency: route.priceCurrency
    };
    this.pools.set(pool.id, pool);
    return pool;
  }

  async findOpenPoolByRoute(
    routeId: string,
    passengerLimit: number,
    workflowChannel = 'telegram'
  ): Promise<RidePool | null> {
    return (
      [...this.pools.values()].find(
        (pool) =>
          pool.routeId === routeId &&
          pool.workflowChannel === workflowChannel &&
          pool.status === 'open' &&
          pool.passengerCount < passengerLimit
      ) ?? null
    );
  }

  async getPoolForUpdate(poolId: string): Promise<RidePool | null> {
    return this.pools.get(poolId) ?? null;
  }

  async getPassenger(poolId: string, telegramId: string): Promise<PoolPassenger | null> {
    return this.passengers.get(`${poolId}:${telegramId}`) ?? null;
  }

  async addPassenger(poolId: string, telegramId: string, isCaptain: boolean): Promise<PoolPassenger> {
    const passenger: PoolPassenger = {
      poolId,
      telegramId,
      isCaptain,
      paymentStatus: 'pending',
      earlyDispatchVote: 'pending'
    };
    this.passengers.set(`${poolId}:${telegramId}`, passenger);
    return passenger;
  }

  async confirmPassenger(poolId: string, telegramId: string): Promise<PoolPassenger | null> {
    const passenger = await this.getPassenger(poolId, telegramId);
    const pool = this.pools.get(poolId);
    if (!passenger || !pool) {
      return null;
    }

    passenger.paymentStatus = 'confirmed';
    pool.passengerCount = this.confirmedPassengers(poolId).length;
    return passenger;
  }

  async removePendingPassenger(poolId: string, telegramId: string): Promise<boolean> {
    const passenger = await this.getPassenger(poolId, telegramId);
    if (!passenger || passenger.paymentStatus !== 'pending') {
      return false;
    }
    passenger.paymentStatus = 'cancelled';
    return true;
  }

  async cancelPassengerBeforeDispatch(
    poolId: string,
    telegramId: string,
    passengerLimit: number
  ): Promise<RidePool | null> {
    const pool = this.pools.get(poolId);
    const passenger = await this.getPassenger(poolId, telegramId);
    if (!pool || !passenger || pool.driverTelegramId || !['open', 'ready'].includes(pool.status)) {
      return null;
    }

    passenger.paymentStatus = 'cancelled';
    passenger.isCaptain = false;
    const confirmed = this.confirmedPassengers(poolId);
    pool.passengerCount = confirmed.length;
    if (!confirmed.some((item) => item.isCaptain) && confirmed[0]) {
      confirmed[0].isCaptain = true;
      pool.captainTelegramId = confirmed[0].telegramId;
    }
    if (pool.passengerCount === 0) {
      pool.status = 'cancelled';
    } else if (pool.passengerCount < passengerLimit) {
      pool.status = 'open';
    }
    return pool;
  }

  async markPoolReady(poolId: string, isEarlyDispatch = false): Promise<RidePool> {
    const pool = this.pools.get(poolId);
    if (!pool) {
      throw new Error(`Missing pool ${poolId}`);
    }
    pool.status = 'ready';
    pool.isEarlyDispatch = isEarlyDispatch;
    return pool;
  }

  async markDriverAlertSent(poolId: string, chatId: string, messageId: number): Promise<void> {
    const pool = this.pools.get(poolId);
    if (pool) {
      pool.driverGroupChatId = chatId;
      pool.driverAlertMessageId = messageId;
    }
  }

  async assignDriver(poolId: string, driverTelegramId: string): Promise<RidePool | null> {
    const pool = this.pools.get(poolId);
    if (!pool || pool.status !== 'ready' || pool.driverTelegramId) {
      return null;
    }
    pool.status = 'assigned';
    pool.driverTelegramId = driverTelegramId;
    return pool;
  }

  async requestDriverArrival(poolId: string): Promise<RidePool | null> {
    const pool = this.pools.get(poolId);
    if (!pool || pool.status !== 'assigned') {
      return null;
    }
    pool.status = 'arrival_requested';
    pool.arrivalRequestedAt = new Date();
    return pool;
  }

  async confirmDriverArrival(poolId: string): Promise<RidePool | null> {
    const pool = this.pools.get(poolId);
    if (!pool || pool.status !== 'arrival_requested') {
      return null;
    }
    pool.status = 'in_progress';
    pool.arrivedAt = new Date();
    return pool;
  }

  async rejectDriverArrival(poolId: string): Promise<RidePool | null> {
    const pool = this.pools.get(poolId);
    if (!pool || pool.status !== 'arrival_requested') {
      return null;
    }
    pool.status = 'assigned';
    pool.arrivalRequestedAt = null;
    return pool;
  }

  async getPassengerManifests(poolId: string): Promise<PassengerManifest[]> {
    return Promise.all(
      this.confirmedPassengers(poolId).map(async (passenger) => {
        const profile = await this.getUserProfile(passenger.telegramId);
        return {
          telegramId: passenger.telegramId,
          displayName: `${profile?.firstName ?? 'Passenger'} ${profile?.lastName ?? ''}`.trim(),
          username: profile?.username ?? null,
          phoneNumber: profile?.phoneNumber ?? null,
          pickupLocation: null
        };
      })
    );
  }

  async getConfirmedPassengerTelegramIds(poolId: string): Promise<string[]> {
    return this.confirmedPassengers(poolId).map((passenger) => passenger.telegramId);
  }

  async requestEarlyDispatch(poolId: string, captainTelegramId: string): Promise<void> {
    const pool = this.pools.get(poolId);
    if (pool) {
      pool.earlyDispatchRequestedAt = new Date();
    }
    for (const passenger of this.confirmedPassengers(poolId)) {
      passenger.earlyDispatchVote = passenger.telegramId === captainTelegramId ? 'accepted' : 'pending';
    }
  }

  async setEarlyDispatchVote(
    poolId: string,
    telegramId: string,
    vote: Exclude<EarlyDispatchVote, 'pending'>
  ): Promise<PoolPassenger | null> {
    const passenger = await this.getPassenger(poolId, telegramId);
    if (!passenger || passenger.paymentStatus !== 'confirmed') {
      return null;
    }
    passenger.earlyDispatchVote = vote;
    return passenger;
  }

  async getEarlyDispatchSummary(poolId: string): Promise<{
    accepted: number;
    rejected: number;
    pending: number;
    total: number;
  }> {
    const confirmed = this.confirmedPassengers(poolId);
    return {
      accepted: confirmed.filter((passenger) => passenger.earlyDispatchVote === 'accepted').length,
      rejected: confirmed.filter((passenger) => passenger.earlyDispatchVote === 'rejected').length,
      pending: confirmed.filter((passenger) => passenger.earlyDispatchVote === 'pending').length,
      total: confirmed.length
    };
  }

  async clearEarlyDispatch(poolId: string): Promise<void> {
    const pool = this.pools.get(poolId);
    if (pool) {
      pool.earlyDispatchRequestedAt = null;
      pool.isEarlyDispatch = false;
    }
    for (const passenger of this.confirmedPassengers(poolId)) {
      passenger.earlyDispatchVote = 'pending';
    }
  }

  async completeAssignedPoolByPin(pinCode: string, driverTelegramId: string): Promise<RidePool | null> {
    const pool = [...this.pools.values()].find(
      (candidate) =>
        candidate.pinCode === pinCode &&
        candidate.driverTelegramId === driverTelegramId &&
        candidate.status === 'in_progress'
    );
    if (!pool) {
      return null;
    }
    pool.status = 'completed';
    return pool;
  }

  async getActivePoolForPassenger(
    telegramId: string
  ): Promise<{ pool: RidePool; passenger: PoolPassenger } | null> {
    const passenger = [...this.passengers.values()]
      .filter((item) => {
        const pool = this.pools.get(item.poolId);
        return (
          item.telegramId === telegramId &&
          (
            (item.paymentStatus === 'pending' && pool?.status === 'open') ||
            (item.paymentStatus === 'confirmed' &&
              Boolean(pool && ['open', 'ready', 'assigned', 'arrival_requested', 'in_progress'].includes(pool.status)))
          )
        );
      })
      .at(-1);
    const pool = passenger ? this.pools.get(passenger.poolId) : null;
    return passenger && pool ? { pool, passenger } : null;
  }

  async insertPoolEvent(input: PoolEventInput): Promise<void> {
    this.events.push(input);
  }

  async getCompletedIdempotency(): Promise<unknown | null> {
    return null;
  }

  async createIdempotencyProcessing(): Promise<'created' | 'exists'> {
    return 'created';
  }

  async completeIdempotency(): Promise<void> {}

  async failIdempotency(): Promise<void> {}

  async enqueueNotification(input: NotificationOutboxInput): Promise<string> {
    this.notifications.push(input);
    return String(this.notifications.length);
  }

  async enqueueNotifications(inputs: NotificationOutboxInput[]): Promise<string[]> {
    this.notifications.push(...inputs);
    return inputs.map((_, index) => String(this.notifications.length - inputs.length + index + 1));
  }

  private confirmedPassengers(poolId: string): PoolPassenger[] {
    return [...this.passengers.values()].filter(
      (passenger) => passenger.poolId === poolId && passenger.paymentStatus === 'confirmed'
    );
  }
}

async function main() {
  const usersPerDay = Number(process.env.LOAD_TEST_USERS ?? '1200');
  const seatsPerDay = Number(process.env.LOAD_TEST_SEATS ?? '300');
  const poolSize = Number(process.env.POOL_SIZE ?? '4');
  const poolCount = Math.ceil(seatsPerDay / poolSize);
  const route: Route = {
    id: 'mexico-bole',
    name: 'Mexico -> Bole',
    isActive: true,
    priceAmount: 85,
    priceCurrency: 'ETB'
  };
  const store = new LoadTestStore([route]);
  let nextPin = 1000;
  const service = new RidePoolService(store, {
    poolSize,
    generatePin: () => String(nextPin++).padStart(4, '0')
  });

  const startedAt = performance.now();
  const routeLookups = await Promise.all(
    Array.from({ length: usersPerDay }, () => store.findOpenPoolByRoute(route.id, poolSize))
  );
  const acceptedJobs: string[] = [];
  let completedPools = 0;

  for (let poolIndex = 0; poolIndex < poolCount; poolIndex += 1) {
    const firstPassengerNumber = poolIndex * poolSize + 1;
    const captainTelegramId = `passenger-${firstPassengerNumber}`;
    const created = await service.createPool(route.id, captainTelegramId);
    if (created.kind !== 'payment_required') {
      throw new Error(`Expected payment_required, got ${created.kind}`);
    }
    const createdPool = created.pool;

    await confirmSeat(service, createdPool.id, captainTelegramId);
    for (let offset = 1; offset < poolSize; offset += 1) {
      const telegramId = `passenger-${firstPassengerNumber + offset}`;
      const joined = await service.joinPool(createdPool.id, telegramId);
      assertKind(joined.kind, 'payment_required');
      await confirmSeat(service, createdPool.id, telegramId);
    }

    const driverAttempts = Array.from({ length: 10 }, (_, index) =>
      service.acceptJob(createdPool.id, `driver-${poolIndex}-${index}`)
    );
    const acceptResults = await Promise.all(driverAttempts);
    const winners = acceptResults.filter((result) => result.kind === 'assigned');
    if (winners.length !== 1 || winners[0].kind !== 'assigned') {
      throw new Error(`Expected exactly one driver to win pool ${createdPool.id}, got ${winners.length}`);
    }
    const assignedDriverId = winners[0].pool.driverTelegramId;
    if (!assignedDriverId) {
      throw new Error(`Pool ${createdPool.id} did not record the assigned driver`);
    }
    acceptedJobs.push(assignedDriverId);

    const arrivalRequested = await service.requestDriverArrival(createdPool.id, assignedDriverId);
    assertKind(arrivalRequested.kind, 'requested');
    const arrivalConfirmed = await service.confirmDriverArrival(createdPool.id, captainTelegramId);
    assertKind(arrivalConfirmed.kind, 'confirmed');
    const completed = await service.completeTrip(createdPool.pinCode, assignedDriverId);
    assertKind(completed.kind, 'completed');
    completedPools += 1;
  }

  const durationMs = Math.round(performance.now() - startedAt);
  const completedSeats = completedPools * poolSize;
  if (completedSeats < seatsPerDay) {
    throw new Error(`Expected at least ${seatsPerDay} completed seats, got ${completedSeats}`);
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        usersSimulated: usersPerDay,
        routeLookups: routeLookups.length,
        seatsTarget: seatsPerDay,
        seatsCompleted: completedSeats,
        poolsCompleted: completedPools,
        concurrentAcceptAttemptsPerPool: 10,
        acceptedJobs: acceptedJobs.length,
        rejectedDuplicateDriverClicks: completedPools * 9,
        poolEvents: store.events.length,
        notificationJobs: store.notifications.length,
        durationMs
      },
      null,
      2
    )
  );
}

async function confirmSeat(service: RidePoolService, poolId: string, telegramId: string): Promise<void> {
  const result = await service.confirmPayment(poolId, telegramId);
  if (!['confirmed', 'pool_ready', 'already_confirmed'].includes(result.kind)) {
    throw new Error(`Unexpected confirmation result for ${telegramId}: ${result.kind}`);
  }
}

function assertKind(actual: string, expected: string): void {
  if (actual !== expected) {
    throw new Error(`Expected ${expected}, got ${actual}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
