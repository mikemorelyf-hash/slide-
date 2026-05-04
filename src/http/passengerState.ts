import type { PassengerManifest, PoolPassenger, RidePool, TelegramUserProfile } from '../domain/types.js';

export type PassengerPrimaryAction =
  | 'choose_route'
  | 'confirm_payment'
  | 'wait_for_pool'
  | 'request_early_dispatch'
  | 'wait_for_driver'
  | 'confirm_arrival'
  | 'in_trip'
  | 'completed';

export interface PassengerPoolView {
  pool: Omit<RidePool, 'pinCode'> & { pinCode: string | null };
  passenger: PoolPassenger;
  driver: TelegramUserProfile | null;
  passengers: PassengerManifest[];
  actions: {
    primary: PassengerPrimaryAction;
    canConfirmPayment: boolean;
    canCancel: boolean;
    canRequestEarlyDispatch: boolean;
    canConfirmArrival: boolean;
    canRejectArrival: boolean;
  };
}

export interface PassengerAvailablePoolView {
  id: string;
  routeId: string;
  routeName: string;
  workflowChannel: RidePool['workflowChannel'];
  status: RidePool['status'];
  passengerCount: number;
  seatsLeft: number;
  priceAmount: number | null;
  priceCurrency: string;
  isEarlyDispatch: boolean;
  captain: TelegramUserProfile | null;
}

export interface ToPassengerPoolViewInput {
  pool: RidePool;
  passenger: PoolPassenger;
  poolSize: number;
  driver: TelegramUserProfile | null;
  passengers?: PassengerManifest[];
}

export interface ToPassengerAvailablePoolViewInput {
  pool: RidePool;
  poolSize: number;
  captain: TelegramUserProfile | null;
}

export function toPassengerAvailablePoolView({
  pool,
  poolSize,
  captain
}: ToPassengerAvailablePoolViewInput): PassengerAvailablePoolView {
  return {
    id: pool.id,
    routeId: pool.routeId,
    routeName: pool.routeName,
    workflowChannel: pool.workflowChannel,
    status: pool.status,
    passengerCount: pool.passengerCount,
    seatsLeft: Math.max(0, poolSize - pool.passengerCount),
    priceAmount: pool.priceAmount,
    priceCurrency: pool.priceCurrency,
    isEarlyDispatch: pool.isEarlyDispatch,
    captain
  };
}

export function toPassengerPoolView({
  pool,
  passenger,
  poolSize,
  driver,
  passengers = []
}: ToPassengerPoolViewInput): PassengerPoolView {
  const isConfirmed = passenger.paymentStatus === 'confirmed';
  const canConfirmPayment = passenger.paymentStatus === 'pending' && pool.status === 'open';
  const canCancel =
    ['pending', 'confirmed'].includes(passenger.paymentStatus) &&
    ['open', 'ready'].includes(pool.status) &&
    !pool.driverTelegramId;
  const canRequestEarlyDispatch =
    passenger.isCaptain &&
    isConfirmed &&
    pool.status === 'open' &&
    pool.passengerCount >= 1 &&
    pool.passengerCount < poolSize;
  const canConfirmArrival = isConfirmed && pool.status === 'arrival_requested';
  const canRejectArrival = canConfirmArrival;

  return {
    pool: {
      ...pool,
      pinCode: isConfirmed ? pool.pinCode : null
    },
    passenger,
    driver,
    passengers: isConfirmed ? passengers : [],
    actions: {
      primary: resolvePrimaryAction(pool, passenger, {
        canConfirmPayment,
        canRequestEarlyDispatch,
        canConfirmArrival
      }),
      canConfirmPayment,
      canCancel,
      canRequestEarlyDispatch,
      canConfirmArrival,
      canRejectArrival
    }
  };
}

function resolvePrimaryAction(
  pool: RidePool,
  passenger: PoolPassenger,
  actions: Pick<
    PassengerPoolView['actions'],
    'canConfirmPayment' | 'canRequestEarlyDispatch' | 'canConfirmArrival'
  >
): PassengerPrimaryAction {
  if (actions.canConfirmPayment) {
    return 'confirm_payment';
  }

  if (actions.canConfirmArrival) {
    return 'confirm_arrival';
  }

  if (pool.status === 'completed') {
    return 'completed';
  }

  if (pool.status === 'in_progress') {
    return 'in_trip';
  }

  if (pool.status === 'arrival_requested') {
    return 'confirm_arrival';
  }

  if (pool.status === 'assigned') {
    return 'wait_for_driver';
  }

  if (pool.status === 'ready') {
    return 'wait_for_driver';
  }

  if (actions.canRequestEarlyDispatch) {
    return 'request_early_dispatch';
  }

  if (passenger.paymentStatus === 'confirmed') {
    return 'wait_for_pool';
  }

  return 'choose_route';
}
