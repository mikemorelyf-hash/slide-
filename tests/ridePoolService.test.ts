import {
  RidePoolService,
  type CreatePoolInput,
  type RidePoolStore
} from '../src/domain/ridePoolService.js';
import type {
  NotificationOutboxInput,
  PassengerManifest,
  PoolPassenger,
  PoolEventInput,
  RidePool,
  Route,
  TelegramUserProfile,
  WorkflowChannel
} from '../src/domain/types.js';

class FakeRidePoolStore implements RidePoolStore {
  readonly routes = new Map<string, Route>();
  readonly pools = new Map<string, RidePool>();
  readonly passengers = new Map<string, PoolPassenger>();
  readonly events: PoolEventInput[] = [];
  readonly notifications: NotificationOutboxInput[] = [];
  private nextPoolId = 1;

  constructor(routes: Route[]) {
    for (const route of routes) {
      this.routes.set(route.id, route);
    }
  }

  async withTransaction<T>(work: (store: RidePoolStore) => Promise<T>): Promise<T> {
    return work(this);
  }

  async getRoute(routeId: string): Promise<Route | null> {
    return this.routes.get(routeId) ?? null;
  }

  async getUserProfile(telegramId: string): Promise<TelegramUserProfile | null> {
    return {
      telegramId,
      firstName: `User ${telegramId}`,
      lastName: null,
      username: null,
      role: 'passenger'
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
      routeId: input.routeId,
      routeName: route.name,
      workflowChannel: input.workflowChannel,
      priceAmount: route.priceAmount,
      priceCurrency: route.priceCurrency,
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
      arrivedAt: null
    };
    this.pools.set(pool.id, pool);
    return pool;
  }

