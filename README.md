# Telegram Ride Pool Backend

Phase 1 backend for the Telegram ride pooling bot. It runs a Telegraf bot, an Express HTTP server, PostgreSQL persistence, Telegram webhook support for Railway, and Mini App auth-ready API endpoints.

The `frontend/` folder contains the passenger Telegram Mini App, built with React and ready for Vercel.

## What Is Included

- Passenger route selection with Telegram inline buttons.
- Pool creation and joining with manual `I Have Paid` confirmation.
- Shared 4-digit pool PIN per pool.
- Automatic driver group alert when a pool reaches `POOL_SIZE`.
- First-driver-wins `Accept Job` flow.
- Driver manifest built from real Telegram users and saved contact numbers.
- Separate driver bot support through `DRIVER_BOT_TOKEN`.
- Captain-led early dispatch voting.
- Passenger-confirmed driver arrival before a trip can be completed.
- Driver `/complete PIN` trip completion after arrival is confirmed by any confirmed passenger.
- Late-driver repost sweep after `DRIVER_ARRIVAL_TIMEOUT_MINUTES` if no passenger confirms arrival.
- Basic admin visibility through `/admin`, `/pools`, and `/jobs`.
- Admin route pricing with `/admin_routes` and `/set_price`.
- Passenger Mini App API through Telegram init data validation.
- React passenger Mini App with route selection, phone profile, pool status, payment confirmation, early dispatch, and driver arrival confirmation.
- Admin operations dashboard at `/admin` with live pool monitoring, route price editing, pool detail inspection, failed-notification retry, and stuck-pool recovery controls.
- Railway readiness checks at `/ready`, database connection pool limits, and a local load test for 1,200 user / 300 seat day behavior.

## Local Setup

1. Install dependencies:

```bash
npm install
```

2. Fill `.env` with real values:

```bash
BOT_TOKEN=...
DRIVER_BOT_TOKEN=...
DATABASE_URL=...
PG_POOL_MAX=6
PG_IDLE_TIMEOUT_MS=15000
PG_CONNECTION_TIMEOUT_MS=5000
DRIVER_GROUP_CHAT_ID=...
```

3. Run locally in polling mode:

```bash
npm run dev
```

The app auto-creates the database tables on startup. If `AUTO_SEED_ROUTES=true`, routes are upserted from the pipe-separated `ROUTES` env var.

## Railway Deploy

Set these Railway variables:

```bash
NODE_ENV=production
BOT_MODE=webhook
BOT_TOKEN=...
DRIVER_BOT_TOKEN=...
DATABASE_URL=...
BASE_URL=https://your-railway-service.up.railway.app
WEBHOOK_SECRET=<random 32+ character string>
DRIVER_WEBHOOK_PATH=/telegram/driver-webhook
DRIVER_GROUP_CHAT_ID=-100...
ADMIN_CHAT_ID=<optional admin notification chat>
ADMIN_TELEGRAM_IDS=12345,67890
MINI_APP_URL=https://your-vercel-app.vercel.app
ROUTES=Mexico -> Bole|Mexico -> Piyasa|Mexico -> CMC
FRONTEND_ORIGIN=https://your-vercel-app.vercel.app
PG_POOL_MAX=6
PG_IDLE_TIMEOUT_MS=15000
PG_CONNECTION_TIMEOUT_MS=5000
```

Railway will run `npm start` from `railway.json`, restart on failure, and check `/ready` before considering the service healthy. Make sure the build step runs `npm run build`; Nixpacks detects this automatically for Node projects.

## Passenger Mini App

Local frontend setup:

```bash
cd frontend
npm install
npm run dev
```

For Vercel, set:

```bash
VITE_API_BASE_URL=https://your-railway-service.up.railway.app
```

Then set the Mini App URL in BotFather to your Vercel URL. Local browser testing shows the Telegram-required screen unless you provide real Telegram Mini App init data.

