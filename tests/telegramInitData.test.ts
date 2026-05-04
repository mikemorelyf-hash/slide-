import { createHmac } from 'node:crypto';

import { validateTelegramInitData } from '../src/security/telegramInitData.js';

const BOT_TOKEN = '123456:test-token';
const NOW_SECONDS = 1_710_000_010;

function signedInitData(fields: Record<string, string>): string {
  const params = new URLSearchParams(fields);
  const dataCheckString = [...params.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  const secretKey = createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
  const hash = createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

  params.set('hash', hash);
  return params.toString();
}

describe('validateTelegramInitData', () => {
  it('accepts signed Telegram Mini App init data and parses the user payload', () => {
    const initData = signedInitData({
      auth_date: String(NOW_SECONDS - 10),
      query_id: 'AAEAAAE',
      user: JSON.stringify({
        id: 42,
        first_name: 'Mike',
        username: 'mike'
      })
    });

    const result = validateTelegramInitData(initData, {
      botToken: BOT_TOKEN,
      maxAgeSeconds: 60,
      now: new Date(NOW_SECONDS * 1000)
    });

    expect(result.valid).toBe(true);
    if (!result.valid) {
      throw new Error('Expected signed init data to be valid');
    }
    expect(result.data?.user?.id).toBe(42);
    expect(result.data?.user?.username).toBe('mike');
  });

  it('rejects tampered init data', () => {
    const initData = signedInitData({
      auth_date: String(NOW_SECONDS - 10),
      user: JSON.stringify({ id: 42, first_name: 'Mike' })
    }).replace('Mike', 'Mallory');

    const result = validateTelegramInitData(initData, {
      botToken: BOT_TOKEN,
      maxAgeSeconds: 60,
      now: new Date(NOW_SECONDS * 1000)
    });

    expect(result.valid).toBe(false);
    if (result.valid) {
      throw new Error('Expected tampered init data to be invalid');
    }
    expect(result.reason).toBe('invalid_hash');
  });

  it('rejects old init data even when the hash is valid', () => {
    const initData = signedInitData({
      auth_date: String(NOW_SECONDS - 600),
      user: JSON.stringify({ id: 42, first_name: 'Mike' })
    });

    const result = validateTelegramInitData(initData, {
      botToken: BOT_TOKEN,
      maxAgeSeconds: 60,
      now: new Date(NOW_SECONDS * 1000)
    });

    expect(result.valid).toBe(false);
    if (result.valid) {
      throw new Error('Expected stale init data to be invalid');
    }
    expect(result.reason).toBe('expired');
  });
});
