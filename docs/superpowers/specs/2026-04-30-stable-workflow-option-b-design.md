# Stable Workflow Option B Design

## Goal

Make the Telegram ride-pool system stable enough for daily public use. If the backend crashes, Railway restarts, Telegram sends duplicate updates, or many people click the same button at the same time, the system should recover from PostgreSQL and continue users from their correct step.

The core design is: PostgreSQL is the source of truth, every workflow action is a guarded state transition, Telegram sends are retried through an outbox, and background recovery workers repair stuck states.

## Non-Goals

- No fake data.
- No full payment processor integration in this phase.
- No separate microservice architecture yet.
- No complex queue system like Kafka or RabbitMQ yet.
- No destructive admin actions without explicit confirmation.

## Current Problems This Solves

- Users can feel stuck when an old active pool blocks new actions.
- A pool can become ready while the Telegram driver alert fails to send.
- A pending passenger can lag behind while a pool moves forward.
- Old Telegram inline buttons can be tapped after the workflow has already changed.
- Multiple users or drivers can click the same action at the same time.
- After a crash, the app needs a deterministic way to continue from the last saved state.

## Architecture

The backend stays as one Node.js service on Railway:

- Express HTTP API for Mini App and admin dashboard.
- Passenger Telegram bot webhook.
- Driver Telegram bot webhook.
- PostgreSQL database.
- Background recovery workers running inside the same backend process.

The backend must remain stateless. It can keep timers in memory for convenience, but all important state must be stored in PostgreSQL before responding to a user.

## State Machine

Pool status should become explicit and easy to reason about:

- `open`: passengers can join and confirm payment.
- `ready`: pool is ready for a driver; driver-group alert should exist.
- `assigned`: one driver accepted; waiting for arrival.
- `arrival_requested`: driver says they arrived; waiting for passenger confirmation.
- `in_progress`: passenger confirmed arrival; driver can complete with PIN.
- `completed`: trip finished.
- `cancelled`: admin or workflow cancellation.
- `expired`: automatic cleanup, such as unpaid seat timeout.

The current system stores arrival request as a timestamp while status stays `assigned`. This works, but production operations will be clearer if `arrival_requested` becomes its own status.

Only valid transitions are allowed:

```text
open -> ready
open -> cancelled
open -> expired
ready -> assigned
ready -> cancelled
assigned -> arrival_requested
assigned -> ready
assigned -> cancelled
arrival_requested -> in_progress
arrival_requested -> assigned
arrival_requested -> ready
in_progress -> completed
in_progress -> cancelled
```

Every transition must be conditional on the current status. For example, accepting a driver job should only succeed when the row is still `ready`.

## Data Model Additions

### `pool_events`

Stores a permanent timeline of what happened.

Fields:

- `id`
- `pool_id`
- `actor_telegram_id`
- `actor_role`
- `event_type`
- `from_status`
- `to_status`
- `metadata_json`
- `created_at`

Examples:

- `pool_created`
- `passenger_joined`
- `payment_confirmed`
- `pool_ready`
- `driver_alert_queued`
- `driver_alert_sent`
- `driver_assigned`
- `arrival_requested`
- `arrival_confirmed`
- `trip_completed`
- `pool_cancelled`
- `recovery_reposted_driver_alert`

This gives admin support and debugging a reliable history.

### `idempotency_keys`

Prevents duplicate processing of Telegram callbacks, Mini App button presses, and retries.

Fields:

- `key`
- `source`
- `actor_telegram_id`
- `request_hash`
- `status`
- `response_json`
- `created_at`
- `expires_at`

Common keys:

- Telegram callback query id.
- Telegram update id.
- Mini App action key such as `passenger:{telegramId}:confirm-payment:{poolId}`.

If the same key arrives again, the backend returns the saved result instead of repeating the action.

### `notification_outbox`

Stores Telegram messages that must be sent.

Fields:

- `id`
- `target_bot`
- `chat_id`
- `message_type`
- `payload_json`
- `status`
- `telegram_message_id`
- `attempt_count`
- `next_attempt_at`
- `last_error`
- `created_at`
- `sent_at`

Statuses:

- `pending`
- `sending`
- `sent`
- `failed`
- `cancelled`

Important rule: state changes happen first inside a transaction, then notification rows are created. A worker sends the messages afterward. If Telegram is down or Railway restarts, the message remains pending and is retried.

