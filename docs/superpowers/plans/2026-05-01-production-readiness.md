# Production Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden the Railway backend and Vercel Mini App for a first real production launch.

**Architecture:** Add operational health/readiness endpoints, admin recovery APIs, Mini App outage UX, configurable database pool limits, a local load test, and deployment/operator documentation. Keep existing bot, outbox, idempotency, and recovery-worker architecture.

**Tech Stack:** Node.js, TypeScript, Express, Telegraf, PostgreSQL, React, Vite, Vitest, Railway, Vercel.

---

### Task 1: Runtime Config and Readiness

**Files:**
- Modify: `src/config/env.ts`
- Modify: `src/db/client.ts`
- Modify: `src/db/postgresRidePoolStore.ts`
- Modify: `src/http/app.ts`
- Test: `tests/env.test.ts`
- Test: `tests/readiness.test.ts`

- [ ] Add `PG_POOL_MAX`, `PG_IDLE_TIMEOUT_MS`, and `PG_CONNECTION_TIMEOUT_MS` to config.
- [ ] Use those values in `createPgPool`.
- [ ] Add store methods for outbox status counts and stuck workflow counts.
- [ ] Add `GET /ready` returning database, queue, workflow, and config health.
- [ ] Test env parsing and readiness response.

### Task 2: Admin Recovery Controls

**Files:**
- Modify: `src/http/app.ts`
- Modify: `src/db/postgresRidePoolStore.ts`
- Modify: `src/domain/types.ts`
- Modify: `frontend/src/api.ts`
- Modify: `frontend/src/AdminApp.tsx`
- Modify: `frontend/src/types.ts`
- Modify: `frontend/src/styles.css`
- Test: `tests/adminOperations.test.ts`

- [ ] Add admin endpoint to repost a ready pool driver alert.
- [ ] Add admin endpoint to cancel an open or ready pool before assignment.
- [ ] Add admin endpoint to retry failed notifications.
- [ ] Add admin dashboard action buttons in pool detail and health panel.
- [ ] Test admin recovery behavior.

### Task 3: Mini App Production Safeguards

**Files:**
- Modify: `frontend/src/api.ts`
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/AdminApp.tsx`
- Modify: `frontend/src/styles.css`
- Test: `frontend/src/appState.test.ts`

- [ ] Make API errors preserve offline/network failures.
- [ ] Show clear retry screens for passenger/admin API outage.
- [ ] Keep Telegram-required screen for missing init data.
- [ ] Test error copy helpers.

### Task 4: Load Test

**Files:**
- Create: `scripts/load-test.ts`
- Modify: `package.json`

- [ ] Add `npm run load:test`.
- [ ] Simulate 1200 passenger actions and 300 completed seats through service/store logic.
- [ ] Include concurrent driver accepts for the same pool.
- [ ] Print duration, created pools, completed trips, and failures.

### Task 5: Deployment and Operations Docs

**Files:**
- Create: `docs/production-operations.md`
- Modify: `README.md`
- Modify: `.env.example`
- Modify: `frontend/.env.example`
- Modify: `railway.json`

- [ ] Document Railway env vars, Vercel env vars, BotFather steps, webhook checks, backup/export, and daily operations.
- [ ] Add readiness endpoint to Railway config if supported.
- [ ] Update README with a short production launch checklist.

### Task 6: Full Verification

**Commands:**
- `npm test`
- `npm run typecheck`
- `npm run build`
- `npm test --prefix frontend`
- `npm run build --prefix frontend`

- [ ] Run all commands and record results in final response.
