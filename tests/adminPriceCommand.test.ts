import { describe, expect, it } from 'vitest';

import { parseSetPriceCommand } from '../src/bot/adminPriceCommand.js';

describe('parseSetPriceCommand', () => {
  it('parses route id, amount, and optional currency', () => {
    expect(parseSetPriceCommand('/set_price 7 120 ETB')).toEqual({
      routeId: '7',
      amount: 120,
      currency: 'ETB'
    });
  });

  it('defaults currency to ETB', () => {
    expect(parseSetPriceCommand('/set_price 7 120')).toEqual({
      routeId: '7',
      amount: 120,
      currency: 'ETB'
    });
  });

  it('rejects missing or invalid values', () => {
    expect(parseSetPriceCommand('/set_price')).toBeNull();
    expect(parseSetPriceCommand('/set_price 7 nope')).toBeNull();
    expect(parseSetPriceCommand('/set_price 7 -1')).toBeNull();
  });
});