### `pool_passengers` Reservation Fields

Makes pool capacity clear when people join before payment.

The existing `pool_passengers` table should be extended instead of adding a separate reservation table. One table should own the passenger's seat state.

New fields:

- `status`
- `reservation_expires_at`

Statuses:

- `reserved`
- `confirmed`
- `expired`
- `cancelled`

The current `payment_status` can either be replaced by this clearer `status` field or mapped during migration. The important rule is that both reserved and confirmed seats count toward capacity until reserved seats expire.

This prevents the “too many people joined, only some paid” confusion. A seat can be reserved for a short period, such as 5 minutes. If the passenger does not confirm payment, the reservation expires and the seat opens again.

## Passenger Flow

1. Passenger opens bot or Mini App.
2. Backend reads current passenger state from PostgreSQL.
3. If passenger has active confirmed trip, show that trip.
4. If passenger has pending reservation, show payment step with countdown.
5. If no active workflow, show routes.
6. Passenger chooses a route with a valid price.
7. Backend either lists joinable pools or creates a new pool.
8. Passenger reserves a seat.
9. Passenger confirms payment.
10. Backend confirms seat and shows PIN only to confirmed passengers.
11. Pool becomes `ready` when enough confirmed seats exist or early dispatch is approved.
12. Passenger sees clear status until completion.

Passenger messages should always answer:

- What route am I in?
- What step am I on?
- What should I do next?
- Can I cancel?
- Who has the PIN?

## Driver Flow

1. Driver starts driver bot once.
2. Driver sees jobs in driver group.
3. Driver taps `Accept Job`.
4. Backend runs one atomic state transition:

```sql
UPDATE pools
SET status = 'assigned',
    driver_telegram_id = $driverId,
    accepted_at = NOW()
WHERE id = $poolId
  AND status = 'ready'
  AND driver_telegram_id IS NULL
RETURNING *;
```

5. Exactly one driver wins.
6. Losing drivers get “job already taken.”
7. Driver gets manifest without the pool PIN.
8. Driver taps `I Arrived`.
9. Passenger confirms arrival.
10. Driver enters PIN.
11. Trip completes.

Driver messages should always answer:

- Did I get the job?
- Which route?
- Who are the passengers?
- What is the next action?
- Why do I not see the PIN? Because passengers provide it after the trip.

## Admin Flow

The admin dashboard becomes the operational command center.

Dashboard sections:

- Live pools by status.
- Stuck workflow alerts.
- Pending Telegram notifications.
- Route price table.
- Driver jobs waiting too long.
- Passengers with expired or pending reservations.
- Pool event timeline.

Admin actions:

- Repost driver job.
- Cancel pool.
- Expire pending reservation.
- Remove passenger from open pool.
- Mark route inactive.
- Set route price.
- View failed Telegram notification.
- Retry failed notification.

Admin actions must also go through guarded transitions and write `pool_events`.

## Recovery Workers

Run every 30-60 seconds in the backend process.

### Notification Outbox Worker

Finds pending notifications where `next_attempt_at <= NOW()`, marks one row as `sending`, sends to Telegram, then marks it `sent` or schedules retry.

Retry delays:

- Attempt 1: immediate.
- Attempt 2: 10 seconds.
- Attempt 3: 30 seconds.
- Attempt 4: 2 minutes.
- Attempt 5: 10 minutes.

After too many failures, mark `failed` and alert admin.

### Pool Recovery Worker

Repairs safe stuck states:

- `ready` with no sent driver alert: queue driver alert.
- `assigned` past driver arrival timeout: reset to `ready`, clear driver, queue repost.
- `arrival_requested` too long: remind passengers and admin.
- `open` with expired reserved passenger seats: expire seats.
- `open` with zero confirmed/reserved seats: cancel stale pool after configured timeout.

### Startup Reconciliation

When the backend starts:

- Run migrations.
- Register passenger and driver webhooks.
- Run one immediate recovery sweep.
- Resume pending notifications.

This means a crash or Railway redeploy does not lose work.

## Concurrency Rules

Every user action must follow this pattern:

1. Build idempotency key.
2. Start database transaction.
3. Lock related pool row with `FOR UPDATE`.
4. Check current status and actor permission.
5. Apply exactly one valid transition.
6. Insert `pool_events`.
7. Insert `notification_outbox` rows.
8. Save idempotency result.
9. Commit.
10. Return response.

