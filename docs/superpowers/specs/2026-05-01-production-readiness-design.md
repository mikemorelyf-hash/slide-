# Production Readiness Design

## Goal

Prepare the ride-pool backend and Mini App for a real first production launch that can handle roughly 1200 passengers per day and about 300 completed seats per day.

## Scope

This phase hardens the current product. It does not add real payment processing, driver payouts, marketing pages, or a new passenger design. Those can follow after the deployment foundation is reliable.

## Recommended Approach

Use a staged production launch:

1. Harden the Railway backend.
2. Harden the Vercel Mini App.
3. Add admin operations controls.
4. Add a repeatable load test.
5. Write deployment, backup, and daily operations instructions.

## Backend Production Design

The backend will support webhook mode for both Telegram bots. Passenger bot updates use `WEBHOOK_PATH`; driver bot updates use `DRIVER_WEBHOOK_PATH`. Polling remains available for local testing only.

The backend will expose:

- `GET /health`: simple liveness check used to show the process is up.
- `GET /ready`: readiness check that verifies database access, pending/failed notification counts, stuck workflow counts, and configuration basics.

Database connection limits will move from a hardcoded value to environment variables so Railway can be tuned without code changes:

- `PG_POOL_MAX`
- `PG_IDLE_TIMEOUT_MS`
- `PG_CONNECTION_TIMEOUT_MS`

The default values should be conservative for Railway Postgres and one Node process.

## Admin Operations Design

The admin dashboard already shows pool and route state. It will gain production controls:

- System health details from `/ready`.
- Pending and failed notification counts.
- Stuck pool list with clear reasons.
- Repost driver alert for ready pools.
- Cancel pool before it is assigned.
- Retry failed notification sends.

Admin actions must require Telegram Mini App admin auth and must write pool events where they change workflow state.

## Mini App Production Design

The Mini App will be treated as a production deployment, not only a local preview.

Passenger and admin UI will:

- Use `VITE_API_BASE_URL` in production.
- Keep Telegram init data auth enforced.
- Show a clear “service unavailable, retry” screen if Railway is down.
- Keep existing Telegram-required screens for browser-only access.
- Preserve the dark Side brand theme.

Deployment configuration will document:

- Vercel project root: `frontend`.
- Vercel env: `VITE_API_BASE_URL=https://<railway-url>`.
- Railway env: `MINI_APP_URL=https://<vercel-url>`.
- Railway env: `FRONTEND_ORIGIN=https://<vercel-url>`.
- BotFather Mini App/menu setup.

## Load Test Design

Add a local script that exercises core backend domain flows without Telegram network calls:

- Creates pools.
- Confirms passenger payments.
- Fills and early-dispatches pools.
- Assigns drivers.
- Confirms arrival.
- Completes trips.
- Verifies no duplicate assignment when concurrent accepts happen.

The target simulation is 1200 passengers/day and 300 seats/day, scaled into a short local run. The script will report duration, created pools, completed trips, and failures.

## Operations Design

Add an operator guide that explains:

- How to deploy backend on Railway.
- How to deploy Mini App/admin on Vercel.
- What env vars are required.
- How to confirm Telegram webhooks are set.
- What to check every day.
- How to respond to pending notifications, failed notifications, and stuck pools.
- How to export a Postgres backup.
- How to roll back safely.

## Success Criteria

- Railway backend can be run in webhook mode with both bots.
- Vercel Mini App knows the Railway API URL.
- `/ready` returns useful operational health data.
- Admin can see and recover common stuck workflow states.
- Notification failures are visible and retryable.
- Load test can run locally and produce a clear report.
- All backend and frontend tests/builds pass.
