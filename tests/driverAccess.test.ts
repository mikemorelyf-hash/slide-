import { describe, expect, it, vi } from 'vitest';

import { ensureDriverBotStarted, ensurePrivateDriverChat } from '../src/bot/driverAccess.js';

describe('driver Telegram access guard', () => {
  it('allows drivers who started the driver bot privately', async () => {
    const store = {
      hasDriverBotStarted: vi.fn().mockResolvedValue(true)
    };
    const ctx = {
      answerCbQuery: vi.fn().mockResolvedValue(undefined)
    };

    await expect(ensureDriverBotStarted(ctx as never, store, 'driver-1')).resolves.toBe(true);

    expect(store.hasDriverBotStarted).toHaveBeenCalledWith('driver-1');
    expect(ctx.answerCbQuery).not.toHaveBeenCalled();
  });

  it('blocks job acceptance until the driver starts the private driver bot', async () => {
    const store = {
      hasDriverBotStarted: vi.fn().mockResolvedValue(false)
    };
    const ctx = {
      answerCbQuery: vi.fn().mockResolvedValue(undefined)
    };

    await expect(ensureDriverBotStarted(ctx as never, store, 'driver-2')).resolves.toBe(false);

    expect(ctx.answerCbQuery).toHaveBeenCalledWith(
      'Open the driver bot and press Start first.',
      { show_alert: true }
    );
  });

  it('allows driver commands only in a private chat', async () => {
    const privateCtx = {
      chat: { type: 'private' },
      reply: vi.fn().mockResolvedValue(undefined)
    };
    const groupCtx = {
      chat: { type: 'supergroup' },
      reply: vi.fn().mockResolvedValue(undefined)
    };

    await expect(ensurePrivateDriverChat(privateCtx as never)).resolves.toBe(true);
    await expect(ensurePrivateDriverChat(groupCtx as never)).resolves.toBe(false);

    expect(privateCtx.reply).not.toHaveBeenCalled();
    expect(groupCtx.reply).toHaveBeenCalledWith('Please use the driver bot private chat for this.');
  });
});
