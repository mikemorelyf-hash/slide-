import { describe, expect, it } from 'vitest';

import { parseDriverPinMessage } from '../src/bot/driverPinMessage.js';

describe('parseDriverPinMessage', () => {
  it('accepts a plain 4-digit PIN', () => {
    expect(parseDriverPinMessage('9428')).toBe('9428');
  });

  it('trims surrounding whitespace', () => {
    expect(parseDriverPinMessage('  9428  ')).toBe('9428');
  });

  it('does not treat commands or random text as a plain PIN', () => {
    expect(parseDriverPinMessage('/complete 9428')).toBeNull();
    expect(parseDriverPinMessage('pin is 9428')).toBeNull();
    expect(parseDriverPinMessage('12345')).toBeNull();
  });
});
