# Stability Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Telegram ride-pool backend recover correctly after crashes, duplicate Telegram updates, failed Telegram sends, and multiple people clicking the same action at the same time.

**Architecture:** PostgreSQL becomes the only source of truth. Every workflow action becomes a guarded state transition that writes a pool event and queues Telegram notifications into a durable outbox before the response returns. Background workers retry pending notifications and repair stuck workflow states after Railway restarts the process.

**Tech Stack:** Node.js 20, TypeScript, Express, Telegraf, PostgreSQL, Vitest, Railway.

---

## Current Project Facts

- Backend entry point: `src/index.ts`
- Migration file: `src/db/migrate.ts`
- PostgreSQL store: `src/db/postgresRidePoolStore.ts`
- Business service: `src/domain/ridePoolService.ts`
- Domain types: `src/domain/types.ts`
- Passenger bot: `src/bot/createBot.ts`
- Driver bot: `src/bot/createDriverBot.ts`
- Current recovery loop: `src/bot/lateDriverRepost.ts`
- Passenger Mini App API: `src/http/app.ts`
- Passenger state mapper: `src/http/passengerState.ts`
- Admin dashboard state: `src/http/adminState.ts`
- Main backend test file: `tests/ridePoolService.test.ts`
- Current workflow states: `open`, `ready`, `assigned`, `in_progress`, `cancelled`, `completed`
- Current arrival request is stored as `arrival_requested_at` while status remains `assigned`
- Workspace currently has no `.git` folder, so each task ends with verification checkpoints instead of commit commands.

## File Structure

- Create `src/domain/poolStateMachine.ts`
  - Owns allowed pool transitions and stale-button explanations.
- Create `tests/poolStateMachine.test.ts`
  - Tests every allowed and blocked transition.
- Modify `src/domain/types.ts`
  - Adds `arrival_requested` and `expired`.
  - Adds event, idempotency, and notification outbox types.
- Modify `src/db/migrate.ts`
  - Adds new pool statuses.
  - Adds `pool_events`.
  - Adds `idempotency_keys`.
  - Adds `notification_outbox`.
  - Adds `reservation_expires_at` to `pool_passengers`.
- Modify `src/domain/ridePoolService.ts`
  - Uses the state machine for transitions.
  - Writes pool events during workflow mutations.
  - Uses conditional updates through store methods.
- Modify `src/db/postgresRidePoolStore.ts`
  - Adds event logging methods.
  - Adds idempotency methods.
  - Adds notification outbox methods.
  - Adds explicit transition methods using conditional `UPDATE ... WHERE status = ...`.
- Create `src/domain/idempotency.ts`
  - Builds stable keys for Telegram callbacks and Mini App actions.
  - Wraps work in a reusable idempotency guard.
- Create `tests/idempotency.test.ts`
  - Verifies duplicate keys return the saved result.
- Create `src/bot/notificationOutbox.ts`
  - Sends queued Telegram messages with retry delays.
- Create `tests/notificationOutbox.test.ts`
  - Verifies claim, send, retry, and failure behavior.
- Replace `src/bot/lateDriverRepost.ts` with `src/workers/recoveryWorker.ts`
  - Runs missing driver alert recovery, late-driver repost, stale arrival reminders, and expired reservation cleanup.
- Modify `src/index.ts`
  - Starts notification worker and recovery worker.
  - Runs one immediate reconciliation after startup.
- Modify `src/http/app.ts`
  - Uses idempotency wrapper for Mini App mutations.
  - Stops directly sending durable Telegram messages from request handlers.
- Modify `src/bot/createBot.ts`
  - Uses idempotency wrapper for callback actions.
  - Keeps immediate user replies only for user feedback.
- Modify `src/bot/createDriverBot.ts`
  - Uses idempotency wrapper for driver callbacks and PIN completion.
  - Keeps PIN hidden from driver messages.
- Modify `src/http/adminState.ts` and `frontend/src/AdminApp.tsx`
  - Shows stuck workflow alerts, pending notifications, and pool event timeline.

## Task 1: Add Explicit Pool State Machine

**Files:**
- Create: `src/domain/poolStateMachine.ts`
- Create: `tests/poolStateMachine.test.ts`
- Modify: `src/domain/types.ts`
- Modify: `src/http/passengerState.ts`

- [ ] **Step 1: Write the failing state-machine test**

Create `tests/poolStateMachine.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import {
  assertPoolTransition,
  canTransitionPool,
  explainBlockedTransition
} from '../src/domain/poolStateMachine.js';
import type { PoolStatus } from '../src/domain/types.js';

describe('pool state machine', () => {
  const allowed: Array<[PoolStatus, PoolStatus]> = [
    ['open', 'ready'],
    ['open', 'cancelled'],
    ['open', 'expired'],
    ['ready', 'assigned'],
    ['ready', 'cancelled'],
    ['assigned', 'arrival_requested'],
    ['assigned', 'ready'],
    ['assigned', 'cancelled'],
    ['arrival_requested', 'in_progress'],
    ['arrival_requested', 'assigned'],
    ['arrival_requested', 'ready'],
    ['in_progress', 'completed'],
    ['in_progress', 'cancelled']
  ];

  it.each(allowed)('allows %s -> %s', (from, to) => {
    expect(canTransitionPool(from, to)).toBe(true);
    expect(() => assertPoolTransition(from, to)).not.toThrow();
  });

  it('blocks stale old-button transitions', () => {
    expect(canTransitionPool('completed', 'ready')).toBe(false);
    expect(() => assertPoolTransition('completed', 'ready')).toThrow('Invalid pool transition');
  });

  it('returns a user-safe stale action explanation', () => {
    expect(explainBlockedTransition('completed')).toBe('This ride is already completed.');
    expect(explainBlockedTransition('cancelled')).toBe('This ride is no longer active.');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm test -- tests/poolStateMachine.test.ts
```

Expected: fail because `src/domain/poolStateMachine.ts` does not exist and `PoolStatus` does not include `arrival_requested` or `expired`.

- [ ] **Step 3: Update pool status type**

Modify `src/domain/types.ts`:

```ts
export type PoolStatus =
  | 'open'
  | 'ready'
  | 'assigned'
  | 'arrival_requested'
  | 'in_progress'
  | 'cancelled'
  | 'expired'
  | 'completed';
```

- [ ] **Step 4: Implement state machine**

Create `src/domain/poolStateMachine.ts`:

