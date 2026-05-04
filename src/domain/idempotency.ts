import { createHash } from 'node:crypto';

import type { RidePoolStore } from './ridePoolService.js';

export interface IdempotentWork<T> {
  key: string;
  source: string;
  actorTelegramId: string | null;
  requestHash: string;
  expiresInSeconds: number;
  shouldCache?: (response: T) => boolean;
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
    const cachedResponse = saved as T;
    if (!input.shouldCache || input.shouldCache(cachedResponse)) {
      return cachedResponse;
    }

    await store.failIdempotency(input.key, 'cached_response_not_cacheable');
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
    if (input.shouldCache && !input.shouldCache(response)) {
      await store.failIdempotency(input.key, 'response_not_cacheable');
      return response;
    }

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