This handles multiple people clicking the same button at the same time.

Examples:

- Two drivers accept the same job: one `UPDATE ... WHERE status='ready'` succeeds, the other gets no row and receives “job already taken.”
- Passenger taps `I Have Paid` twice: first request confirms payment, second request returns saved idempotency result.
- Passenger taps old route button from yesterday: backend checks current state and says “This action is no longer active.”
- Railway crashes after state change but before Telegram message sends: outbox row remains and worker sends it after restart.

## Data Integrity Rules

Recommended constraints:

- One active passenger workflow at a time.
- One active driver assignment per pool.
- Confirmed passenger count cannot exceed pool size.
- Pool cannot be ready unless it has at least one confirmed passenger and a valid route price.
- Driver cannot complete trip unless pool is `in_progress`.
- Driver cannot see pool PIN in backend-generated driver messages.

Some constraints can be database constraints. Others can be service-level checks covered by tests.

## User Experience Rules

No role should need to guess.

Passenger:

- “You are waiting for 2 more passengers.”
- “Your seat reservation expires in 4:30.”
- “Payment confirmed. Your PIN is 1234.”
- “Driver assigned. Waiting for arrival.”

Driver:

- “You accepted the job.”
- “Tap I Arrived when you reach passengers.”
- “Ask passengers for the PIN after the trip.”
- “Invalid PIN. Ask passengers to confirm the code.”

Admin:

- “Pool ready but driver alert not sent.”
- “Driver assigned 12 minutes ago, no arrival.”
- “3 Telegram messages failed.”
- “Route has no price, passengers cannot book it.”

## Operations Playbook

Daily admin checklist:

- Check active pools.
- Check failed notifications.
- Check stuck workflow alerts.
- Check all active routes have prices.
- Check old open pools.

If users report stuck state:

1. Search passenger in admin dashboard.
2. Open their active pool.
3. Read pool event timeline.
4. Use safe admin action:
   - retry notification,
   - repost job,
   - expire reservation,
   - cancel pool.
5. Ask user to send `/start` or reopen Mini App.

If backend crashes:

1. Railway restart policy should restart it automatically.
2. Check `/health`.
3. Check Railway logs for startup webhook registration.
4. Check admin dashboard stuck alerts.
5. Recovery workers should continue pending notifications and stuck jobs.

If Telegram group is wrong:

1. Update `DRIVER_GROUP_CHAT_ID`.
2. Restart/redeploy backend.
3. Admin reposts ready pools.

## Rollout Plan

Phase 1: make states explicit and add tests.

- Add `arrival_requested`.
- Add transition helper functions.
- Add tests for every allowed/blocked transition.

Phase 2: add idempotency.

- Add `idempotency_keys`.
- Wrap Telegram callbacks and Mini App actions.
- Add duplicate-click tests.

Phase 3: add outbox.

- Add `notification_outbox`.
- Move Telegram sends out of request transactions.
- Add retry worker.

Phase 4: add recovery workers.

- Missing driver alert recovery.
- Late driver repost.
- Expired reservation cleanup.
- Startup reconciliation.

Phase 5: upgrade admin dashboard.

- Stuck alerts.
- Pool timeline.
- Retry/repost/cancel controls.

## Testing Strategy

Backend tests:

- Every state transition succeeds only from the right previous state.
- Repeated callback is idempotent.
- Two drivers accepting same job results in exactly one assignment.
- Over-capacity passenger join is blocked.
- Telegram send failure leaves outbox row pending.
- Recovery worker reposts missing driver alert.
- Expired pending reservation frees the passenger.

Frontend tests:

- Passenger state labels match backend status.
- Unpriced routes are disabled.
- Completed trips can be dismissed without breaking route browsing.
- Admin stuck-state labels are clear.

Manual production checks:

- Railway deploy succeeds.
- `/health` returns 200.
- Passenger bot webhook registered.
- Driver bot webhook registered.
- Admin dashboard opens from Telegram.
- A full test ride completes end to end.

## Success Criteria

- Backend restart does not lose user progress.
- Duplicate Telegram callbacks do not duplicate side effects.
- Old buttons return clear “not available anymore” messages.
- No passenger can be trapped by an old pending or departed pool.
- No ready pool can remain invisible to drivers without admin visibility.
- Admin can see and resolve stuck states without direct database access.
