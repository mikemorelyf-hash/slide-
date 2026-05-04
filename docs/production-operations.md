# Production Operations

This project runs as two deployed apps:

- Railway: Node.js backend, PostgreSQL access, Telegram webhooks, background recovery workers.
- Vercel: passenger Mini App and admin dashboard.

## Daily Health Check

1. Open the passenger bot and run `/admin`.
2. Tap `Open Admin Dashboard`.
3. Check `System Health`.
4. If readiness is `degraded`, read the warning messages before changing routes or prices.
5. If `Failed Sends` is above `0`, tap `Retry Failed Sends`.
6. If `Stuck Pools` is above `0`, open each pool and choose the safest action:
   - `Repost Driver Alert` for ready pools that need a driver.
   - `Cancel Pool` only when no driver has accepted yet.

## Railway Variables

Use webhook mode in production:

```env
NODE_ENV=production
BOT_MODE=webhook
BASE_URL=https://your-railway-service.up.railway.app
WEBHOOK_PATH=/telegram/webhook
DRIVER_WEBHOOK_PATH=/telegram/driver-webhook
WEBHOOK_SECRET=random_32_plus_character_secret
```

Database pool settings for the expected first production load:

```env
PG_POOL_MAX=6
PG_IDLE_TIMEOUT_MS=15000
PG_CONNECTION_TIMEOUT_MS=5000
```

For 1,200 users per day and 300 seats per day, this keeps database connections conservative on Railway while still allowing concurrent bot, Mini App, admin, and worker traffic. Increase `PG_POOL_MAX` only after checking Railway Postgres connection limits.

## Vercel Variables

```env
VITE_API_BASE_URL=https://your-railway-service.up.railway.app
```

Set the same Vercel URL on Railway:

```env
FRONTEND_ORIGIN=https://your-vercel-app.vercel.app
MINI_APP_URL=https://your-vercel-app.vercel.app
```

Then set the Telegram Mini App URL in BotFather for the passenger bot.

## Recovery Flow

The system stores the important workflow state in PostgreSQL:

- `pools`: route, PIN, status, driver, timestamps.
- `pool_passengers`: passenger membership, payment state, captain flag.
- `pool_events`: audit log for admin and debugging.
- `notification_outbox`: retryable Telegram messages.
- `idempotency_keys`: protects Mini App buttons from double-clicks and repeated requests.

If the server crashes, Railway restarts it. On startup, migrations run again safely, bot webhooks are re-registered, pending outbox messages remain in the database, and recovery workers continue from stored pool state.

## Simultaneous Clicks

Critical actions are protected server-side:

- Passenger payment and arrival actions use idempotency keys.
- Driver job acceptance updates one pool row inside a transaction.
- Only one driver can move a pool from `ready` to `assigned`.
- Late driver clicks get `already_taken` instead of overwriting the winner.

Run the simulation before production deploys:

```bash
npm run load:test
```

Expected result: `ok: true`, `usersSimulated: 1200`, `seatsCompleted: 300`, and one accepted driver per pool.

## Deployment Checklist

1. Backend: `npm test && npm run typecheck && npm run build && npm run load:test`.
2. Frontend: `npm test --prefix frontend && npm run build --prefix frontend`.
3. Railway: confirm `/ready` returns `ready` or an understood `degraded`.
4. Telegram: run `/start` in passenger bot and driver bot.
5. Admin: open `/admin` from Telegram and confirm health values load.
6. Test one full ride with two passenger accounts and one driver account before inviting real users.

## Backup And Export

Use Railway's PostgreSQL backup tools for scheduled backups. For a manual export from a machine that has access to the production `DATABASE_URL`:

```bash
pg_dump "$DATABASE_URL" --format=custom --file=side-backup.dump
```

For a readable SQL export:

```bash
pg_dump "$DATABASE_URL" --file=side-backup.sql
```

Keep database backups private. They include Telegram IDs, phone numbers, route history, trip status, and pool PIN audit data.
