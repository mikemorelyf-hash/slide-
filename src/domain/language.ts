export const SUPPORTED_LANGUAGE_CODES = ['en', 'am'] as const;

export type SupportedLanguageCode = (typeof SUPPORTED_LANGUAGE_CODES)[number];

export function normalizeLanguageCode(value: unknown): SupportedLanguageCode {
  return value === 'am' ? 'am' : 'en';
}

export function isSupportedLanguageCode(value: unknown): value is SupportedLanguageCode {
  return value === 'en' || value === 'am';
}