Also set the same Vercel URL as `MINI_APP_URL` on Railway. The passenger bot will show an `Open Passenger App` button on `/start` and `/routes`.

## Admin Dashboard

The admin dashboard is served by the same Vercel frontend at:

```text
https://your-vercel-app.vercel.app/admin
```

Open it from Telegram by running `/admin` in the passenger bot. If `MINI_APP_URL` is set, authorized admins will see an `Open Admin Dashboard` button.

Access requires Telegram Mini App auth and the admin Telegram ID must be listed in `ADMIN_TELEGRAM_IDS`.

The dashboard includes a System Health section. Use `Retry Failed Sends` when Telegram send attempts failed, `Repost Driver Alert` when a ready pool has no driver response, and `Cancel Pool` only before a driver accepts.

## Bot Commands

- `/start` shows active routes.
- `/routes` shows active routes again.
- `/profile` lets users share phone number; Telegram name/username is saved automatically.
- `/my_pool` shows current pool status, captain early-dispatch controls, and arrival confirmation controls when available.
- `/cancel` cancels a passenger before dispatch.
- Driver bot accepts a plain 4-digit PIN like `4334`, or `/complete 4334`, after passenger-confirmed arrival.
- `/admin`, `/pools`, `/jobs` provide basic admin visibility for IDs in `ADMIN_TELEGRAM_IDS`.
- `/admin` also shows the admin dashboard button when `MINI_APP_URL` is set.
- `/admin_routes` lists route IDs and prices.
- `/set_price <route_id> <amount> [currency]` updates a route price, for example `/set_price 1 120 ETB`.

## HTTP Endpoints

- `GET /health` checks the database connection.
- `GET /ready` checks database, outbox, stuck workflow, Telegram mode, and Mini App readiness for Railway.
- `GET /api/routes` returns active database routes.
- `GET /api/me` requires Telegram Mini App init data in `X-Telegram-Init-Data` or `Authorization: tma <initData>`.
- `GET /api/passenger/state` returns authenticated passenger state for the Mini App.
- `POST /api/passenger/profile` updates passenger phone number.
- `POST /api/passenger/pools` creates or joins a pool for a route.
- `POST /api/passenger/pools/:poolId/confirm-payment` confirms manual payment.
- `POST /api/passenger/pools/:poolId/early-dispatch` starts captain early dispatch.
- `POST /api/passenger/pools/:poolId/arrival/confirm` confirms driver arrival.
- `POST /api/passenger/pools/:poolId/arrival/reject` rejects driver arrival.
- `GET /api/admin/overview` returns admin dashboard metrics, routes, and recent pools.
- `GET /api/admin/routes` returns all admin-visible routes.
- `PATCH /api/admin/routes/:routeId/price` updates a route price.
- `GET /api/admin/pools` returns recent pool summaries.
- `GET /api/admin/pools/:poolId` returns pool details with passenger manifest.
- `POST /api/admin/pools/:poolId/repost-driver-alert` reposts a ready pool to the driver group.
- `POST /api/admin/pools/:poolId/cancel` cancels an open/ready pool before driver assignment.
- `POST /api/admin/notifications/retry-failed` moves failed notification sends back to pending.
- `POST /telegram/webhook` receives Telegram updates in webhook mode.
- `POST /telegram/driver-webhook` receives driver bot updates when `DRIVER_BOT_TOKEN` is set.

## Production Checks

Run the full backend and Mini App verification before deploying:

```bash
npm test
npm run typecheck
npm run build
npm test --prefix frontend
npm run build --prefix frontend
npm run load:test
```

`npm run load:test` does not call Telegram or the real database. It simulates 1,200 passenger lookups, 300 completed seats, and 10 simultaneous driver accept clicks per pool.

## Notes

Runtime route data is not hardcoded in bot logic. Routes live in PostgreSQL and can be seeded from env for Railway.