  async findOpenPoolByRoute(
    routeId: string,
    passengerLimit: number,
    workflowChannel: WorkflowChannel = 'telegram'
  ): Promise<RidePool | null> {
    return (
      [...this.pools.values()].find(
        (pool) =>
          pool.routeId === routeId &&
          pool.workflowChannel === workflowChannel &&
          pool.status === 'open' &&
          pool.passengerCount > 0 &&
          pool.passengerCount < passengerLimit &&
          !pool.driverAlertMessageId
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
    if (!passenger) {
      return null;
    }

    passenger.paymentStatus = 'confirmed';
    const pool = this.pools.get(poolId);
    if (pool) {
      pool.passengerCount = [...this.passengers.values()].filter(
        (item) => item.poolId === poolId && item.paymentStatus === 'confirmed'
      ).length;
    }
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
    if (
      !pool ||
      !passenger ||
      !['open', 'ready'].includes(pool.status) ||
      pool.driverTelegramId ||
      !['pending', 'confirmed'].includes(passenger.paymentStatus)
    ) {
      return null;
    }

    passenger.paymentStatus = 'cancelled';
    passenger.isCaptain = false;
    const confirmedPassengers = [...this.passengers.values()].filter(
      (item) => item.poolId === poolId && item.paymentStatus === 'confirmed'
    );
    pool.passengerCount = confirmedPassengers.length;

    if (!confirmedPassengers.some((item) => item.isCaptain)) {
      const nextCaptain = confirmedPassengers[0];
      if (nextCaptain) {
        nextCaptain.isCaptain = true;
        pool.captainTelegramId = nextCaptain.telegramId;
      }
    }

    if (pool.passengerCount === 0) {
      pool.status = 'cancelled';
    } else if (pool.status === 'ready' && pool.passengerCount < passengerLimit) {
      pool.status = 'open';
      pool.driverGroupChatId = null;
      pool.driverAlertMessageId = null;
      pool.isEarlyDispatch = false;
      pool.earlyDispatchRequestedAt = null;
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
    return [...this.passengers.values()]
      .filter((passenger) => passenger.poolId === poolId && passenger.paymentStatus === 'confirmed')
      .map((passenger) => ({
        telegramId: passenger.telegramId,
        displayName: `Passenger ${passenger.telegramId}`,
        username: null,
        phoneNumber: null,
        pickupLocation: null
      }));
  }

  async getConfirmedPassengerTelegramIds(poolId: string): Promise<string[]> {
    return [...this.passengers.values()]
      .filter((passenger) => passenger.poolId === poolId && passenger.paymentStatus === 'confirmed')
      .map((passenger) => passenger.telegramId);
  }

  async requestEarlyDispatch(poolId: string, captainTelegramId: string): Promise<void> {
    const pool = this.pools.get(poolId);
    if (pool) {
      pool.earlyDispatchRequestedAt = new Date();
    }

    for (const passenger of this.passengers.values()) {
      if (passenger.poolId === poolId && passenger.paymentStatus === 'confirmed') {
        passenger.earlyDispatchVote = passenger.telegramId === captainTelegramId ? 'accepted' : 'pending';
      }
    }
  }

  async setEarlyDispatchVote(
    poolId: string,
    telegramId: string,
    vote: 'accepted' | 'rejected'
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
    const confirmed = [...this.passengers.values()].filter(
      (passenger) => passenger.poolId === poolId && passenger.paymentStatus === 'confirmed'
    );
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

    for (const passenger of this.passengers.values()) {
      if (passenger.poolId === poolId) {
        passenger.earlyDispatchVote = 'pending';
      }
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

    if (!passenger) {
      return null;
    }

    const pool = this.pools.get(passenger.poolId);
    return pool ? { pool, passenger } : null;
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
}

const route: Route = {
  id: '1',
  name: 'Mexico -> Bole',
  isActive: true,
  priceAmount: 120,
  priceCurrency: 'ETB'
};

const unpricedRoute: Route = {
  id: '2',
  name: 'Mexico -> Hayat',
  isActive: true,
  priceAmount: null,
  priceCurrency: 'ETB'
};

describe('RidePoolService', () => {
  it('keeps Telegram and Mini App open-pool discovery separate', async () => {
    const store = new FakeRidePoolStore([route]);
    const service = new RidePoolService(store, {
      poolSize: 4,
      generatePin: async () => '4334'
    });

    const miniAppPool = await service.createPool('1', '101', 'mini_app');
    expect(miniAppPool.kind).toBe('payment_required');
    if (miniAppPool.kind !== 'payment_required') {
      throw new Error('Expected Mini App pool creation to require payment');
    }
    await service.confirmPayment(miniAppPool.pool.id, '101', 'mini_app');

    await expect(service.findOpenPoolForRoute('1', 'telegram')).resolves.toBeNull();
    await expect(service.findOpenPoolForRoute('1', 'mini_app')).resolves.toMatchObject({
      id: miniAppPool.pool.id,
      workflowChannel: 'mini_app'
    });
  });

  it('blocks joining a pool from the wrong workflow channel', async () => {
    const store = new FakeRidePoolStore([route]);
    const service = new RidePoolService(store, {
      poolSize: 4,
      generatePin: async () => '4334'
    });

    const miniAppPool = await service.createPool('1', '101', 'mini_app');
    expect(miniAppPool.kind).toBe('payment_required');
    if (miniAppPool.kind !== 'payment_required') {
      throw new Error('Expected Mini App pool creation to require payment');
    }
    await service.confirmPayment(miniAppPool.pool.id, '101', 'mini_app');

    const wrongChannelJoin = await service.joinPool(miniAppPool.pool.id, '102', 'telegram');
    const appJoin = await service.joinPool(miniAppPool.pool.id, '102', 'mini_app');

    expect(wrongChannelJoin.kind).toBe('workflow_channel_mismatch');
    expect(appJoin.kind).toBe('payment_required');
  });

  it('creates a pool and marks it ready only after the fourth passenger confirms payment', async () => {
    const store = new FakeRidePoolStore([route]);
    const service = new RidePoolService(store, {
      poolSize: 4,
      generatePin: async () => '4334'
    });

    const created = await service.createPool('1', '101');
    expect(created.kind).toBe('payment_required');
    if (created.kind !== 'payment_required') {
      throw new Error('Expected payment_required when creating a pool');
    }
    expect(created.pool.pinCode).toBe('4334');

    const firstConfirmation = await service.confirmPayment(created.pool.id, '101');
    expect(firstConfirmation.kind).toBe('confirmed');

    for (const telegramId of ['102', '103', '104']) {
      const joined = await service.joinPool(created.pool.id, telegramId);
      expect(joined.kind).toBe('payment_required');
    }

    await service.confirmPayment(created.pool.id, '102');
    await service.confirmPayment(created.pool.id, '103');
    const ready = await service.confirmPayment(created.pool.id, '104');

    expect(ready.kind).toBe('pool_ready');
    if (ready.kind !== 'pool_ready') {
      throw new Error('Expected pool_ready after fourth confirmed passenger');
    }
    expect(ready.passengerCount).toBe(4);
    expect(store.pools.get(created.pool.id)?.status).toBe('ready');
  });

  it('prevents a passenger from joining or creating another active pool', async () => {
    const store = new FakeRidePoolStore([route]);
    const pins = ['4334', '4335'];
    const service = new RidePoolService(store, {
      poolSize: 4,
      generatePin: async () => pins.shift() ?? '9999'
    });

    const created = await service.createPool('1', '101');
    expect(created.kind).toBe('payment_required');
    if (created.kind !== 'payment_required') {
      throw new Error('Expected first pool creation to require payment');
    }

    const secondCreate = await service.createPool('1', '101');
    const secondJoin = await service.joinPool(created.pool.id, '101');

    expect(secondCreate.kind).toBe('active_pool_exists');
    expect(secondJoin.kind).toBe('already_joined');
  });

  it('does not let another passenger join a pool until the creator confirms payment', async () => {
    const store = new FakeRidePoolStore([route]);
    const service = new RidePoolService(store, {
      poolSize: 4,
      generatePin: async () => '4334'
    });

    const created = await service.createPool('1', '101');
    expect(created.kind).toBe('payment_required');
    if (created.kind !== 'payment_required') {
      throw new Error('Expected first pool creation to require payment');
    }

    const beforeCaptainPays = await service.joinPool(created.pool.id, '102');
    expect(beforeCaptainPays.kind).toBe('pool_not_joinable');

    await service.confirmPayment(created.pool.id, '101');

    const afterCaptainPays = await service.joinPool(created.pool.id, '102');
    expect(afterCaptainPays.kind).toBe('payment_required');
  });

  it('lets a confirmed passenger cancel a ready pool before a driver accepts', async () => {
    const store = new FakeRidePoolStore([route]);
    const pins = ['4334', '4335'];
    const service = new RidePoolService(store, {
      poolSize: 4,
      generatePin: async () => pins.shift() ?? '9999'
    });

    const created = await service.createPool('1', '101');
    expect(created.kind).toBe('payment_required');
    if (created.kind !== 'payment_required') {
      throw new Error('Expected payment_required when creating a pool');
    }

    await service.confirmPayment(created.pool.id, '101');
    for (const telegramId of ['102', '103', '104']) {
      await service.joinPool(created.pool.id, telegramId);
      await service.confirmPayment(created.pool.id, telegramId);
    }
    expect(store.pools.get(created.pool.id)?.status).toBe('ready');

    const cancelled = await service.cancelBeforeDispatch(created.pool.id, '101');

    expect(cancelled.kind).toBe('cancelled');
    if (cancelled.kind !== 'cancelled') {
      throw new Error('Expected confirmed passenger cancellation to succeed');
    }
    expect(cancelled.pool.status).toBe('open');
    expect(cancelled.pool.passengerCount).toBe(3);
    expect(cancelled.pool.captainTelegramId).toBe('102');
    await expect(store.getActivePoolForPassenger('101')).resolves.toBeNull();
    expect(store.events.at(-1)).toMatchObject({
      poolId: created.pool.id,
      actorTelegramId: '101',
      eventType: 'passenger_cancelled'
    });

    const nextPool = await service.createPool('1', '101');
    expect(nextPool.kind).toBe('payment_required');
  });

  it('does not create pools on routes without a price', async () => {
    const store = new FakeRidePoolStore([unpricedRoute]);
    const service = new RidePoolService(store, {
      poolSize: 4,
      generatePin: async () => '4334'
    });

    const created = await service.createPool('2', '101');

    expect(created.kind).toBe('route_price_not_set');
    expect(store.pools.size).toBe(0);
  });

  it('removes stale pending passengers instead of confirming payment after a pool leaves', async () => {
    const store = new FakeRidePoolStore([route]);
    const service = new RidePoolService(store, {
      poolSize: 2,
      generatePin: async () => '9812'
    });

    const created = await service.createPool('1', '101');
    if (created.kind !== 'payment_required') {
      throw new Error('Expected payment_required when creating a pool');
    }
    await service.confirmPayment(created.pool.id, '101');
    const joinedBeforeDeparture = await service.joinPool(created.pool.id, '102');
    expect(joinedBeforeDeparture.kind).toBe('payment_required');
    await service.joinPool(created.pool.id, '103');
    await service.confirmPayment(created.pool.id, '103');

    const staleConfirmation = await service.confirmPayment(created.pool.id, '102');
    expect(staleConfirmation.kind).toBe('pool_not_joinable');
    expect(await store.getActivePoolForPassenger('102')).toBeNull();
  });

  it('assigns the first driver and rejects late accept attempts', async () => {
    const store = new FakeRidePoolStore([route]);
    const service = new RidePoolService(store, {
      poolSize: 1,
      generatePin: async () => '9812'
    });
    const created = await service.createPool('1', '101');
    if (created.kind !== 'payment_required') {
      throw new Error('Expected payment_required when creating a pool');
    }
    await service.confirmPayment(created.pool.id, '101');

    const firstDriver = await service.acceptJob(created.pool.id, 'driver-1');
    const lateDriver = await service.acceptJob(created.pool.id, 'driver-2');

    expect(firstDriver.kind).toBe('assigned');
    if (firstDriver.kind !== 'assigned') {
      throw new Error('Expected the first driver to be assigned');
    }
    expect(firstDriver.manifest).toHaveLength(1);
    expect(lateDriver.kind).toBe('already_taken');
  });

  it('lets the captain dispatch early after all confirmed passengers accept', async () => {
    const store = new FakeRidePoolStore([route]);
    const service = new RidePoolService(store, {
      poolSize: 4,
      generatePin: async () => '5407'
    });
    const created = await service.createPool('1', '101');
    if (created.kind !== 'payment_required') {
      throw new Error('Expected payment_required when creating a pool');
    }
    await service.confirmPayment(created.pool.id, '101');
    await service.joinPool(created.pool.id, '102');
    await service.confirmPayment(created.pool.id, '102');

    const requested = await service.requestEarlyDispatch(created.pool.id, '101');
    expect(requested.kind).toBe('requested');
    if (requested.kind !== 'requested') {
      throw new Error('Expected early dispatch request to start');
    }
    expect(requested.passengerIdsToNotify).toEqual(['102']);

    const vote = await service.voteEarlyDispatch(created.pool.id, '102', 'accepted');
    expect(vote.kind).toBe('early_dispatch_ready');
    if (vote.kind !== 'early_dispatch_ready') {
      throw new Error('Expected early dispatch to be ready after all passengers accept');
    }
    expect(vote.pool.status).toBe('ready');
    expect(vote.pool.isEarlyDispatch).toBe(true);
  });

  it('lets the assigned driver request arrival, and any confirmed passenger can confirm it', async () => {
    const store = new FakeRidePoolStore([route]);
    const service = new RidePoolService(store, {
      poolSize: 3,
      generatePin: async () => '9812'
    });
    const created = await service.createPool('1', '101');
    if (created.kind !== 'payment_required') {
      throw new Error('Expected payment_required when creating a pool');
    }
    await service.confirmPayment(created.pool.id, '101');
    await service.joinPool(created.pool.id, '102');
    await service.confirmPayment(created.pool.id, '102');
    await service.joinPool(created.pool.id, '103');
    await service.markDriverAlertSent(created.pool.id, '-100', 10);
    await store.markPoolReady(created.pool.id);
    await service.acceptJob(created.pool.id, 'driver-1');

    const arrivalRequest = await service.requestDriverArrival(created.pool.id, 'driver-1');
    expect(arrivalRequest.kind).toBe('requested');
    if (arrivalRequest.kind !== 'requested') {
      throw new Error('Expected assigned driver to request arrival');
    }
    expect(arrivalRequest.pool.status).toBe('arrival_requested');
    expect(arrivalRequest.captainTelegramId).toBe('101');
    expect(arrivalRequest.passengerIdsToNotify).toEqual(['102']);
    expect(store.pools.get(created.pool.id)?.arrivalRequestedAt).toBeInstanceOf(Date);

    const pendingPassengerConfirmation = await service.confirmDriverArrival(created.pool.id, '103');
    expect(pendingPassengerConfirmation.kind).toBe('not_allowed');

    const passengerConfirmation = await service.confirmDriverArrival(created.pool.id, '102');
    expect(passengerConfirmation.kind).toBe('confirmed');
    if (passengerConfirmation.kind !== 'confirmed') {
      throw new Error('Expected confirmed passenger to confirm driver arrival');
    }
    expect(passengerConfirmation.pool.status).toBe('in_progress');
    expect(passengerConfirmation.pool.arrivedAt).toBeInstanceOf(Date);
  });

  it('blocks arrival confirmation until the driver has requested arrival', async () => {
    const store = new FakeRidePoolStore([route]);
    const service = new RidePoolService(store, {
      poolSize: 1,
      generatePin: async () => '9812'
    });
    const created = await service.createPool('1', '101');
    if (created.kind !== 'payment_required') {
      throw new Error('Expected payment_required when creating a pool');
    }
    await service.confirmPayment(created.pool.id, '101');
    await service.acceptJob(created.pool.id, 'driver-1');

    const confirmation = await service.confirmDriverArrival(created.pool.id, '101');

    expect(confirmation.kind).toBe('not_allowed');
  });

  it('marks a trip completed only after passenger-confirmed driver arrival and assigned driver PIN submission', async () => {
    const store = new FakeRidePoolStore([route]);
    const service = new RidePoolService(store, {
      poolSize: 1,
      generatePin: async () => '9812'
    });
    const created = await service.createPool('1', '101');
    if (created.kind !== 'payment_required') {
      throw new Error('Expected payment_required when creating a pool');
    }
    await service.confirmPayment(created.pool.id, '101');
    await service.acceptJob(created.pool.id, 'driver-1');

    const tooEarly = await service.completeTrip('9812', 'driver-1');
    await service.requestDriverArrival(created.pool.id, 'driver-1');
    await service.confirmDriverArrival(created.pool.id, '101');
    const wrongDriver = await service.completeTrip('9812', 'driver-2');
    const assignedDriver = await service.completeTrip('9812', 'driver-1');

    expect(tooEarly.kind).toBe('invalid_pin');
    expect(wrongDriver.kind).toBe('invalid_pin');
    expect(assignedDriver.kind).toBe('completed');
  });
});
