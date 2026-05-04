import { describe, expect, it, vi } from 'vitest';

import { sendPendingNotifications } from '../src/bot/notificationOutbox.js';

describe('notification outbox worker', () => {
  it('marks a successful passenger message as sent', async () => {
    const store = {
      claimPendingNotifications: vi.fn().mockResolvedValue([
        {
          id: '1',
          targetBot: 'passenger',
          chatId: '99',
          messageType: 'plain_text',
          payload: { text: 'Hello' },
          attemptCount: 1
        }
      ]),
      markNotificationSent: vi.fn().mockResolvedValue(undefined),
      markNotificationRetry: vi.fn().mockResolvedValue(undefined),
      markNotificationFailed: vi.fn().mockResolvedValue(undefined)
    };
    const passengerBot = {
      telegram: {
        sendMessage: vi.fn().mockResolvedValue({ message_id: 10 })
      }
    };

    await sendPendingNotifications({
      store: store as never,
      bots: { passengerBot: passengerBot as never },
      batchSize: 10
    });

    expect(passengerBot.telegram.sendMessage).toHaveBeenCalledWith('99', 'Hello', undefined);
    expect(store.markNotificationSent).toHaveBeenCalledWith('1', 10);
  });

  it('retries a failed message with backoff', async () => {
    const store = {
      claimPendingNotifications: vi.fn().mockResolvedValue([
        {
          id: '1',
          targetBot: 'passenger',
          chatId: '99',
          messageType: 'plain_text',
          payload: { text: 'Hello' },
          attemptCount: 2
        }
      ]),
      markNotificationSent: vi.fn().mockResolvedValue(undefined),
      markNotificationRetry: vi.fn().mockResolvedValue(undefined),
      markNotificationFailed: vi.fn().mockResolvedValue(undefined)
    };
    const passengerBot = {
      telegram: {
        sendMessage: vi.fn().mockRejectedValue(new Error('Telegram unavailable'))
      }
    };

    await sendPendingNotifications({
      store: store as never,
      bots: { passengerBot: passengerBot as never },
      batchSize: 10
    });

    expect(store.markNotificationRetry).toHaveBeenCalledWith(
      '1',
      'Telegram unavailable',
      expect.any(Date)
    );
  });
});
