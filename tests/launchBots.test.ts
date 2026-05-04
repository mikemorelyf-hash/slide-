import { describe, expect, it, vi } from 'vitest';

import { startPollingBots } from '../src/bot/launchBots.js';

describe('polling bot launcher', () => {
  it('starts the driver bot even when passenger bot polling stays open', () => {
    const passengerBot = {
      launch: vi.fn(() => new Promise<void>(() => {}))
    };
    const driverBot = {
      launch: vi.fn().mockResolvedValue(undefined)
    };

    const startedCount = startPollingBots({
      passengerBot,
      driverBot,
      onError: vi.fn()
    });

    expect(startedCount).toBe(2);
    expect(passengerBot.launch).toHaveBeenCalledOnce();
    expect(driverBot.launch).toHaveBeenCalledOnce();
  });
});
