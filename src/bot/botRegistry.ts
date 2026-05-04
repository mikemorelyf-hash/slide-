import type { Context, Telegraf } from 'telegraf';

export interface BotRegistry {
  passengerBot?: Telegraf<Context>;
  driverBot?: Telegraf<Context>;
}
