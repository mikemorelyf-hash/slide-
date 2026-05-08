import { describe, expect, it } from 'vitest';

import {
  buildAuthHeaders,
  formatPassengerName,
  formatPoolSeatLabel,
  formatPrice,
  isRouteBookable,
  isLockedToTelegramWorkflow,
  passengerHasPhone,
  resolveMiniAppError,
  shouldClearRoutePoolsAfterStateRefresh,
  shouldShowCompletedTrip,
  poolOccupancyLabel,
  primaryActionLabel
} from './appState';
import { adminArrivalStateLabel, adminStatusLabel, formatAdminDate, isActiveAdminPool } from './adminState';
import type { TelegramUserProfile } from './types';

describe('Mini App helpers', () => {
  it('formats unset and set route prices', () => {
    expect(formatPrice({ priceAmount: null, priceCurrency: 'ETB' })).toBe('not set');
    expect(formatPrice({ priceAmount: 75, priceCurrency: 'ETB' })).toBe('75 ETB');
    expect(formatPrice({ priceAmount: null, priceCurrency: 'ETB' }, 'am')).toBe('አልተዘጋጀም');
  });

  it('treats routes without prices as not bookable', () => {
    expect(isRouteBookable({ priceAmount: 75 })).toBe(true);
    expect(isRouteBookable({ priceAmount: null })).toBe(false);
  });

  it('uses Telegram username as the compact passenger identity when available', () => {
    const user: TelegramUserProfile = {
      telegramId: '101',
      firstName: 'Michael',
      lastName: 'Fasil',
      username: 'michaelf'
    };

    expect(formatPassengerName(user)).toBe('@michaelf');
  });

  it('maps primary actions to passenger-facing labels', () => {
    expect(primaryActionLabel('confirm_payment')).toBe('I Have Paid');
    expect(primaryActionLabel('confirm_arrival')).toBe('Confirm Driver Arrival');
    expect(primaryActionLabel('confirm_payment', 'am')).toBe('ከፍያለሁ');
  });

  it('builds Telegram init data auth headers', () => {
    expect(buildAuthHeaders('query_id=abc')).toEqual({
      'X-Telegram-Init-Data': 'query_id=abc'
    });
  });

  it('requires phone before Mini App create or join actions', () => {
    expect(passengerHasPhone({ phoneNumber: '+251965778668' })).toBe(true);
    expect(passengerHasPhone({ phoneNumber: '   ' })).toBe(false);
    expect(passengerHasPhone(null)).toBe(false);
  });

  it('detects active Telegram rides that should not be managed in the Mini App', () => {
    expect(
      isLockedToTelegramWorkflow({
        pool: { workflowChannel: 'telegram' }
      })
    ).toBe(true);
    expect(
      isLockedToTelegramWorkflow({
        pool: { workflowChannel: 'mini_app' }
      })
    ).toBe(false);
    expect(isLockedToTelegramWorkflow(null)).toBe(false);
  });

  it('turns API and network failures into clear passenger messages', () => {
    expect(resolveMiniAppError({ status: 401 })).toBe('Open this app from Telegram.');
    expect(resolveMiniAppError({ status: 409 })).toBe('This changed already. Refresh and try again.');
    expect(resolveMiniAppError({ status: 409, code: 'pool_not_joinable' })).toBe(
      'This pool is no longer available. Please start a new pool.'
    );
    expect(resolveMiniAppError({ status: 503 })).toBe('Service is temporarily unavailable. Try again.');
    expect(resolveMiniAppError(new TypeError('Failed to fetch'))).toBe(
      'Service unavailable. Check connection and try again.'
    );
    expect(resolveMiniAppError({ status: 409, code: 'phone_required' }, 'passenger', 'am')).toBe(
      'ፑል ከመፍጠር፣ ከመቀላቀል ወይም ከመክፈል በፊት ስልክዎን ያስቀምጡ።'
    );
  });

  it('keeps admin auth errors specific', () => {
    expect(resolveMiniAppError({ status: 401 }, 'admin')).toBe('Open this dashboard from Telegram.');
    expect(resolveMiniAppError({ status: 403 }, 'admin')).toBe('Admin access required.');
  });

  it('formats active pool seat labels for choosing a pool', () => {
    expect(formatPoolSeatLabel({ passengerCount: 3, seatsLeft: 1 })).toBe('Almost full');
    expect(formatPoolSeatLabel({ passengerCount: 1, seatsLeft: 3 })).toBe('3 seats left');
    expect(poolOccupancyLabel({ passengerCount: 2 }, 4)).toBe('2 / 4 seats');
  });

  it('shows the completed trip screen until that completed pool is dismissed', () => {
    expect(shouldShowCompletedTrip({ pool: { id: '42' } }, null)).toBe(true);
    expect(shouldShowCompletedTrip({ pool: { id: '42' } }, '41')).toBe(true);
    expect(shouldShowCompletedTrip({ pool: { id: '42' } }, '42')).toBe(false);
    expect(shouldShowCompletedTrip(null, null)).toBe(false);
  });

  it('keeps route pool browsing open after the completed trip screen is dismissed', () => {
    expect(
      shouldClearRoutePoolsAfterStateRefresh(
        {
          activePool: null,
          lastCompletedPool: { pool: { id: '42' } }
        },
        '42'
      )
    ).toBe(false);

    expect(
      shouldClearRoutePoolsAfterStateRefresh(
        {
          activePool: null,
          lastCompletedPool: { pool: { id: '42' } }
        },
        null
      )
    ).toBe(true);

    expect(
      shouldClearRoutePoolsAfterStateRefresh(
        {
          activePool: { pool: { id: '11' } },
          lastCompletedPool: null
        },
        '42'
      )
    ).toBe(true);
  });

  it('formats admin dashboard statuses and dates', () => {
    expect(adminStatusLabel('in_progress')).toBe('In Progress');
    expect(formatAdminDate(null)).toBe('not set');
    expect(formatAdminDate('2026-04-29T09:05:00.000Z')).toContain('2026');
  });

  it('detects active admin pools', () => {
    expect(isActiveAdminPool('open')).toBe(true);
    expect(isActiveAdminPool('ready')).toBe(true);
    expect(isActiveAdminPool('completed')).toBe(false);
  });

  it('formats admin arrival state labels', () => {
    expect(adminArrivalStateLabel(null, null)).toBe('Not set');
    expect(adminArrivalStateLabel('2026-04-29T09:05:00.000Z', null)).toBe('Requested');
    expect(adminArrivalStateLabel('2026-04-29T09:05:00.000Z', '2026-04-29T09:06:00.000Z')).toBe(
      'Confirmed'
    );
  });
});
