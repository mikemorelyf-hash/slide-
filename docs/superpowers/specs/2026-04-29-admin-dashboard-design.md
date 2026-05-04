# Admin Dashboard Design

## Goal

Build the first admin dashboard as an operations command center for the ride-pool business. The dashboard should help an admin monitor live Telegram workflow state, inspect pools, and manage route prices using real backend data only.

## Scope

This first version focuses on operational visibility and simple management:

- Live overview counters for active pools, open pools, jobs waiting for a driver, arrival confirmations pending, in-progress trips, and completed trips.
- Route management table with current price and quick price update.
- Pool table with route, status, confirmed passengers, driver, PIN, early-dispatch flag, and arrival state.
- Pool detail panel with passenger manifest, captain marker, phone number, Telegram username, driver profile, and timestamps.
- Admin-only API access based on Telegram Mini App init data and `ADMIN_TELEGRAM_IDS`.

The dashboard will not include fake charts, mocked payment revenue, full staff accounts, or destructive operations in this slice.

## Architecture

The existing Express backend will expose admin API endpoints under `/api/admin/*`. These endpoints will reuse the existing Telegram Mini App auth validation, then require the authenticated Telegram ID to be listed in `ADMIN_TELEGRAM_IDS`.

The existing React app in `frontend/` will support an admin route at `/admin` beside the passenger Mini App. It will use the same Vercel app and the same `VITE_API_BASE_URL`.

## Backend Endpoints

- `GET /api/admin/overview`: returns operational counters and recent active pools.
- `GET /api/admin/routes`: returns active and inactive routes with prices.
- `PATCH /api/admin/routes/:routeId/price`: updates a route price.
- `GET /api/admin/pools`: returns recent/live pools with summary fields.
- `GET /api/admin/pools/:poolId`: returns one pool with passenger manifest and driver profile.

All admin endpoints require Telegram Mini App init data and admin authorization.

## Frontend Experience

The admin dashboard should feel like a compact operational tool, not a marketing page:

- Top bar with dashboard title, authenticated admin name, and refresh action.
- Metric cards for key workflow counts.
- Tabs or segmented filters for active pools, waiting driver, arrival pending, in trip, completed.
- Dense pool table on desktop and readable stacked rows on mobile.
- Route price editor with inline save state and validation.
- Details panel when a pool is selected.

## Error Handling

Unauthorized users see a clear admin access message.

API failures show a compact error banner and keep the last successful data on screen when possible.

Price updates validate positive numeric amounts before submission. Failed saves leave the old value visible and show an error.

## Testing

Backend tests should cover admin authorization, overview shape, pool list/detail data, and route price update validation.

Frontend tests should cover admin state formatting and route/pool status helpers where logic is non-trivial.

Existing typecheck, backend tests, backend build, and frontend build must pass before delivery.
