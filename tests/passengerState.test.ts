import { describe, expect, it } from 'vitest';

import { toPassengerAvailablePoolView, toPassengerPoolView } from '../src/http/passengerState.js';
import type { PassengerManifest, PoolPassenger, RidePool } from '../src/domain/types.js';

const basePool: RidePool = {
  id: '11',
  routeId: '7',
  routeName: 'Mexico -> Bole',
  workflowChannel: 'telegram',
  pinCode: '4334',
  captainTelegramId: '101',
  status: 'open',
  passengerCount: 1,
  driverTelegramId: null,
  driverAlertMessageId: null,
  driverGroupChatId: null,
  isEarlyDispatch: false,
  earlyDispatchRequestedAt: null,
  arrivalRequestedAt: null,
  arrivedAt: null,
  priceAmount: 120,
  priceCurrency: 'ETB'
};

const basePassenger: PoolPassenger = {
  poolId: '11',
  telegramId: '101',
  isCaptain: true,
  paymentStatus: 'pending',
  earlyDispatchVote: 'pending'
};

const passengerManifest: PassengerManifest[] = [
  {
    telegramId: '101',
    displayName: 'Michael Fasil',
    username: 'michael_test',
    phoneNumber: '+251965778668',
    pickupLocation: null
  },
  {
    telegramId: '202',
    displayName: 'Abebe K.',
    username: 'abebe_k',
    phoneNumber: '+251911111111',
    pickupLocation: null
  }
];

describe('passenger Mini App state', () => {
  it('hides the pool PIN until the passenger payment is confirmed', () => {
    const view = toPassengerPoolView({
      pool: basePool,
      passenger: basePassenger,
      poolSize: 4,
      driver: null
    });

    expect(view.pool.pinCode).toBeNull();
    expect(view.actions.canConfirmPayment).toBe(true);
  });

  it('shows the pool PIN and early dispatch action after captain payment is confirmed', () => {
    const view = toPassengerPoolView({
      pool: { ...basePool, passengerCount: 1 },
      passenger: { ...basePassenger, paymentStatus: 'confirmed' },
      poolSize: 4,
      driver: null,
      passengers: passengerManifest
    });

    expect(view.pool.pinCode).toBe('4334');
    expect(view.actions.canRequestEarlyDispatch).toBe(true);
    expect(view.passengers).toEqual(passengerManifest);
  });

  it('hides passenger contacts until the current passenger payment is confirmed', () => {
    const view = toPassengerPoolView({
      pool: { ...basePool, passengerCount: 2 },
      passenger: basePassenger,
      poolSize: 4,
      driver: null,
      passengers: passengerManifest
    });

    expect(view.passengers).toEqual([]);
  });

  it('lets a confirmed passenger cancel before a driver accepts', () => {
    const view = toPassengerPoolView({
      pool: { ...basePool, status: 'ready', passengerCount: 4, driverTelegramId: null },
      passenger: { ...basePassenger, paymentStatus: 'confirmed' },
      poolSize: 4,
      driver: null
    });

    expect(view.actions.canCancel).toBe(true);
  });

  it('lets any confirmed passenger confirm arrival when the driver has requested it', () => {
    const view = toPassengerPoolView({
      pool: {
        ...basePool,
        status: 'arrival_requested',
        driverTelegramId: 'driver-1',
        arrivalRequestedAt: new Date('2026-04-28T18:00:00.000Z')
      },
      passenger: { ...basePassenger, isCaptain: false, paymentStatus: 'confirmed' },
      poolSize: 4,
      driver: null
    });

    expect(view.actions.canConfirmArrival).toBe(true);
    expect(view.actions.primary).toBe('confirm_arrival');
  });

  it('shows safe active pool choices without exposing the PIN before join/payment', () => {
    const view = toPassengerAvailablePoolView({
      pool: { ...basePool, id: '22', passengerCount: 2 },
      poolSize: 4,
      captain: {
        telegramId: '101',
        firstName: 'Michael',
        lastName: 'Fasil',
        username: 'michael'
      }
    });

    expect(view.id).toBe('22');
    expect(view.workflowChannel).toBe('telegram');
    expect(view.seatsLeft).toBe(2);
    expect(view.passengerCount).toBe(2);
    expect(view.captain?.username).toBe('michael');
    expect(view).not.toHaveProperty('pinCode');
  });
});
