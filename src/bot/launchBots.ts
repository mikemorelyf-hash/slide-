import type { Context, Telegraf } from 'telegraf';

type LaunchableBot = Pick<Telegraf<Context>, 'launch'>;

interface StartPollingBotsInput {
  passengerBot: LaunchableBot;
  driverBot?: LaunchableBot | null;
  onError: (error: unknown) => void;
}

export function startPollingBots({
  passengerBot,
  driverBot,
  onError
}: StartPollingBotsInput): number {
  const bots = [passengerBot, driverBot].filter((bot): bot is LaunchableBot => Boolean(bot));

  for (const bot of bots) {
    void bot.launch().catch(onError);
  }

  return bots.length;
}
