import { afterEach, describe, expect, it, vi } from 'vitest';

import { startNewPool } from './api';

describe('Mini App API requests', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sends a fresh idempotency key for every mutating Mini App action', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ state: { activePool: null } }) });
    vi.stubGlobal('fetch', fetchMock);

    await startNewPool('query_id=abc', 'route-1');
    await startNewPool('query_id=abc', 'route-1');

    const firstHeaders = fetchMock.mock.calls[0][1].headers as Record<string, string>;
    const secondHeaders = fetchMock.mock.calls[1][1].headers as Record<string, string>;

    expect(firstHeaders['X-Idempotency-Key']).toBeTruthy();
    expect(secondHeaders['X-Idempotency-Key']).toBeTruthy();
    expect(firstHeaders['X-Idempotency-Key']).not.toBe(secondHeaders['X-Idempotency-Key']);
  });
});