```ts
import type { PoolStatus } from './types.js';

const allowedTransitions = new Map<PoolStatus, PoolStatus[]>([
  ['open', ['ready', 'cancelled', 'expired']],
  ['ready', ['assigned', 'cancelled']],
  ['assigned', ['arrival_requested', 'ready', 'cancelled']],
  ['arrival_requested', ['in_progress', 'assigned', 'ready']],
  ['in_progress', ['completed', 'cancelled']],
  ['cancelled', []],
  ['expired', []],
  ['completed', []]
]);

export function canTransitionPool(from: PoolStatus, to: PoolStatus): boolean {
  return allowedTransitions.get(from)?.includes(to) ?? false;
}

export function assertPoolTransition(from: PoolStatus, to: PoolStatus): void {
  if (!canTransitionPool(from, to)) {
    throw new Error(`Invalid pool transition: ${from} -> ${to}`);
  }
}

export function explainBlockedTransition(status: PoolStatus): string {
  if (status === 'completed') {
    return 'This ride is already completed.';
  }

  if (status === 'cancelled' || status === 'expired') {
    return 'This ride is no longer active.';
  }

  return 'This action is no longer available for this ride.';
}
```

- [ ] **Step 5: Update passenger state mapping**

Modify `src/http/passengerState.ts`:

```ts
  const canConfirmArrival = isConfirmed && pool.status === 'arrival_requested';
```

and in `resolvePrimaryAction`:

```ts
  if (pool.status === 'arrival_requested') {
    return 'confirm_arrival';
  }
```

- [ ] **Step 6: Run state-machine test**

Run:

```bash
npm test -- tests/poolStateMachine.test.ts
```

Expected: pass.

## Task 2: Add Durable Stability Tables

**Files:**
- Modify: `src/db/migrate.ts`
- Modify: `src/domain/types.ts`

- [ ] **Step 1: Add domain types**

Modify `src/domain/types.ts`:

```ts
export type ActorRole = 'passenger' | 'driver' | 'admin' | 'system';

export type PoolEventType =
  | 'pool_created'
  | 'passenger_joined'
  | 'payment_confirmed'
  | 'pool_ready'
  | 'driver_alert_queued'
  | 'driver_alert_sent'
  | 'driver_assigned'
  | 'arrival_requested'
  | 'arrival_confirmed'
  | 'arrival_rejected'
  | 'trip_completed'
  | 'pool_cancelled'
  | 'pool_expired'
  | 'recovery_driver_reposted'
  | 'notification_failed';

export interface PoolEventInput {
  poolId: string;
  actorTelegramId: string | null;
  actorRole: ActorRole;
  eventType: PoolEventType;
  fromStatus: PoolStatus | null;
  toStatus: PoolStatus | null;
  metadata: Record<string, unknown>;
}

export type IdempotencyStatus = 'processing' | 'completed' | 'failed';

export type NotificationTargetBot = 'passenger' | 'driver';

export type NotificationStatus = 'pending' | 'sending' | 'sent' | 'failed' | 'cancelled';

export interface NotificationOutboxInput {
  targetBot: NotificationTargetBot;
  chatId: string;
  messageType: string;
  payload: Record<string, unknown>;
  nextAttemptAt?: Date;
}
```

- [ ] **Step 2: Expand migration**

Modify the `pools` check in `src/db/migrate.ts`:

```sql
CHECK (status IN ('open', 'ready', 'assigned', 'arrival_requested', 'in_progress', 'cancelled', 'expired', 'completed'))
```

Add these migration statements after the existing table creation block:

```sql
CREATE TABLE IF NOT EXISTS pool_events (
  id BIGSERIAL PRIMARY KEY,
  pool_id BIGINT NOT NULL REFERENCES pools(id) ON DELETE CASCADE,
  actor_telegram_id TEXT,
  actor_role TEXT NOT NULL CHECK (actor_role IN ('passenger', 'driver', 'admin', 'system')),
  event_type TEXT NOT NULL,
  from_status TEXT,
  to_status TEXT,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  key TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  actor_telegram_id TEXT,
  request_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('processing', 'completed', 'failed')),
  response_json JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS notification_outbox (
  id BIGSERIAL PRIMARY KEY,
  target_bot TEXT NOT NULL CHECK (target_bot IN ('passenger', 'driver')),
  chat_id TEXT NOT NULL,
  message_type TEXT NOT NULL,
  payload_json JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sending', 'sent', 'failed', 'cancelled')),
  telegram_message_id INTEGER,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS pool_events_pool_created_idx
  ON pool_events (pool_id, created_at);

CREATE INDEX IF NOT EXISTS idempotency_keys_expires_idx
  ON idempotency_keys (expires_at);

CREATE INDEX IF NOT EXISTS notification_outbox_pending_idx
  ON notification_outbox (status, next_attempt_at, id);
```

Extend `pool_passengers`:

```sql
ALTER TABLE pool_passengers
  ADD COLUMN IF NOT EXISTS reservation_expires_at TIMESTAMPTZ;
```

- [ ] **Step 3: Backfill active arrival state**

Add this migration statement after the new status check exists:

```sql
UPDATE pools
SET status = 'arrival_requested',
    updated_at = NOW()
WHERE status = 'assigned'
  AND arrival_requested_at IS NOT NULL
  AND arrived_at IS NULL;
```

- [ ] **Step 4: Verify migration compiles**

Run:

```bash
npm run typecheck
```

Expected: pass.

## Task 3: Add Store APIs for Events, Idempotency, and Outbox

**Files:**
- Modify: `src/domain/ridePoolService.ts`
- Modify: `src/db/postgresRidePoolStore.ts`
- Create: `tests/storeContractTypes.test.ts`

- [ ] **Step 1: Extend the store interface**

Modify `RidePoolStore` in `src/domain/ridePoolService.ts`:

```ts
  insertPoolEvent(input: PoolEventInput): Promise<void>;
  getCompletedIdempotency(key: string, requestHash: string): Promise<unknown | null>;
  createIdempotencyProcessing(input: {
    key: string;
    source: string;
    actorTelegramId: string | null;
    requestHash: string;
    expiresAt: Date;
  }): Promise<'created' | 'exists'>;
  completeIdempotency(key: string, response: unknown): Promise<void>;
  failIdempotency(key: string, error: string): Promise<void>;
  enqueueNotification(input: NotificationOutboxInput): Promise<string>;
  enqueueNotifications(inputs: NotificationOutboxInput[]): Promise<string[]>;
```

Add the imports:

```ts
  NotificationOutboxInput,
  PoolEventInput,
```

- [ ] **Step 2: Add a compile-only fake-store test**

Create `tests/storeContractTypes.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import type { RidePoolStore } from '../src/domain/ridePoolService.js';

describe('store contract', () => {
  it('includes stability-layer methods', () => {
    const methodNames: Array<keyof RidePoolStore> = [
      'insertPoolEvent',
      'getCompletedIdempotency',
      'createIdempotencyProcessing',
      'completeIdempotency',
      'failIdempotency',
      'enqueueNotification',
      'enqueueNotifications'
    ];

    expect(methodNames).toContain('enqueueNotifications');
  });
});
```

- [ ] **Step 3: Run test to verify type failures**

Run:

```bash
npm test -- tests/storeContractTypes.test.ts
```

Expected: fail until fake stores and PostgreSQL store implement the new methods.

- [ ] **Step 4: Implement event and outbox store methods**

