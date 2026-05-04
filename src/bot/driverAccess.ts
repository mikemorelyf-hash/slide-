import type { Context } from 'telegraf';

interface DriverAccessStore {
  hasDriverBotStarted(telegramId: string): Promise<boolean>;
}

type CallbackContext = Pick<Context, 'answerCbQuery'>;
type ReplyContext = Pick<Context, 'chat' | 'reply'>;

export async function ensureDriverBotStarted(
  ctx: CallbackContext,
  store: DriverAccessStore,
  telegramId: string
): Promise<boolean> {
  if (await store.hasDriverBotStarted(telegramId)) {
    return true;
  }

  await ctx.answerCbQuery('Open the driver bot and press Start first.', {
    show_alert: true
  });
  return false;
}

export async function ensurePrivateDriverChat(ctx: ReplyContext): Promise<boolean> {
  if (ctx.chat?.type === 'private') {
    return true;
  }

  await ctx.reply('Please use the driver bot private chat for this.');
  return false;
}
