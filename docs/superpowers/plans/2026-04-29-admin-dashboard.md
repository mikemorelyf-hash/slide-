# Admin Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first admin operations dashboard with real backend data, admin-only access, route price management, pool monitoring, and pool detail inspection.

**Architecture:** Add admin-specific domain view types and backend helper functions, expose `/api/admin/*` endpoints from the existing Express app, then add a React `/admin` route inside the existing Vercel frontend. The dashboard uses Telegram Mini App init data and only allows IDs from `ADMIN_TELEGRAM_IDS`.

**Tech Stack:** Node.js, TypeScript, Express, PostgreSQL, Telegraf, React, Vite, Vitest, lucide-react.

---

### Task 1: Admin Backend View Helpers

**Files:**
- Create: `src/domain/adminTypes.ts`
- Create: `src/http/adminState.ts`
- Test: `tests/adminState.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/adminState.test.ts` with tests for admin authorization, route price parsing, and overview metric calculation.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/adminState.test.ts`
Expected: FAIL because `src/http/adminState.ts` does not exist.

- [ ] **Step 3: Implement minimal helper code**

Add admin types in `src/domain/adminTypes.ts` and helper functions in `src/http/adminState.ts`:
- `isAdminTelegramId(telegramId, adminTelegramIds)`
- `parseRoutePriceBody(body)`
- `buildAdminOverview({ routes, pools, completedToday })`

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/adminState.test.ts`
Expected: PASS.

### Task 2: Admin Store Queries

**Files:**
- Modify: `src/db/postgresRidePoolStore.ts`

- [ ] **Step 1: Add all-routes query**

Add `listRoutes()` to return routes regardless of active state.

- [ ] **Step 2: Add admin pool summary query**

Add `listAdminPoolSummaries(limit = 50)` returning recent pools with passenger counts, captain profile, driver profile, and pool timestamps.

- [ ] **Step 3: Add admin pool detail query**

Add `getAdminPoolDetail(poolId)` returning one summary plus passenger manifest rows.

- [ ] **Step 4: Add completed-today count query**

Add `countCompletedPoolsSince(since: Date)` for the overview counter.

- [ ] **Step 5: Run typecheck**

Run: `npm run typecheck`
Expected: PASS.

### Task 3: Admin HTTP API

**Files:**
- Modify: `src/http/app.ts`
- Test: `tests/adminState.test.ts`

- [ ] **Step 1: Add endpoint tests for price body behavior through helpers**

Extend `tests/adminState.test.ts` with missing route price cases: invalid amount, empty currency, valid default currency.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/adminState.test.ts`
Expected: FAIL until helper behavior exists.

- [ ] **Step 3: Add admin auth middleware**

In `src/http/app.ts`, refactor Mini App auth into a reusable authentication helper and add `requireAdminMiniAppAuth`.

- [ ] **Step 4: Add admin endpoints**

Add:
- `GET /api/admin/overview`
- `GET /api/admin/routes`
- `PATCH /api/admin/routes/:routeId/price`
- `GET /api/admin/pools`
- `GET /api/admin/pools/:poolId`

- [ ] **Step 5: Run backend tests and typecheck**

Run: `npm test -- tests/adminState.test.ts && npm run typecheck`
Expected: PASS.

### Task 4: Admin Bot Entry Point

**Files:**
- Modify: `src/bot/createBot.ts`

- [ ] **Step 1: Add Admin Dashboard web app button**

When an authorized admin runs `/admin` and `MINI_APP_URL` is set, include an inline `Open Admin Dashboard` web app button pointing to `${MINI_APP_URL}/admin`.

- [ ] **Step 2: Run bot-related tests**

Run: `npm test`
Expected: PASS.

### Task 5: Frontend Admin API and Helpers

**Files:**
- Modify: `frontend/src/types.ts`
- Modify: `frontend/src/api.ts`
- Create: `frontend/src/adminState.ts`
- Test: `frontend/src/appState.test.ts`

- [ ] **Step 1: Write failing frontend helper tests**

Extend `frontend/src/appState.test.ts` for admin metric formatting and status labels.

- [ ] **Step 2: Run frontend helper tests**

Run: `npm test --prefix frontend -- src/appState.test.ts`
Expected: FAIL because admin helpers do not exist.

- [ ] **Step 3: Add admin types, API functions, and helpers**

Add admin dashboard types to `frontend/src/types.ts`, admin API calls to `frontend/src/api.ts`, and formatting helpers to `frontend/src/adminState.ts`.

- [ ] **Step 4: Run frontend helper tests**

Run: `npm test --prefix frontend -- src/appState.test.ts`
Expected: PASS.

### Task 6: Frontend Admin Dashboard UI

**Files:**
- Create: `frontend/src/AdminApp.tsx`
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/styles.css`

- [ ] **Step 1: Route `/admin` to AdminApp**

In `frontend/src/App.tsx`, render `AdminApp` when `window.location.pathname` starts with `/admin`; keep passenger UI unchanged for all other paths.

- [ ] **Step 2: Build AdminApp**

Create `frontend/src/AdminApp.tsx` with top bar, metric cards, status filters, route price editor, pool table, and pool detail panel.

- [ ] **Step 3: Add dashboard CSS**

Extend `frontend/src/styles.css` with responsive admin dashboard styles using compact operational layout and no nested cards.

- [ ] **Step 4: Run frontend build**

Run: `npm run build --prefix frontend`
Expected: PASS.

### Task 7: Final Verification

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Document admin dashboard**

Update README with admin dashboard URL, auth requirement, and endpoints.

- [ ] **Step 2: Run all verification**

Run:
```bash
npm run typecheck
npm test
npm run build
npm test --prefix frontend
npm run build --prefix frontend
```
Expected: all commands PASS.

- [ ] **Step 3: No commit**

This workspace is not a git repository, so no commit is possible here.
