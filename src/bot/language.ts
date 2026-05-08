import { normalizeLanguageCode, type SupportedLanguageCode } from '../domain/language.js';
import type { TelegramUserProfile } from '../domain/types.js';

interface UserLanguageStore {
  getUserProfile(telegramId: string): Promise<TelegramUserProfile | null>;
}

export function profileLanguage(profile: Pick<TelegramUserProfile, 'languageCode'> | null | undefined): SupportedLanguageCode {
  return normalizeLanguageCode(profile?.languageCode);
}

export async function getUserLanguage(
  store: UserLanguageStore,
  telegramId: string | null | undefined
): Promise<SupportedLanguageCode> {
  if (!telegramId) {
    return 'en';
  }

  return profileLanguage(await store.getUserProfile(telegramId));
}

export async function getLanguageTargets(
  store: UserLanguageStore,
  telegramIds: string[]
): Promise<Array<{ telegramId: string; language: SupportedLanguageCode }>> {
  return Promise.all(
    telegramIds.map(async (telegramId) => ({
      telegramId,
      language: await getUserLanguage(store, telegramId)
    }))
  );
}
