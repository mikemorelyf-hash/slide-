import { describe, expect, it, vi } from 'vitest';

import { createRequestHash, runIdempotent } from '../src/domain/idempotency.js';
import type { RidePoolStore } from '../src/domain/ridePoolService.js';
import { buildMiniAppIdempotencyKey, shouldCacheJsonResult } from '../src/http/app.js';

describe('idempotency guard', () => {
  it('does not reuse a deterministic Mini App fallback key when the client sends no key', () => {
    const req = {
      get: vi.fn().mockReturnValue(undefined),
      method: 'POST',
      path: '/api/passenger/pools',
      params: {},
      body: { routeId: '1', createNew: true }
    };

    expect(buildMiniAppIdempotencyKey(req as never, '99', 'passenger-pools')).not.toBe(
      buildMiniAppIdempotencyKey(req as never, '99', 'passenger-pools')
    );
  });

  it('uses the client Mini App idempotency key when one is provided', () => {
    const req = {
      get: vi.fn().mockReturnValue('client-key-1'),
      method: 'POST',
      path: '/api/passenger/pools',
      params: {},
      body: { routeId: '1', createNew: true }
    };

    expect(buildMiniAppIdempotencyKey(req as never, '99', 'passenger-pools')).toBe(
      'mini-app:99:passenger-pools:client-key-1'
    );
  });

  it('returns saved response for a repeated completed key', async () => {
    const store = {
      getCompletedIdempotency: vi.fn().mockResolvedValue({ result: 'saved' })
    } as unknown as RidePoolStore;

    const response = await runIdempotent(store, {
      key: 'telegram-callback-123',
      source: 'telegram_callback',
      actorTelegramId: '99',
      requestHash: createRequestHash({ action: 'accept', poolId: '1' }),
      expiresInSeconds: 86_400,
      work: async () => ({ result: 'fresh' })
    });

    expect(response).toEqual({ result: 'saved' });
  });

  it('stores response for a first request', async () => {
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
      expiresInSeconds: 86_400,
      work: async () => ({ result: 'fresh' })
    });

    expect(response).toEqual({ result: 'fresh' });
    expect(store.completeIdempotency).toHaveBeenCalledWith('mini-app-confirm-payment-1', {
      result: 'fresh'
    });
  });

  it('does not cache responses that are not safe to replay', async () => {
    const store = {
      getCompletedIdempotency: vi.fn().mockResolvedValue(null),
      createIdempotencyProcessing: vi.fn().mockResolvedValue('created'),
      completeIdempotency: vi.fn().mockResolvedValue(undefined),
      failIdempotency: vi.fn().mockResolvedValue(undefined)
    } as unknown as RidePoolStore;

    const response = await runIdempotent<{ status?: number; body: unknown }>(store, {
      key: 'mini-app-create-pool-1',
      source: 'mini_app',
      actorTelegramId: '99',
      requestHash: createRequestHash({ routeId: '1' }),
      expiresInSeconds: 86_400,
      shouldCache: (result: { status?: number }) => !result.status || result.status < 400,
      work: async () => ({ status: 409, body: { error: 'phone_required' } })
    });

    expect(response).toEqual({ status: 409, body: { error: 'phone_required' } });
    expect(store.completeIdempotency).not.toHaveBeenCalled();
    expect(store.failIdempotency).toHaveBeenCalledWith(
      'mini-app-create-pool-1',
      'response_not_cacheable'
    );
  });

  it('does not replay an old cached response that is no longer safe to cache', async () => {
    const store = {
      getCompletedIdempotency: vi.fn().mockResolvedValue({
        status: 409,
        body: { error: 'phone_required' }
      }),
      createIdempotencyProcessing: vi.fn().mockResolvedValue('created'),
      completeIdempotency: vi.fn().mockResolvedValue(undefined),
      failIdempotency: vi.fn().mockResolvedValue(undefined)
    } as unknown as RidePoolStore;

    const response = await runIdempotent<{ status?: number; body: unknown }>(store, {
      key: 'mini-app-create-pool-1',
      source: 'mini_app',
      actorTelegramId: '99',
      requestHash: createRequestHash({ routeId: '1' }),
      expiresInSeconds: 86_400,
      shouldCache: (result: { status?: number }) => !result.status || result.status < 400,
      work: async () => ({ body: { result: 'payment_required' } })
    });

    expect(response).toEqual({ body: { result: 'payment_required' } });
    expect(store.failIdempotency).toHaveBeenCalledWith(
      'mini-app-create-pool-1',
      'cached_response_not_cacheable'
    );
    expect(store.completeIdempotency).toHaveBeenCalledWith('mini-app-create-pool-1', {
      body: { result: 'payment_required' }
    });
  });

  it('does not replay old Mini App pool_not_joinable responses that were accidentally cached as success', async () => {
    const store = {
      getCompletedIdempotency: vi.fn().mockResolvedValue({
        body: {
          result: 'pool_not_joinable',
          state: { activePool: null }
        }
      }),
      createIdempotencyProcessing: vi.fn().mockResolvedValue('created'),
      completeIdempotency: vi.fn().mockResolvedValue(undefined),
      failIdempotency: vi.fn().mockResolvedValue(undefined)
    } as unknown as RidePoolStore;

    const response = await runIdempotent<{ status?: number; body: unknown }>(store, {
      key: 'mini-app-confirm-payment-1',
      source: 'mini_app',
      actorTelegramId: '99',
      requestHash: createRequestHash({ poolId: '1' }),
      expiresInSeconds: 86_400,
      shouldCache: shouldCacheJsonResult,
      work: async () => ({ body: { result: 'confirmed' } })
    });

    expect(response).toEqual({ body: { result: 'confirmed' } });
    expect(store.failIdempotency).toHaveBeenCalledWith(
      'mini-app-confirm-payment-1',
      'cached_response_not_cacheable'
    );
    expect(store.completeIdempotency).toHaveBeenCalledWith('mini-app-confirm-payment-1', {
      body: { result: 'confirmed' }
    });
  });

  it('throws a clear retry message while another identical action is processing', async () => {
    const store = {
      getCompletedIdempotency: vi.fn().mockResolvedValue(null),
      createIdempotencyProcessing: vi.fn().mockResolvedValue('exists')
    } as unknown as RidePoolStore;

    await expect(
      runIdempotent(store, {
        key: 'telegram-callback-123',
        source: 'telegram_callback',
        actorTelegramId: '99',
        requestHash: createRequestHash({ action: 'accept', poolId: '1' }),
        expiresInSeconds: 86_400,
        work: async () => ({ result: 'fresh' })
      })
    ).rejects.toThrow('Action is already being processed');
  });
});
