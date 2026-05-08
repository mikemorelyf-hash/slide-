import { buildAuthHeaders } from './appState';
import type {
  AdminOverview,
  AdminPoolDetail,
  AdminPoolSummary,
  LanguageCode,
  PassengerState,
  ReadinessReport,
  Route,
  RoutePoolsResponse
} from './types';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, '') ?? '';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string
  ) {
    super(message);
  }
}

export async function getPassengerState(initData: string): Promise<PassengerState> {
  return request<PassengerState>('/api/passenger/state', initData);
}

export async function savePhone(initData: string, phoneNumber: string): Promise<PassengerState> {
  return requestState('/api/passenger/profile', initData, { phoneNumber });
}

export async function saveLanguage(initData: string, languageCode: LanguageCode): Promise<PassengerState> {
  return requestState('/api/passenger/language', initData, { languageCode });
}

export async function createOrJoinPool(initData: string, routeId: string): Promise<PassengerState> {
  return requestState('/api/passenger/pools', initData, { routeId });
}

export async function getRoutePools(initData: string, routeId: string): Promise<RoutePoolsResponse> {
  return request<RoutePoolsResponse>(`/api/passenger/routes/${routeId}/pools`, initData);
}

export async function joinSelectedPool(initData: string, poolId: string): Promise<PassengerState> {
  return requestState('/api/passenger/pools', initData, { poolId });
}

export async function startNewPool(initData: string, routeId: string): Promise<PassengerState> {
  return requestState('/api/passenger/pools', initData, { routeId, createNew: true });
}

export async function confirmPayment(initData: string, poolId: string): Promise<PassengerState> {
  return requestState(`/api/passenger/pools/${poolId}/confirm-payment`, initData);
}

export async function cancelPool(initData: string, poolId: string): Promise<PassengerState> {
  return requestState(`/api/passenger/pools/${poolId}/cancel`, initData);
}

export async function requestEarlyDispatch(initData: string, poolId: string): Promise<PassengerState> {
  return requestState(`/api/passenger/pools/${poolId}/early-dispatch`, initData);
}

export async function confirmArrival(initData: string, poolId: string): Promise<PassengerState> {
  return requestState(`/api/passenger/pools/${poolId}/arrival/confirm`, initData);
}

export async function rejectArrival(initData: string, poolId: string): Promise<PassengerState> {
  return requestState(`/api/passenger/pools/${poolId}/arrival/reject`, initData);
}

export async function getAdminOverview(initData: string): Promise<AdminOverview> {
  return request<AdminOverview>('/api/admin/overview', initData);
}

export async function getAdminRoutes(initData: string): Promise<Route[]> {
  const response = await request<{ routes: Route[] }>('/api/admin/routes', initData);
  return response.routes;
}

export async function updateAdminRoutePrice(
  initData: string,
  routeId: string,
  amount: number,
  currency: string
): Promise<Route> {
  const response = await request<{ route: Route }>(`/api/admin/routes/${routeId}/price`, initData, {
    method: 'PATCH',
    body: JSON.stringify({ amount, currency })
  });
  return response.route;
}

export async function getAdminPools(initData: string): Promise<AdminPoolSummary[]> {
  const response = await request<{ pools: AdminPoolSummary[] }>('/api/admin/pools', initData);
  return response.pools;
}

export async function getAdminPoolDetail(initData: string, poolId: string): Promise<AdminPoolDetail> {
  return request<AdminPoolDetail>(`/api/admin/pools/${poolId}`, initData);
}

export async function getReadiness(): Promise<ReadinessReport> {
  return request<ReadinessReport>('/ready', '');
}

export async function repostAdminDriverAlert(initData: string, poolId: string): Promise<void> {
  await request(`/api/admin/pools/${poolId}/repost-driver-alert`, initData, {
    method: 'POST'
  });
}

export async function cancelAdminPool(initData: string, poolId: string): Promise<void> {
  await request(`/api/admin/pools/${poolId}/cancel`, initData, {
    method: 'POST'
  });
}

export async function retryFailedNotifications(initData: string): Promise<void> {
  await request('/api/admin/notifications/retry-failed', initData, {
    method: 'POST'
  });
}

async function requestState(path: string, initData: string, body?: unknown): Promise<PassengerState> {
  const response = await request<{ state: PassengerState }>(path, initData, {
    method: 'POST',
    body: body ? JSON.stringify(body) : undefined
  });

  return response.state;
}

async function request<T>(
  path: string,
  initData: string,
  init?: Omit<RequestInit, 'headers'>
): Promise<T> {
  const method = init?.method?.toUpperCase() ?? 'GET';
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      ...(initData ? buildAuthHeaders(initData) : {}),
      'Content-Type': 'application/json',
      ...(method === 'GET' ? {} : { 'X-Idempotency-Key': createIdempotencyKey() })
    }
  });

  if (!response.ok) {
    let code: string | undefined;
    try {
      const body = (await response.clone().json()) as { error?: unknown };
      code = typeof body.error === 'string' ? body.error : undefined;
    } catch {
      code = undefined;
    }
    throw new ApiError(`Request failed with ${response.status}`, response.status, code);
  }

  return (await response.json()) as T;
}

function createIdempotencyKey(): string {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }

  const random = globalThis.crypto?.getRandomValues
    ? globalThis.crypto.getRandomValues(new Uint32Array(2)).join('-')
    : Math.random().toString(36).slice(2);

  return `${Date.now()}-${random}`;
}
