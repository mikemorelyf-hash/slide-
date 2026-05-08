import type { Context } from 'telegraf';

import type { SupportedLanguageCode } from '../domain/language.js';

interface DriverAccessStore {
  hasDriverBotStarted(telegramId: string): Promise<boolean>;
}

type CallbackContext = Pick<Context, 'answerCbQuery'>;
type ReplyContext = Pick<Context, 'chat' | 'reply'>;

export async function ensureDriverBotStarted(
  ctx: CallbackContext,
  store: DriverAccessStore,
  telegramId: string,
  language: SupportedLanguageCode = 'en'
): Promise<boolean> {
  if (await store.hasDriverBotStarted(telegramId)) {
    return true;
  }

  await ctx.answerCbQuery(
    language === 'am' ? 'የሾፌር ቦቱን ክፈቱና Start ይጫኑ።' : 'Open the driver bot and press Start first.',
    {
    show_alert: true
    }
  );
  return false;
}

export async function ensurePrivateDriverChat(
  ctx: ReplyContext,
  language: SupportedLanguageCode = 'en'
): Promise<boolean> {
  if (ctx.chat?.type === 'private') {
    return true;
  }

  await ctx.reply(
    language === 'am' ? 'እባክዎ ለዚህ የሾፌር ቦት የግል ቻት ይጠቀሙ።' : 'Please use the driver bot private chat for this.'
  );
  return false;
}