Add to `PostgresRidePoolStore`:

```ts
  async insertPoolEvent(input: PoolEventInput): Promise<void> {
    await this.queryable.query(
      `
        INSERT INTO pool_events (
          pool_id,
          actor_telegram_id,
          actor_role,
          event_type,
          from_status,
          to_status,
          metadata_json
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
      `,
      [
        input.poolId,
        input.actorTelegramId,
        input.actorRole,
        input.eventType,
        input.fromStatus,
        input.toStatus,
        JSON.stringify(input.metadata)
      ]
    );
  }

  async enqueueNotification(input: NotificationOutboxInput): Promise<string> {
    const [id] = await this.enqueueNotifications([input]);
    return id;
  }

  async enqueueNotifications(inputs: NotificationOutboxInput[]): Promise<string[]> {
    const ids: string[] = [];
    for (const input of inputs) {
      const result = await this.queryable.query(
        `
          INSERT INTO notification_outbox (
            target_bot,
            chat_id,
            message_type,
            payload_json,
            next_attempt_at
          )
          VALUES ($1, $2, $3, $4::jsonb, COALESCE($5, NOW()))
          RETURNING id::text
        `,
        [
          input.targetBot,
          input.chatId,
          input.messageType,
          JSON.stringify(input.payload),
          input.nextAttemptAt ?? null
        ]
      );
      ids.push(String(result.rows[0].id));
    }
    return ids;
  }
```

- [ ] **Step 5: Implement idempotency store methods**

Add to `PostgresRidePoolStore`:

```ts
  async getCompletedIdempotency(key: string, requestHash: string): Promise<unknown | null> {
    const result = await this.queryable.query(
      `
        SELECT response_json
        FROM idempotency_keys
        WHERE key = $1
          AND request_hash = $2
          AND status = 'completed'
          AND expires_at > NOW()
      `,
      [key, requestHash]
    );

    return result.rows[0]?.response_json ?? null;
  }

  async createIdempotencyProcessing(input: {
    key: string;
    source: string;
    actorTelegramId: string | null;
    requestHash: string;
    expiresAt: Date;
  }): Promise<'created' | 'exists'> {
    const result = await this.queryable.query(
      `
        INSERT INTO idempotency_keys (
          key,
          source,
          actor_telegram_id,
          request_hash,
          status,
          expires_at
        )
        VALUES ($1, $2, $3, $4, 'processing', $5)
        ON CONFLICT (key) DO NOTHING
      `,
      [input.key, input.source, input.actorTelegramId, input.requestHash, input.expiresAt]
    );

    return (result.rowCount ?? 0) === 1 ? 'created' : 'exists';
  }

  async completeIdempotency(key: string, response: unknown): Promise<void> {
    await this.queryable.query(
      `
        UPDATE idempotency_keys
        SET status = 'completed',
            response_json = $2::jsonb
        WHERE key = $1
      `,
      [key, JSON.stringify(response)]
    );
  }

  async failIdempotency(key: string, error: string): Promise<void> {
    await this.queryable.query(
      `
        UPDATE idempotency_keys
        SET status = 'failed',
            response_json = $2::jsonb
        WHERE key = $1
      `,
      [key, JSON.stringify({ error })]
    );
  }
```

- [ ] **Step 6: Run typecheck**

Run:

```bash
npm run typecheck
```

Expected: failures in fake tests until test fake stores include no-op implementations. Add simple no-op implementations to `tests/ridePoolService.test.ts` fake store:

```ts
  async insertPoolEvent(): Promise<void> {}
  async getCompletedIdempotency(): Promise<unknown | null> { return null; }
  async createIdempotencyProcessing(): Promise<'created' | 'exists'> { return 'created'; }
  async completeIdempotency(): Promise<void> {}
  async failIdempotency(): Promise<void> {}
  async enqueueNotification(): Promise<string> { return '1'; }
  async enqueueNotifications(inputs: NotificationOutboxInput[]): Promise<string[]> {
    return inputs.map((_, index) => String(index + 1));
  }
```

- [ ] **Step 7: Verify store contract**

Run:

```bash
npm test -- tests/storeContractTypes.test.ts
npm run typecheck
```

Expected: pass.

## Task 4: Convert Arrival Into an Explicit State

**Files:**
- Modify: `src/db/postgresRidePoolStore.ts`
- Modify: `src/domain/ridePoolService.ts`
- Modify: `tests/ridePoolService.test.ts`

- [ ] **Step 1: Add service tests**

Add to `tests/ridePoolService.test.ts`:

```ts
it('moves assigned pool into arrival_requested when driver taps arrived', async () => {
  const { service, store } = setupService();
  const pool = await confirmedReadyPool(service, store);
  const accepted = await service.acceptJob(pool.id, 'driver-1');
  expect(accepted.kind).toBe('assigned');

  const arrival = await service.requestDriverArrival(pool.id, 'driver-1');

  expect(arrival.kind).toBe('requested');
  if (arrival.kind === 'requested') {
    expect(arrival.pool.status).toBe('arrival_requested');
  }
});

it('only confirms arrival from arrival_requested', async () => {
  const { service, store } = setupService();
  const pool = await confirmedReadyPool(service, store);
  const accepted = await service.acceptJob(pool.id, 'driver-1');
  expect(accepted.kind).toBe('assigned');

  const blocked = await service.confirmDriverArrival(pool.id, pool.captainTelegramId);

  expect(blocked.kind).toBe('not_allowed');
});
```

- [ ] **Step 2: Update PostgreSQL transition**

Modify `requestDriverArrival` in `src/db/postgresRidePoolStore.ts`:

```sql
UPDATE pools
SET status = 'arrival_requested',
    arrival_requested_at = NOW(),
    updated_at = NOW()
WHERE id = $1
  AND status = 'assigned'
  AND driver_telegram_id IS NOT NULL
RETURNING id::text
```

Modify `confirmDriverArrival`:

```sql
UPDATE pools
SET status = 'in_progress',
    arrived_at = NOW(),
    updated_at = NOW()
WHERE id = $1
  AND status = 'arrival_requested'
  AND arrival_requested_at IS NOT NULL
RETURNING id::text
```

Modify `rejectDriverArrival`:

```sql
UPDATE pools
SET status = 'assigned',
    arrival_requested_at = NULL,
    updated_at = NOW()
WHERE id = $1
  AND status = 'arrival_requested'
  AND arrival_requested_at IS NOT NULL
RETURNING id::text
```

- [ ] **Step 3: Update service guards**

Modify `confirmDriverArrival` and `rejectDriverArrival` in `src/domain/ridePoolService.ts`:

```ts
pool.status !== 'arrival_requested'
```

instead of:

```ts
pool.status !== 'assigned' || !pool.arrivalRequestedAt
```

- [ ] **Step 4: Update fake store**

Modify the fake store in `tests/ridePoolService.test.ts`:

```ts
  async requestDriverArrival(poolId: string): Promise<RidePool | null> {
    const pool = this.pools.get(poolId);
    if (!pool || pool.status !== 'assigned') {
      return null;
    }

    pool.status = 'arrival_requested';
    pool.arrivalRequestedAt = new Date();
    return pool;
  }
```

and:

```ts
  async confirmDriverArrival(poolId: string): Promise<RidePool | null> {
    const pool = this.pools.get(poolId);
    if (!pool || pool.status !== 'arrival_requested') {
      return null;
    }

    pool.status = 'in_progress';
    pool.arrivedAt = new Date();
    return pool;
  }
```

- [ ] **Step 5: Verify service tests**

Run:

```bash
npm test -- tests/ridePoolService.test.ts
```

Expected: pass.

## Task 5: Add Idempotency Guard for Duplicate Clicks

**Files:**
- Create: `src/domain/idempotency.ts`
- Create: `tests/idempotency.test.ts`
- Modify: `src/http/app.ts`
- Modify: `src/bot/createBot.ts`
- Modify: `src/bot/createDriverBot.ts`

- [ ] **Step 1: Write idempotency test**

Create `tests/idempotency.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';

import { createRequestHash, runIdempotent } from '../src/domain/idempotency.js';
import type { RidePoolStore } from '../src/domain/ridePoolService.js';

describe('idempotency guard', () => {
  it('returns saved response for repeated completed key', async () => {
    const store = {
      getCompletedIdempotency: vi.fn().mockResolvedValue({ result: 'saved' })
    } as unknown as RidePoolStore;

    const response = await runIdempotent(store, {
      key: 'telegram-callback-123',
      source: 'telegram_callback',
      actorTelegramId: '99',
      requestHash: createRequestHash({ action: 'accept', poolId: '1' }),
      expiresInSeconds: 86400,
      work: async () => ({ result: 'fresh' })
    });

    expect(response).toEqual({ result: 'saved' });
  });

  it('stores response for first request', async () => {
    const store = {
      getCompletedIdempotency: vi.fn().mockResolvedValue(null),
      createIdempotencyProcessing: vi.fn().mockResolvedValue('created'),
      completeIdempotency: vi.fn().mockResolvedValue(undefined),
      failIdempotency: vi.fn().mockResolvedValue(undefined)
    } as unknown as RidePoolStore;

    const response = await runIdempotent(store, {
      key: 'mini-app-confirm-payment-1',
      source: 'mini_app',
      actorTelegramId: '99',
      requestHash: createRequestHash({ poolId: '1' }),
      expiresInSeconds: 86400,
      work: async () => ({ result: 'fresh' })
    });

    expect(response).toEqual({ result: 'fresh' });
    expect(store.completeIdempotency).toHaveBeenCalledWith(
      'mini-app-confirm-payment-1',
      { result: 'fresh' }
    );
  });
});
```

- [ ] **Step 2: Implement idempotency helper**

Create `src/domain/idempotency.ts`:

```ts
import { createHash } from 'node:crypto';

import type { RidePoolStore } from './ridePoolService.js';

export interface IdempotentWork<T> {
  key: string;
  source: string;
  actorTelegramId: string | null;
  requestHash: string;
  expiresInSeconds: number;
  work: () => Promise<T>;
}

export function createRequestHash(input: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(sortJson(input)))
    .digest('hex');
}

export async function runIdempotent<T>(
  store: RidePoolStore,
  input: IdempotentWork<T>
): Promise<T> {
  const saved = await store.getCompletedIdempotency(input.key, input.requestHash);
  if (saved !== null) {
    return saved as T;
  }

  const created = await store.createIdempotencyProcessing({
    key: input.key,
    source: input.source,
    actorTelegramId: input.actorTelegramId,
    requestHash: input.requestHash,
    expiresAt: new Date(Date.now() + input.expiresInSeconds * 1000)
  });

  if (created === 'exists') {
    const repeated = await store.getCompletedIdempotency(input.key, input.requestHash);
    if (repeated !== null) {
      return repeated as T;
    }
    throw new Error('Action is already being processed. Please wait a moment and try again.');
  }

  try {
    const response = await input.work();
    await store.completeIdempotency(input.key, response);
    return response;
  } catch (error) {
    await store.failIdempotency(
      input.key,
      error instanceof Error ? error.message : 'unknown_error'
    );
    throw error;
  }
}

function sortJson(input: unknown): unknown {
  if (Array.isArray(input)) {
    return input.map(sortJson);
  }

  if (input && typeof input === 'object') {
    return Object.keys(input)
      .sort()
      .reduce<Record<string, unknown>>((result, key) => {
        result[key] = sortJson((input as Record<string, unknown>)[key]);
        return result;
      }, {});
  }

  return input;
}
```

- [ ] **Step 3: Run idempotency test**

Run:

```bash
npm test -- tests/idempotency.test.ts
```

Expected: pass.

- [ ] **Step 4: Wrap Mini App mutations**

In `src/http/app.ts`, wrap these handlers with `runIdempotent`:

- `POST /api/passenger/pools`
- `POST /api/passenger/pools/:poolId/confirm-payment`
- `POST /api/passenger/pools/:poolId/cancel`
- `POST /api/passenger/pools/:poolId/early-dispatch`
- `POST /api/passenger/pools/:poolId/early-dispatch/vote`
- `POST /api/passenger/pools/:poolId/arrival/confirm`
- `POST /api/passenger/pools/:poolId/arrival/reject`

Use this key shape:

```ts
const key = [
  'mini-app',
  telegramId,
  req.method,
  req.path,
  req.get('x-idempotency-key') ?? createRequestHash(req.body)
].join(':');
```

- [ ] **Step 5: Wrap Telegram callback actions**

In `src/bot/createBot.ts` and `src/bot/createDriverBot.ts`, wrap callback handlers with:

```ts
const callbackId = 'id' in ctx.callbackQuery ? ctx.callbackQuery.id : null;
const key = callbackId
  ? `telegram-callback:${callbackId}`
  : `telegram-callback:${ctx.from?.id ?? 'unknown'}:${ctx.update.update_id}`;
```

Use `createRequestHash({ action: ctx.match[0], actor: ctx.from?.id })`.

- [ ] **Step 6: Verify duplicate-click protection**

Run:

```bash
npm test -- tests/idempotency.test.ts
npm run typecheck
```

Expected: pass.

## Task 6: Add Notification Outbox Worker

**Files:**
- Create: `src/bot/notificationOutbox.ts`
- Create: `tests/notificationOutbox.test.ts`
- Modify: `src/db/postgresRidePoolStore.ts`
- Modify: `src/bot/botRegistry.ts`
- Modify: `src/index.ts`

- [ ] **Step 1: Add outbox store methods**

Add to `PostgresRidePoolStore`:

```ts
  async claimPendingNotifications(limit: number): Promise<QueuedNotification[]> {
    const result = await this.queryable.query(
      `
        UPDATE notification_outbox n
        SET status = 'sending',
            attempt_count = attempt_count + 1
        WHERE n.id IN (
          SELECT id
          FROM notification_outbox
          WHERE status IN ('pending', 'sending')
            AND next_attempt_at <= NOW()
            AND attempt_count < 5
          ORDER BY next_attempt_at ASC, id ASC
          FOR UPDATE SKIP LOCKED
          LIMIT $1
        )
        RETURNING id::text, target_bot, chat_id, message_type, payload_json, attempt_count
      `,
      [limit]
    );

    return result.rows.map(mapQueuedNotification);
  }

  async markNotificationSent(id: string, telegramMessageId: number): Promise<void> {
    await this.queryable.query(
      `
        UPDATE notification_outbox
        SET status = 'sent',
            telegram_message_id = $2,
            sent_at = NOW()
        WHERE id = $1
      `,
      [id, telegramMessageId]
    );
  }

  async markNotificationRetry(id: string, error: string, nextAttemptAt: Date): Promise<void> {
    await this.queryable.query(
      `
        UPDATE notification_outbox
        SET status = 'pending',
            last_error = $2,
            next_attempt_at = $3
        WHERE id = $1
      `,
      [id, error, nextAttemptAt]
    );
  }

  async markNotificationFailed(id: string, error: string): Promise<void> {
    await this.queryable.query(
      `
        UPDATE notification_outbox
        SET status = 'failed',
            last_error = $2
        WHERE id = $1
      `,
      [id, error]
    );
  }
```

- [ ] **Step 2: Create worker test**

Create `tests/notificationOutbox.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';

import { sendPendingNotifications } from '../src/bot/notificationOutbox.js';

describe('notification outbox worker', () => {
  it('marks sent notification as sent', async () => {
    const store = {
      claimPendingNotifications: vi.fn().mockResolvedValue([
        {
          id: '1',
          targetBot: 'passenger',
          chatId: '99',
          messageType: 'plain_text',
          payload: { text: 'Hello' },
          attemptCount: 1
        }
      ]),
      markNotificationSent: vi.fn().mockResolvedValue(undefined),
      markNotificationRetry: vi.fn().mockResolvedValue(undefined),
      markNotificationFailed: vi.fn().mockResolvedValue(undefined)
    };
    const passengerBot = {
      telegram: {
        sendMessage: vi.fn().mockResolvedValue({ message_id: 10 })
      }
    };

    await sendPendingNotifications({
      store: store as never,
      bots: { passengerBot: passengerBot as never },
      batchSize: 10
    });

    expect(passengerBot.telegram.sendMessage).toHaveBeenCalledWith('99', 'Hello', undefined);
    expect(store.markNotificationSent).toHaveBeenCalledWith('1', 10);
  });
});
```

- [ ] **Step 3: Implement worker**

Create `src/bot/notificationOutbox.ts`:

```ts
import type { Context, Telegraf } from 'telegraf';

import type { PostgresRidePoolStore } from '../db/postgresRidePoolStore.js';
import type { BotRegistry } from './botRegistry.js';

interface SendPendingNotificationsInput {
  store: PostgresRidePoolStore;
  bots: BotRegistry;
  batchSize: number;
}

const retryDelaysMs = [0, 10_000, 30_000, 120_000, 600_000];

export async function sendPendingNotifications({
  store,
  bots,
  batchSize
}: SendPendingNotificationsInput): Promise<void> {
  const notifications = await store.claimPendingNotifications(batchSize);

  for (const notification of notifications) {
    try {
      const bot = selectBot(bots, notification.targetBot);
      if (!bot) {
        throw new Error(`Missing ${notification.targetBot} bot`);
      }

      const message = await bot.telegram.sendMessage(
        notification.chatId,
        String(notification.payload.text),
        notification.payload.replyMarkup
      );

      await store.markNotificationSent(notification.id, message.message_id);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown_error';
      if (notification.attemptCount >= retryDelaysMs.length) {
        await store.markNotificationFailed(notification.id, message);
      } else {
        await store.markNotificationRetry(
          notification.id,
          message,
          new Date(Date.now() + retryDelaysMs[notification.attemptCount])
        );
      }
    }
  }
}

export function startNotificationOutboxLoop(input: SendPendingNotificationsInput): NodeJS.Timeout {
  const interval = setInterval(() => {
    void sendPendingNotifications(input).catch((error) => {
      console.error('Notification outbox sweep failed', error);
    });
  }, 5_000);

  interval.unref();
  return interval;
}

function selectBot(
  bots: BotRegistry,
  targetBot: string
): Telegraf<Context> | null {
  return targetBot === 'driver'
    ? bots.driverBot ?? null
    : bots.passengerBot ?? null;
}
```

- [ ] **Step 4: Start worker**

Modify `src/index.ts`:

```ts
import { startNotificationOutboxLoop } from './bot/notificationOutbox.js';
```

After `bots.driverBot = driverBot`:

```ts
  const notificationLoop = startNotificationOutboxLoop({
    store,
    bots,
    batchSize: 25
  });
```

In shutdown:

```ts
clearInterval(notificationLoop);
```

- [ ] **Step 5: Verify worker**

Run:

```bash
npm test -- tests/notificationOutbox.test.ts
npm run typecheck
```

Expected: pass.

## Task 7: Queue Durable Notifications During Workflow Actions

**Files:**
- Create: `src/domain/workflowNotifications.ts`
- Create: `src/bot/workflowNotificationFactory.ts`
- Modify: `src/domain/ridePoolService.ts`
- Modify: `src/http/app.ts`
- Modify: `src/bot/createBot.ts`
- Modify: `src/bot/createDriverBot.ts`
- Modify: `src/bot/messages.ts`
- Modify: `tests/ridePoolService.test.ts`

- [ ] **Step 1: Add workflow notification interfaces**

Create `src/domain/workflowNotifications.ts`:

```ts
import type {
  NotificationOutboxInput,
  PassengerManifest,
  RidePool,
  TelegramUserProfile
} from './types.js';

export interface WorkflowNotificationFactory {
  poolReady(pool: RidePool, passengerIds: string[]): NotificationOutboxInput[];
  earlyDispatchRequest(pool: RidePool, passengerIds: string[]): NotificationOutboxInput[];
  earlyDispatchCancelled(pool: RidePool, passengerIds: string[]): NotificationOutboxInput[];
  driverAssigned(
    pool: RidePool,
    driver: TelegramUserProfile,
    passengerIds: string[]
  ): NotificationOutboxInput[];
  driverArrivalRequested(
    pool: RidePool,
    driver: TelegramUserProfile,
    passengerIds: string[]
  ): NotificationOutboxInput[];
  arrivalConfirmed(pool: RidePool, passengerIds: string[]): NotificationOutboxInput[];
  arrivalRejected(pool: RidePool): NotificationOutboxInput[];
  tripCompleted(pool: RidePool, passengerIds: string[]): NotificationOutboxInput[];
  driverManifest(
    pool: RidePool,
    driverTelegramId: string,
    manifest: PassengerManifest[]
  ): NotificationOutboxInput;
}
```

- [ ] **Step 2: Add Telegraf-specific notification factory**

Create `src/bot/workflowNotificationFactory.ts`:

```ts
import { Markup } from 'telegraf';

import type { AppConfig } from '../config/env.js';
import type {
  NotificationOutboxInput,
  PassengerManifest,
  RidePool,
  TelegramUserProfile
} from '../domain/types.js';
import type { WorkflowNotificationFactory } from '../domain/workflowNotifications.js';
import {
  driverArrivalConfirmedDriverMessage,
  driverArrivalConfirmedPassengerMessage,
  driverArrivalRejectedDriverMessage,
  driverArrivalRequestCaptainMessage,
  driverGroupAlertMessage,
  driverManifestMessage,
  earlyDispatchCancelledMessage,
  earlyDispatchRequestMessage,
  passengerDriverAssignedMessage,
  poolReadyPassengerMessage,
  repostedDriverAlertMessage,
  tripCompletedDriverMessage,
  tripCompletedPassengerMessage
} from './messages.js';

export function createWorkflowNotificationFactory(config: AppConfig): WorkflowNotificationFactory {
  return {
    poolReady(pool, passengerIds) {
      return [
        driverAlert(config.driverGroupChatId, pool, driverGroupAlertMessage(pool)),
        ...passengerIds.map((chatId) => passengerMessage(chatId, 'pool_ready', poolReadyPassengerMessage(pool)))
      ];
    },
    earlyDispatchRequest(pool, passengerIds) {
      return passengerIds.map((chatId) => ({
        targetBot: 'passenger',
        chatId,
        messageType: 'early_dispatch_request',
        payload: {
          text: earlyDispatchRequestMessage(pool),
          replyMarkup: Markup.inlineKeyboard([
            [Markup.button.callback('Accept Early Dispatch', `early_accept:${pool.id}`)],
            [Markup.button.callback('Reject', `early_reject:${pool.id}`)]
          ]).reply_markup
        }
      }));
    },
    earlyDispatchCancelled(pool, passengerIds) {
      return passengerIds.map((chatId) =>
        passengerMessage(chatId, 'early_dispatch_cancelled', earlyDispatchCancelledMessage(pool))
      );
    },
    driverAssigned(pool, driver, passengerIds) {
      return passengerIds.map((chatId) =>
        passengerMessage(chatId, 'driver_assigned', passengerDriverAssignedMessage(pool, driver))
      );
    },
    driverArrivalRequested(pool, driver, passengerIds) {
      return passengerIds.map((chatId) => ({
        targetBot: 'passenger',
        chatId,
        messageType: 'driver_arrival_requested',
        payload: {
          text: driverArrivalRequestCaptainMessage(pool, driver),
          replyMarkup: Markup.inlineKeyboard([
            [Markup.button.callback('Confirm Arrival', `confirm_arrival:${pool.id}`)],
            [Markup.button.callback('Driver Not Here', `reject_arrival:${pool.id}`)]
          ]).reply_markup
        }
      }));
    },
    arrivalConfirmed(pool, passengerIds) {
      return [
        driverMessage(String(pool.driverTelegramId), 'arrival_confirmed', driverArrivalConfirmedDriverMessage(pool)),
        ...passengerIds.map((chatId) =>
          passengerMessage(chatId, 'arrival_confirmed', driverArrivalConfirmedPassengerMessage(pool))
        )
      ];
    },
    arrivalRejected(pool) {
      return [driverMessage(String(pool.driverTelegramId), 'arrival_rejected', driverArrivalRejectedDriverMessage(pool))];
    },
    tripCompleted(pool, passengerIds) {
      const notifications = passengerIds.map((chatId) =>
        passengerMessage(chatId, 'trip_completed', tripCompletedPassengerMessage(pool))
      );
      notifications.push(driverMessage(String(pool.driverTelegramId), 'trip_completed', tripCompletedDriverMessage(pool)));
      return notifications;
    },
    driverManifest(pool, driverTelegramId, manifest) {
      return {
        targetBot: 'driver',
        chatId: driverTelegramId,
        messageType: 'driver_manifest',
        payload: {
          text: driverManifestMessage(pool, manifest),
          replyMarkup: Markup.inlineKeyboard([
            [Markup.button.callback('I Arrived', `arrived:${pool.id}`)]
          ]).reply_markup
        }
      };
    }
  };
}

export function repostedDriverNotification(config: AppConfig, pool: RidePool): NotificationOutboxInput {
  return driverAlert(config.driverGroupChatId, pool, repostedDriverAlertMessage(pool));
}

function driverAlert(chatId: string, pool: RidePool, text: string): NotificationOutboxInput {
  return {
    targetBot: 'driver',
    chatId,
    messageType: 'driver_pool_ready',
    payload: {
      text,
      replyMarkup: Markup.inlineKeyboard([
        [Markup.button.callback('Accept Job', `accept:${pool.id}`)]
      ]).reply_markup
    }
  };
}

function passengerMessage(chatId: string, messageType: string, text: string): NotificationOutboxInput {
  return { targetBot: 'passenger', chatId, messageType, payload: { text } };
}

function driverMessage(chatId: string, messageType: string, text: string): NotificationOutboxInput {
  return { targetBot: 'driver', chatId, messageType, payload: { text } };
}
```

- [ ] **Step 3: Inject notification factory into service**

Modify `RidePoolServiceOptions` in `src/domain/ridePoolService.ts`:

```ts
export interface RidePoolServiceOptions {
  poolSize?: number;
  generatePin?: () => string | Promise<string>;
  notifications?: WorkflowNotificationFactory;
}
```

Add `getUserProfile` to `RidePoolStore`:

```ts
getUserProfile(telegramId: string): Promise<TelegramUserProfile | null>;
```

Modify `src/index.ts`:

```ts
import { createWorkflowNotificationFactory } from './bot/workflowNotificationFactory.js';
```

Construct the service as:

```ts
const notificationFactory = createWorkflowNotificationFactory(config);
const service = new RidePoolService(store, {
  poolSize: config.poolSize,
  notifications: notificationFactory
});
```

- [ ] **Step 4: Queue pool-ready notifications inside service**

In `RidePoolService.confirmPayment`, after `markPoolReady`:

```ts
const passengerIds = await store.getConfirmedPassengerTelegramIds(poolId);
if (this.options.notifications) {
  await store.enqueueNotifications(
    this.options.notifications.poolReady(readyPool, passengerIds)
  );
}
await store.insertPoolEvent({
  poolId,
  actorTelegramId: telegramId,
  actorRole: 'passenger',
  eventType: 'pool_ready',
  fromStatus: 'open',
  toStatus: 'ready',
  metadata: { passengerCount: refreshedPool.passengerCount }
});
```

- [ ] **Step 5: Remove direct durable sends from HTTP handlers**

In `src/http/app.ts`, replace:

```ts
await notifyPoolReady(bot, driverBot ?? bot, config, store, service, result.pool);
```

with:

```ts
// Notification rows were queued by RidePoolService.confirmPayment.
```

The response still returns the latest passenger state immediately.

- [ ] **Step 6: Queue driver-assigned notifications**

In `RidePoolService.acceptJob`, after successful assignment:

```ts
const driver = await store.getUserProfile(driverTelegramId);
const passengerIds = await store.getConfirmedPassengerTelegramIds(poolId);
if (this.options.notifications && driver) {
  await store.enqueueNotifications([
    this.options.notifications.driverManifest(pool, driverTelegramId, manifest),
    ...this.options.notifications.driverAssigned(pool, driver, passengerIds)
  ]);
}
await store.insertPoolEvent({
  poolId,
  actorTelegramId: driverTelegramId,
  actorRole: 'driver',
  eventType: 'driver_assigned',
  fromStatus: 'ready',
  toStatus: 'assigned',
  metadata: {}
});
```

- [ ] **Step 7: Queue arrival and completion notifications**

In `RidePoolService.completeTrip`, after the `completed` transition:

```ts
const passengerIds = await this.store.getConfirmedPassengerTelegramIds(pool.id);
if (this.options.notifications) {
  await this.store.enqueueNotifications(
    this.options.notifications.tripCompleted(pool, passengerIds)
  );
}
await store.insertPoolEvent({
  poolId: pool.id,
  actorTelegramId: driverTelegramId,
  actorRole: 'driver',
  eventType: 'trip_completed',
  fromStatus: 'in_progress',
  toStatus: 'completed',
  metadata: {}
});
```

- [ ] **Step 8: Verify no PIN goes to driver outbox**

Add test to `tests/ridePoolService.test.ts`:

```ts
it('does not enqueue pool pin in driver notifications', async () => {
  const { service, store } = setupService();
  const pool = await confirmedReadyPool(service, store);

  await service.acceptJob(pool.id, 'driver-1');

  const driverPayloads = store.notifications
    .filter((item) => item.targetBot === 'driver')
    .map((item) => JSON.stringify(item.payload));
  expect(driverPayloads.join('\n')).not.toContain(pool.pinCode);
});
```

- [ ] **Step 9: Verify workflow notifications**

Run:

```bash
npm test -- tests/ridePoolService.test.ts
npm run typecheck
```

Expected: pass.

## Task 8: Replace Recovery Loop With a Full Recovery Worker

**Files:**
- Create: `src/workers/recoveryWorker.ts`
- Create: `tests/recoveryWorker.test.ts`
- Modify: `src/bot/lateDriverRepost.ts`
- Modify: `src/index.ts`
- Modify: `src/db/postgresRidePoolStore.ts`

- [ ] **Step 1: Add recovery methods to store**

Add methods:

```ts
listReadyPoolsMissingDriverAlert(limit?: number): Promise<RidePool[]>;
findLateAssignedPools(cutoff: Date): Promise<RidePool[]>;
expireDriverAssignment(poolId: string): Promise<RidePool | null>;
expireOpenReservations(cutoff: Date): Promise<number>;
cancelEmptyStaleOpenPools(cutoff: Date): Promise<number>;
findStaleArrivalRequestedPools(cutoff: Date): Promise<RidePool[]>;
```

Existing methods cover the first three. Add the last three.

- [ ] **Step 2: Write recovery worker test**

Create `tests/recoveryWorker.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';

import { runRecoverySweep } from '../src/workers/recoveryWorker.js';

describe('recovery worker', () => {
  it('queues missing driver alert instead of sending directly', async () => {
    const pool = {
      id: '1',
      routeName: 'Mexico -> Bole',
      passengerCount: 4,
      isEarlyDispatch: false
    };
    const store = {
      listReadyPoolsMissingDriverAlert: vi.fn().mockResolvedValue([pool]),
      enqueueNotification: vi.fn().mockResolvedValue('10'),
      insertPoolEvent: vi.fn().mockResolvedValue(undefined),
      findLateAssignedPools: vi.fn().mockResolvedValue([]),
      expireOpenReservations: vi.fn().mockResolvedValue(0),
      cancelEmptyStaleOpenPools: vi.fn().mockResolvedValue(0),
      findStaleArrivalRequestedPools: vi.fn().mockResolvedValue([])
    };

    await runRecoverySweep({
      store: store as never,
      driverGroupChatId: '-100123',
      driverArrivalTimeoutMinutes: 10
    });

    expect(store.enqueueNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        targetBot: 'driver',
        chatId: '-100123',
        messageType: 'driver_pool_ready'
      })
    );
  });
});
```

- [ ] **Step 3: Implement worker**

Create `src/workers/recoveryWorker.ts`:

```ts
import { Markup } from 'telegraf';

import type { AppConfig } from '../config/env.js';
import type { PostgresRidePoolStore } from '../db/postgresRidePoolStore.js';
import { driverGroupAlertMessage, repostedDriverAlertMessage } from '../bot/messages.js';

interface RecoverySweepInput {
  store: PostgresRidePoolStore;
  driverGroupChatId: string;
  driverArrivalTimeoutMinutes: number;
}

export async function runRecoverySweep(input: RecoverySweepInput): Promise<void> {
  const readyPools = await input.store.listReadyPoolsMissingDriverAlert();
  for (const pool of readyPools) {
    await input.store.enqueueNotification({
      targetBot: 'driver',
      chatId: input.driverGroupChatId,
      messageType: 'driver_pool_ready',
      payload: {
        text: driverGroupAlertMessage(pool),
        replyMarkup: Markup.inlineKeyboard([
          [Markup.button.callback('Accept Job', `accept:${pool.id}`)]
        ]).reply_markup
      }
    });
    await input.store.insertPoolEvent({
      poolId: pool.id,
      actorTelegramId: null,
      actorRole: 'system',
      eventType: 'driver_alert_queued',
      fromStatus: pool.status,
      toStatus: pool.status,
      metadata: { reason: 'missing_driver_alert' }
    });
  }

  const cutoff = new Date(Date.now() - input.driverArrivalTimeoutMinutes * 60_000);
  const latePools = await input.store.findLateAssignedPools(cutoff);
  for (const pool of latePools) {
    const repostable = await input.store.expireDriverAssignment(pool.id);
    if (!repostable) {
      continue;
    }
    await input.store.enqueueNotification({
      targetBot: 'driver',
      chatId: input.driverGroupChatId,
      messageType: 'driver_pool_reposted',
      payload: {
        text: repostedDriverAlertMessage(repostable),
        replyMarkup: Markup.inlineKeyboard([
          [Markup.button.callback('Accept Job', `accept:${repostable.id}`)]
        ]).reply_markup
      }
    });
  }

  await input.store.expireOpenReservations(new Date());
  await input.store.cancelEmptyStaleOpenPools(new Date(Date.now() - 60 * 60_000));
}

export function startRecoveryLoop(config: AppConfig, store: PostgresRidePoolStore): NodeJS.Timeout {
  const input = {
    store,
    driverGroupChatId: config.driverGroupChatId,
    driverArrivalTimeoutMinutes: config.driverArrivalTimeoutMinutes
  };

  void runRecoverySweep(input).catch((error) => {
    console.error('Startup recovery sweep failed', error);
  });

  const interval = setInterval(() => {
    void runRecoverySweep(input).catch((error) => {
      console.error('Recovery sweep failed', error);
    });
  }, config.lateDriverSweepIntervalSeconds * 1000);

  interval.unref();
  return interval;
}
```

- [ ] **Step 4: Start new worker**

Modify `src/index.ts`:

```ts
import { startRecoveryLoop } from './workers/recoveryWorker.js';
```

Replace:

```ts
const lateDriverLoop = startLateDriverRepostLoop(...)
```

with:

```ts
const recoveryLoop = startRecoveryLoop(config, store);
```

In shutdown:

```ts
clearInterval(recoveryLoop);
```

- [ ] **Step 5: Verify recovery worker**

Run:

```bash
npm test -- tests/recoveryWorker.test.ts
npm run typecheck
```

Expected: pass.

## Task 9: Add Admin Visibility for Stability

**Files:**
- Modify: `src/domain/adminTypes.ts`
- Modify: `src/http/adminState.ts`
- Modify: `src/db/postgresRidePoolStore.ts`
- Modify: `frontend/src/adminState.ts`
- Modify: `frontend/src/AdminApp.tsx`
- Modify: `tests/adminState.test.ts`

- [ ] **Step 1: Add admin API data**

Add fields to admin overview response:

```ts
stability: {
  pendingNotifications: number;
  failedNotifications: number;
  stuckPools: Array<{
    poolId: string;
    routeName: string;
    status: PoolStatus;
    reason: string;
  }>;
}
```

- [ ] **Step 2: Add store queries**

Add to `PostgresRidePoolStore`:

```ts
async countNotificationsByStatus(status: NotificationStatus): Promise<number> {
  const result = await this.queryable.query(
    `
      SELECT COUNT(*)::int AS count
      FROM notification_outbox
      WHERE status = $1
    `,
    [status]
  );
  return Number(result.rows[0]?.count ?? 0);
}

async listRecentPoolEvents(poolId: string, limit = 50): Promise<PoolEvent[]> {
  const result = await this.queryable.query(
    `
      SELECT id::text, pool_id::text, actor_telegram_id, actor_role, event_type,
             from_status, to_status, metadata_json, created_at
      FROM pool_events
      WHERE pool_id = $1
      ORDER BY created_at DESC
      LIMIT $2
    `,
    [poolId, limit]
  );
  return result.rows.map(mapPoolEvent);
}
```

- [ ] **Step 3: Add admin stuck-state labels**

In `src/http/adminState.ts`, classify:

```ts
if (pool.status === 'ready' && !pool.driverAlertMessageId) {
  return 'Pool ready but driver alert not sent yet.';
}

if (pool.status === 'assigned' && pool.acceptedAt && minutesSince(pool.acceptedAt) > 10) {
  return 'Driver accepted but has not arrived.';
}

if (pool.status === 'arrival_requested' && pool.arrivalRequestedAt && minutesSince(pool.arrivalRequestedAt) > 5) {
  return 'Driver arrival is waiting for passenger confirmation.';
}
```

- [ ] **Step 4: Add frontend cards**

In `frontend/src/AdminApp.tsx`, add a compact stability strip:

```tsx
<section className="admin-section">
  <h2>Stability</h2>
  <div className="metric-grid">
    <Metric label="Pending notifications" value={overview.stability.pendingNotifications} />
    <Metric label="Failed notifications" value={overview.stability.failedNotifications} />
    <Metric label="Stuck pools" value={overview.stability.stuckPools.length} />
  </div>
</section>
```

- [ ] **Step 5: Verify admin state**

Run:

```bash
npm test -- tests/adminState.test.ts
npm test --prefix frontend
npm run build --prefix frontend
```

Expected: pass.

## Task 10: Full Verification and Deployment

**Files:**
- Verify all changed files.

- [ ] **Step 1: Run backend checks**

Run:

```bash
npm test
npm run typecheck
npm run build
```

Expected: all pass.

- [ ] **Step 2: Run frontend checks**

Run:

```bash
npm test --prefix frontend
npm run build --prefix frontend
```

Expected: all pass.

- [ ] **Step 3: Manual local smoke test**

Run backend locally:

```bash
npm run dev
```

Open Mini App frontend:

```bash
npm run dev --prefix frontend
```

Check this flow:

```text
Passenger A opens routes.
Passenger A creates pool.
Passenger A confirms payment.
Passenger B joins the same pool.
Passenger B confirms payment.
Early dispatch or full pool queues driver job.
Driver accepts once.
Second driver tapping the old button gets job already taken.
Driver taps I Arrived.
Passenger confirms arrival.
Driver sends PIN.
Passengers see completed checkmark state.
```

- [ ] **Step 4: Production deploy checks**

After deploy:

```bash
curl -s https://telegram-ride-pool-api-production.up.railway.app/health
```

Expected:

```json
{"ok":true,"service":"telegram-ride-pool-backend"}
```

Then test:

```text
Passenger bot /start returns routes.
Driver bot /start returns driver ready message.
Driver group receives queued job alert.
Admin dashboard shows Stability section.
```

## How This Handles the Big Failure Cases

**Backend crash:** Railway restarts the process. On startup, migrations run, recovery sweep runs, pending notifications remain in `notification_outbox`, and users continue from PostgreSQL state.

**Telegram send failure:** The ride state is already saved. The notification stays `pending` or becomes `failed` after retries. Admin can see and retry it.

**Two drivers click Accept Job:** The database update only succeeds when `status = 'ready'` and `driver_telegram_id IS NULL`. One driver wins. The other receives “job already taken.”

**Passenger taps the same button twice:** The first request creates an idempotency row and saves a response. The second request returns the saved response.

**Old button tapped after workflow moved forward:** The state machine blocks the transition and returns a clear stale-action message.

**Many passengers choose the same pool:** The pool row is locked with `FOR UPDATE`, passenger count is checked inside the transaction, and confirmed plus reserved seats cannot exceed `POOL_SIZE`.

## Self-Review

- Spec coverage: The plan covers explicit states, idempotency, outbox, recovery workers, startup reconciliation, admin visibility, passenger flow, driver flow, and duplicate-click handling.
- Type consistency: New statuses are added to `PoolStatus`, migration check, passenger state mapper, and service guards.
- Execution safety: Each task has focused files and verification commands.
