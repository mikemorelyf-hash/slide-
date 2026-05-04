import type { TelegramUserProfile } from '../domain/types.js';

declare global {
  namespace Express {
    interface Request {
      telegramUser?: TelegramUserProfile | null;
    }
  }
}

export {};
