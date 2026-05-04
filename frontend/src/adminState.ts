import type { PoolStatus } from './types';

const activeStatuses = new Set<PoolStatus>(['open', 'ready', 'assigned', 'arrival_requested', 'in_progress']);

export function adminStatusLabel(status: PoolStatus): string {
  return status
    .split('_')
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(' ');
}

export function isActiveAdminPool(status: PoolStatus): boolean {
  return activeStatuses.has(status);
}

export function adminArrivalStateLabel(requestedAt: string | null, arrivedAt: string | null): string {
  if (arrivedAt) {
    return 'Confirmed';
  }

  if (requestedAt) {
    return 'Requested';
  }

  return 'Not set';
}

export function formatAdminDate(value: string | null): string {
  if (!value) {
    return 'not set';
  }

  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(value));
}
