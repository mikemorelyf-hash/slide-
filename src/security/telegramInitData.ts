import { createHmac, timingSafeEqual } from 'node:crypto';

export interface TelegramInitDataUser {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  allows_write_to_pm?: boolean;
}

export interface ParsedTelegramInitData {
  authDate: Date;
  queryId: string | null;
  user: TelegramInitDataUser | null;
  raw: Record<string, string>;
}

export type TelegramInitDataResult =
  | {
      valid: true;
      data: ParsedTelegramInitData;
    }
  | {
      valid: false;
      reason:
        | 'missing_hash'
        | 'missing_auth_date'
        | 'invalid_auth_date'
        | 'expired'
        | 'invalid_hash'
        | 'invalid_user';
    };

export interface ValidateTelegramInitDataOptions {
  botToken: string;
  maxAgeSeconds?: number;
  now?: Date;
}

export function validateTelegramInitData(
  initData: string,
  options: ValidateTelegramInitDataOptions
): TelegramInitDataResult {
  const params = new URLSearchParams(initData);
  const receivedHash = params.get('hash');

  if (!receivedHash) {
    return { valid: false, reason: 'missing_hash' };
  }

  const authDateValue = params.get('auth_date');
  if (!authDateValue) {
    return { valid: false, reason: 'missing_auth_date' };
  }

  const authDateSeconds = Number(authDateValue);
  if (!Number.isInteger(authDateSeconds) || authDateSeconds <= 0) {
    return { valid: false, reason: 'invalid_auth_date' };
  }

  const maxAgeSeconds = options.maxAgeSeconds ?? 86_400;
  const nowSeconds = Math.floor((options.now ?? new Date()).getTime() / 1000);
  if (nowSeconds - authDateSeconds > maxAgeSeconds) {
    return { valid: false, reason: 'expired' };
  }

  params.delete('hash');
  const dataCheckString = [...params.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');

  const secretKey = createHmac('sha256', 'WebAppData').update(options.botToken).digest();
  const calculatedHash = createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

  if (!constantTimeEqual(calculatedHash, receivedHash)) {
    return { valid: false, reason: 'invalid_hash' };
  }

  const raw = Object.fromEntries(params.entries());
  let user: TelegramInitDataUser | null = null;
  const userValue = params.get('user');
  if (userValue) {
    try {
      user = JSON.parse(userValue) as TelegramInitDataUser;
    } catch {
      return { valid: false, reason: 'invalid_user' };
    }
  }

  return {
    valid: true,
    data: {
      authDate: new Date(authDateSeconds * 1000),
      queryId: params.get('query_id'),
      user,
      raw
    }
  };
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, 'hex');
  const rightBuffer = Buffer.from(right, 'hex');
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}
