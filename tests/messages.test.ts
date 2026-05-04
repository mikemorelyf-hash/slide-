import { describe, expect, it } from 'vitest';

import {
  adminRouteSummary,
  driverManifestMessage,
  passengerConfirmedMessage,
  paymentPromptMessage,
  profilePromptMessage,
  profileStatusMessage,
  routeButtonLabel,
  tripCompletedDriverMessage,
  tripCompletedPassengerMessage
} from '../src/bot/messages.js';
import type { RidePool, Route } from '../src/domain/types.js';

const route: Route = {
  id: '7',
  name: 'Mexico -> Bole',
  isActive: true,
  priceAmount: 120,
  priceCurrency: 'ETB'
};

const pool: RidePool = {
  id: '11',
  routeId: route.id,
  routeName: route.name,
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
  priceAmount: route.priceAmount,
  priceCurrency: route.priceCurrency
};

describe('route price messages', () => {
  it('shows route price on passenger route buttons', () => {
    expect(routeButtonLabel(route)).toBe('Mexico -> Bole - 120 ETB');
  });

  it('shows the pool price in the payment prompt', () => {
    expect(paymentPromptMessage(pool)).toContain('Price: 120 ETB');
  });

  it('tells passengers when the job will be sent to drivers after payment', () => {
    const message = passengerConfirmedMessage(pool, 1, 4);

    expect(message).toContain('Drivers will see the job when 4/4 seats are confirmed');
    expect(message).toContain("Let's Go Now");
  });

  it('does not reveal the pool PIN in the payment prompt before payment is confirmed', () => {
    expect(paymentPromptMessage(pool)).not.toContain('4334');
    expect(paymentPromptMessage(pool)).not.toContain('PIN');
    expect(paymentPromptMessage(pool)).toContain('only after payment is confirmed');
  });

  it('shows route id and price in the admin route summary', () => {
    expect(adminRouteSummary(route)).toBe('#7 Mexico -> Bole | price=120 ETB | active=true');
  });

  it('asks passengers for phone and Telegram profile only', () => {
    const prompt = profilePromptMessage();
    expect(prompt).toContain('phone number');
    expect(prompt).toContain('Telegram profile');
    expect(prompt).not.toMatch(/pickup|location/i);
  });

  it('shows saved phone and Telegram profile without pickup status', () => {
    const status = profileStatusMessage({
      telegramId: '101',
      firstName: 'Michael',
      lastName: 'Fasil',
      username: 'michaelf',
      phoneNumber: '+251900000000',
      locationLabel: 'Old pickup'
    });

    expect(status).toContain('Phone: +251900000000');
    expect(status).toContain('Telegram: @michaelf');
    expect(status).not.toContain('Pickup');
    expect(status).not.toContain('Old pickup');
  });

  it('does not include pickup locations in the driver manifest', () => {
    const message = driverManifestMessage(pool, [
      {
        telegramId: '101',
        displayName: 'Michael Fasil',
        username: 'michaelf',
        phoneNumber: '+251900000000',
        pickupLocation: 'Old pickup'
      }
    ]);

    expect(message).toContain('Phone: +251900000000');
    expect(message).toContain('Username: @michaelf');
    expect(message).not.toContain('Pickup');
    expect(message).not.toContain('Old pickup');
  });

  it('does not reveal the pool PIN in the driver manifest', () => {
    const message = driverManifestMessage(pool, [
      {
        telegramId: '101',
        displayName: 'Michael Fasil',
        username: 'michaelf',
        phoneNumber: '+251900000000',
        pickupLocation: null
      }
    ]);

    expect(message).not.toContain('4334');
    expect(message).not.toContain('Pool PIN');
    expect(message).toContain('ask passengers for the 4-digit PIN');
  });

  it('congratulates passengers and drivers when the trip is completed', () => {
    expect(tripCompletedPassengerMessage(pool)).toContain('Congrats');
    expect(tripCompletedPassengerMessage(pool)).toContain('Side');
    expect(tripCompletedPassengerMessage(pool)).toContain('Mexico -> Bole');

    expect(tripCompletedDriverMessage(pool)).toContain('Congrats');
    expect(tripCompletedDriverMessage(pool)).toContain('Admin has been notified');
  });
});
